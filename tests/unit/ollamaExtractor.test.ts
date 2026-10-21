import { afterEach, describe, expect, it, vi } from "vitest";
import {
	extractWithOllama,
	MAX_OLLAMA_RESPONSE_BYTES,
	requestWithTimeout,
	type OllamaExtractOptions,
} from "../../src/domain/extraction/ollamaExtractor";

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json" },
	});
}

function stalledResponse(onCancel?: () => void): Response {
	return new Response(
		new ReadableStream<Uint8Array>({
			pull: () => new Promise(() => {}),
			cancel: onCancel,
		}),
		{ headers: { "content-type": "application/json" } },
	);
}

function extractionOptions(
	fetchImpl: typeof fetch,
	overrides: Partial<OllamaExtractOptions> = {},
): OllamaExtractOptions {
	return {
		endpoint: "http://127.0.0.1:11434",
		model: "llama3",
		healthCheckMs: 1_500,
		timeoutMs: 25_000,
		fetchImpl,
		...overrides,
	};
}

afterEach(() => {
	vi.useRealTimers();
});

describe("Ollama request lifecycle", () => {
	it("keeps the extraction timeout active after headers arrive and cancels a stalled body", async () => {
		vi.useFakeTimers();
		let bodyCancelled = false;
		const fetchImpl: typeof fetch = async (url) =>
			String(url).endsWith("/api/tags")
				? jsonResponse({ models: [] })
				: stalledResponse(() => {
						bodyCancelled = true;
					});

		const pending = extractWithOllama(
			"1 cup broth",
			"https://recipes.example/soup",
			extractionOptions(fetchImpl, { timeoutMs: 25 }),
		);
		await vi.advanceTimersByTimeAsync(25);

		await expect(pending).resolves.toMatchObject({
			fields: null,
			cancelled: false,
			warnings: [expect.stringContaining("timed out")],
		});
		expect(bodyCancelled).toBe(true);
	});

	it("cancels a stalled extraction body and reports cancelled when the parent aborts", async () => {
		vi.useFakeTimers();
		const parent = new AbortController();
		let bodyCancelled = false;
		const fetchImpl: typeof fetch = async (url) => {
			if (String(url).endsWith("/api/tags")) {
				return jsonResponse({ models: [] });
			}
			return stalledResponse(() => {
				bodyCancelled = true;
			});
		};

		const pending = extractWithOllama(
			"1 cup broth",
			"https://recipes.example/soup",
			extractionOptions(fetchImpl, { signal: parent.signal }),
		);
		await vi.advanceTimersByTimeAsync(0);
		parent.abort();

		await expect(pending).resolves.toMatchObject({ fields: null, cancelled: true, warnings: [] });
		expect(bodyCancelled).toBe(true);
	});

	it.each([301, 307, 308])(
		"blocks a %i redirect before any request reaches the non-loopback origin",
		async (status) => {
			const remoteRequests: Array<{ method: string; body: BodyInit | null | undefined }> = [];
			let chatInit: RequestInit | undefined;
			const fetchImpl: typeof fetch = async (input, init) => {
				const url = String(input);
				if (url.startsWith("https://remote.example")) {
					remoteRequests.push({ method: init?.method ?? "GET", body: init?.body });
					return jsonResponse({});
				}
				if (url.endsWith("/api/tags")) {
					return jsonResponse({ models: [] });
				}
				chatInit = init;
				if (init?.redirect === "error") {
					throw new TypeError(`Redirect ${status} rejected`);
				}
				return fetchImpl("https://remote.example/api/chat", {
					...init,
					method: status === 301 ? "GET" : init?.method,
					body: status === 301 ? undefined : init?.body,
				});
			};

			const result = await extractWithOllama(
				"secret recipe content",
				"https://recipes.example/private",
				extractionOptions(fetchImpl),
			);

			expect(result).toMatchObject({ fields: null, cancelled: false });
			expect(result.warnings).toEqual(["Local Ollama could not be reached."]);
			expect(remoteRequests).toEqual([]);
			// The fake's behavior above also mutation-checks this policy: removing it follows the redirect.
			expect(chatInit?.redirect).toBe("error");
		},
	);

	it("rejects a declared oversized body before obtaining a stream reader", async () => {
		let readerObtained = false;
		const response = {
			headers: new Headers({ "content-length": String(MAX_OLLAMA_RESPONSE_BYTES + 1) }),
			body: {
				getReader: () => {
					readerObtained = true;
					throw new Error("reader must not be obtained");
				},
			},
			text: async () => "",
		} as unknown as Response;
		const fetchImpl: typeof fetch = async () => response;
		const received = await requestWithTimeout(
			fetchImpl,
			"http://127.0.0.1:11434/api/chat",
			1_000,
			undefined,
		);

		await expect(received.json()).rejects.toThrow(/exceeded maximum allowed size/);
		expect(readerObtained).toBe(false);
	});

	it("rejects a chunked body as soon as its streamed bytes exceed the cap", async () => {
		const chunk = new Uint8Array(1024 * 1024);
		let chunksRead = 0;
		const response = new Response(
			new ReadableStream<Uint8Array>({
				pull(controller) {
					if (chunksRead === 6) {
						controller.close();
						return;
					}
					chunksRead += 1;
					controller.enqueue(chunk);
				},
			}),
		);
		const fetchImpl: typeof fetch = async () => response;
		const received = await requestWithTimeout(
			fetchImpl,
			"http://127.0.0.1:11434/api/chat",
			1_000,
			undefined,
		);

		await expect(received.text()).rejects.toThrow(/exceeded maximum allowed size/);
		expect(chunksRead).toBe(6);
	});
});
