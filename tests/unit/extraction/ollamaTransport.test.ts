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

	it("rejects response bodies exceeding MAX_OLLAMA_RESPONSE_BYTES", async () => {
		const oversizedText = "x".repeat(MAX_OLLAMA_RESPONSE_BYTES + 10);
		const oversizedFetch: typeof fetch = async (url) => {
			if (String(url).endsWith("tags")) {
				return jsonResponse({ models: [] });
			}
			return new Response(oversizedText, {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		};

		const result = await extractWithOllama("source text", "https://example.com", {
			endpoint: "http://127.0.0.1:11434",
			model: "llama3",
			healthCheckMs: 500,
			timeoutMs: 500,
			fetchImpl: oversizedFetch,
		});

		expect(result.fields).toBeNull();
		expect(result.warnings[0]).toContain("could not be reached");
	});
});
