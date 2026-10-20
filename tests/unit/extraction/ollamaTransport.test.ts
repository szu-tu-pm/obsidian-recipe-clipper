import { describe, expect, it } from "vitest";
import {
	extractWithOllama,
	MAX_OLLAMA_RESPONSE_BYTES,
	requestWithTimeout,
} from "../../../src/domain/extraction/ollamaExtractor";

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function makeValidOllamaResponseJson(targetByteLength: number): string {
	const base = {
		message: {
			content: JSON.stringify({
				title: "Chicken Soup",
				ingredientsRaw: ["1 cup chicken broth"],
				instructions: ["Boil the broth."],
			}),
		},
	};
	const baseStr = JSON.stringify(base);
	const paddingKey = ',"pad":"';
	const paddingEnd = '"}';
	const overhead = baseStr.length - 1 + paddingKey.length + paddingEnd.length;
	const padLength = Math.max(0, targetByteLength - overhead);
	return baseStr.slice(0, -1) + paddingKey + "a".repeat(padLength) + paddingEnd;
}

function chunkedResponse(fullText: string, chunkSize = 64 * 1024): Response {
	const encoder = new TextEncoder();
	const data = encoder.encode(fullText);
	let offset = 0;
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (offset >= data.byteLength) {
				controller.close();
				return;
			}
			const chunk = data.subarray(offset, Math.min(data.byteLength, offset + chunkSize));
			offset += chunk.byteLength;
			controller.enqueue(chunk);
		},
	});
	return new Response(stream, {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

describe("Ollama transport hardening (A1 & A2 audit findings)", () => {
	it("enforces redirect: error and rejects redirects off loopback", async () => {
		const redirectingFetch: typeof fetch = async (_url, init) => {
			expect(init?.redirect).toBe("error");
			throw new TypeError("Failed to fetch: redirect mode is set to error");
		};

		await expect(
			requestWithTimeout(redirectingFetch, "http://127.0.0.1:11434/api/tags", 1000, undefined),
		).rejects.toThrow(/redirect/);

		const result = await extractWithOllama("source text", "https://example.com", {
			endpoint: "http://127.0.0.1:11434",
			model: "llama3",
			healthCheckMs: 100,
			timeoutMs: 100,
			fetchImpl: redirectingFetch,
		});

		expect(result.fields).toBeNull();
		expect(result.warnings[0]).toContain("could not be reached");
	});

	it("rejects immediately if signal is already aborted when calling requestWithTimeout", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			requestWithTimeout(fetch, "http://127.0.0.1:11434/api/tags", 1000, controller.signal),
		).rejects.toThrow();
	});

	it("aborts stalled response body reading when timeout expires", async () => {
		const stalledFetch: typeof fetch = async (url) => {
			if (String(url).endsWith("tags")) {
				return jsonResponse({ models: [] });
			}
			const stalledStream = new ReadableStream({
				pull() {
					return new Promise(() => {});
				},
			});
			return new Response(stalledStream, {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		};

		const result = await extractWithOllama("source text", "https://example.com", {
			endpoint: "http://127.0.0.1:11434",
			model: "llama3",
			healthCheckMs: 500,
			timeoutMs: 50,
			fetchImpl: stalledFetch,
		});

		expect(result.fields).toBeNull();
		expect(result.warnings[0]).toContain("timed out");
	});

	it("aborts stalled response body reading when parent signal aborts", async () => {
		const controller = new AbortController();

		const stalledFetch: typeof fetch = async (url) => {
			if (String(url).endsWith("tags")) {
				return jsonResponse({ models: [] });
			}
			const stalledStream = new ReadableStream({
				pull() {
					return new Promise(() => {
						setTimeout(() => controller.abort(), 20);
					});
				},
			});
			return new Response(stalledStream, {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		};

		const result = await extractWithOllama("source text", "https://example.com", {
			endpoint: "http://127.0.0.1:11434",
			model: "llama3",
			healthCheckMs: 500,
			timeoutMs: 5000,
			signal: controller.signal,
			fetchImpl: stalledFetch,
		});

		expect(result.fields).toBeNull();
		expect(result.cancelled).toBe(true);
	});

	it("rejects immediately if controller aborted before reading text", async () => {
		const fetchReturningImmediate: typeof fetch = async () => {
			return new Response("hello");
		};
		const response = await requestWithTimeout(
			fetchReturningImmediate,
			"http://127.0.0.1:11434/api/tags",
			1,
			undefined,
		);
		await new Promise((r) => setTimeout(r, 10));
		await expect(response.text()).rejects.toThrow();
	});

	it("accepts a valid JSON body under the cap, but aborts and rejects valid JSON over the cap", async () => {
		const underCapJson = makeValidOllamaResponseJson(MAX_OLLAMA_RESPONSE_BYTES - 64 * 1024);
		const overCapJson = makeValidOllamaResponseJson(MAX_OLLAMA_RESPONSE_BYTES + 64 * 1024);

		// Assert both are genuinely valid JSON bodies
		expect(() => JSON.parse(underCapJson)).not.toThrow();
		expect(() => JSON.parse(overCapJson)).not.toThrow();

		// 1. Under cap: chunked streaming succeeds completely
		const underCapFetch: typeof fetch = async (url) => {
			if (String(url).endsWith("tags")) {
				return jsonResponse({ models: [] });
			}
			return chunkedResponse(underCapJson);
		};

		const underCapResponse = await requestWithTimeout(
			underCapFetch,
			"http://127.0.0.1:11434/api/chat",
			2000,
			undefined,
		);
		const underCapParsed = (await underCapResponse.json()) as { message?: { content?: string } };
		expect(underCapParsed.message?.content).toBeDefined();

		// Also verify extractWithOllama succeeds when grounded
		const pageText = "Chicken Soup\n1 cup chicken broth\nBoil the broth.";
		const underCapResult = await extractWithOllama(pageText, "https://example.com", {
			endpoint: "http://127.0.0.1:11434",
			model: "llama3",
			healthCheckMs: 500,
			timeoutMs: 2000,
			fetchImpl: underCapFetch,
		});
		expect(underCapResult.fields).not.toBeNull();
		expect(underCapResult.fields?.title).toBe("Chicken Soup");

		// 2. Over cap: chunked streaming aborts as soon as 5 MB arrives and rejects with size cap error
		let chunksPulledAfterCap = 0;
		const overCapEncoder = new TextEncoder();
		const overCapBytes = overCapEncoder.encode(overCapJson);
		let offset = 0;
		const trackedStream = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (offset >= MAX_OLLAMA_RESPONSE_BYTES) {
					chunksPulledAfterCap++;
				}
				if (offset >= overCapBytes.byteLength) {
					controller.close();
					return;
				}
				const chunk = overCapBytes.subarray(offset, Math.min(overCapBytes.byteLength, offset + 64 * 1024));
				offset += chunk.byteLength;
				controller.enqueue(chunk);
			},
		});

		const overCapFetch: typeof fetch = async () => {
			return new Response(trackedStream, {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		};

		const overCapResponse = await requestWithTimeout(
			overCapFetch,
			"http://127.0.0.1:11434/api/chat",
			2000,
			undefined,
		);

		await expect(overCapResponse.json()).rejects.toThrow(/exceeded maximum allowed size/);
		// Chunks beyond the 5 MB mark must not be read into memory
		expect(chunksPulledAfterCap).toBeLessThanOrEqual(2);

		// Also verify extractWithOllama reports unreachable warning
		const overCapResult = await extractWithOllama(pageText, "https://example.com", {
			endpoint: "http://127.0.0.1:11434",
			model: "llama3",
			healthCheckMs: 500,
			timeoutMs: 2000,
			fetchImpl: overCapFetch,
		});
		expect(overCapResult.fields).toBeNull();
		expect(overCapResult.warnings[0]).toContain("could not be reached");
	});

	it("cleans up timer immediately on non-OK health and chat responses", async () => {
		const failingTagsFetch: typeof fetch = async () => {
			return jsonResponse({ error: "down" }, 503);
		};

		const result1 = await extractWithOllama("source text", "https://example.com", {
			endpoint: "http://127.0.0.1:11434",
			model: "llama3",
			healthCheckMs: 5000, // Long timer that must be cleaned up
			timeoutMs: 5000,
			fetchImpl: failingTagsFetch,
		});
		expect(result1.fields).toBeNull();
		expect(result1.warnings[0]).toContain("not reachable");

		const failingChatFetch: typeof fetch = async (url) => {
			if (String(url).endsWith("tags")) {
				return jsonResponse({ models: [] });
			}
			return jsonResponse({ error: "rejected" }, 500);
		};

		const result2 = await extractWithOllama("source text", "https://example.com", {
			endpoint: "http://127.0.0.1:11434",
			model: "llama3",
			healthCheckMs: 500,
			timeoutMs: 5000, // Long timer that must be cleaned up
			fetchImpl: failingChatFetch,
		});
		expect(result2.fields).toBeNull();
		expect(result2.warnings[0]).toContain("rejected");
	});
});
