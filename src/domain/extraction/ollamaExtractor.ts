import { z } from "zod";
import type { ExtractedFields } from "./types";
import {
	cleanIngredient,
	cleanInstruction,
	cleanText,
	durationIsGrounded,
	sourceIncludes,
	uniqueStrings,
} from "./text";

export const OLLAMA_RECIPE_EXTRACTION_PROMPT = `You extract one recipe from untrusted webpage text. Return JSON only.
Rules:
- Copy ingredient lines and instruction steps verbatim from the page text.
- Do not invent ingredients, quantities, units, steps, times, authors, titles, or cooking methods.
- Do not summarize, translate, or convert units.
- Keep unicode fractions and ranges as they appear.
- If a field is missing on the page, use null or an empty array.
- ingredientsRaw is one original ingredient line per entry, with no added words.
- instructions is one original step per entry, with no added words.
- prepTimeMinutes, cookTimeMinutes, and totalTimeMinutes are integers only when the page states that duration. Otherwise null.
- A stated "1 hour 30 minutes" may be returned as 90. Do not guess a duration that is not stated.`;

export const OLLAMA_RECIPE_JSON_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["title", "ingredientsRaw", "instructions"],
	properties: {
		title: { type: "string" },
		ingredientsRaw: { type: "array", items: { type: "string" } },
		instructions: { type: "array", items: { type: "string" } },
		author: { type: ["string", "null"] },
		siteName: { type: ["string", "null"] },
		servingsRaw: { type: ["string", "null"] },
		prepTimeMinutes: { type: ["integer", "null"] },
		cookTimeMinutes: { type: ["integer", "null"] },
		totalTimeMinutes: { type: ["integer", "null"] },
		cookingMethods: { type: "array", items: { type: "string" } },
	},
} as const;

const nullableString = z.union([z.string(), z.null()]);
const nullableMinutes = z.union([z.number().int().nonnegative(), z.null()]);

export const ollamaExtractionSchema = z
	.object({
		title: z.string(),
		ingredientsRaw: z.array(z.string()),
		instructions: z.array(z.string()),
		author: nullableString.optional(),
		siteName: nullableString.optional(),
		servingsRaw: nullableString.optional(),
		prepTimeMinutes: nullableMinutes.optional(),
		cookTimeMinutes: nullableMinutes.optional(),
		totalTimeMinutes: nullableMinutes.optional(),
		cookingMethods: z.array(z.string()).optional(),
	})
	.strip();

export interface OllamaExtractOptions {
	endpoint: string;
	model: string;
	lightweightModel?: string;
	useLightweight?: boolean;
	healthCheckMs: number;
	timeoutMs: number;
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

export interface OllamaExtractResult {
	fields: ExtractedFields | null;
	warnings: string[];
	cancelled: boolean;
}

export function isLocalOllamaEndpoint(endpoint: string): boolean {
	try {
		const url = new URL(endpoint);
		const host = url.hostname.replace(/^\[|\]$/g, "");
		return (
			url.protocol === "http:" &&
			(host === "127.0.0.1" || host === "localhost" || host === "::1")
		);
	} catch {
		return false;
	}
}

export function resolveOllamaModel(options: OllamaExtractOptions): string {
	if (options.useLightweight && options.lightweightModel) {
		return options.lightweightModel;
	}
	return options.model;
}

export function buildOllamaChatBody(model: string, pageUrl: string, pageText: string) {
	return {
		model,
		stream: false,
		format: OLLAMA_RECIPE_JSON_SCHEMA,
		options: { temperature: 0 },
		messages: [
			{ role: "system", content: OLLAMA_RECIPE_EXTRACTION_PROMPT },
			{
				role: "user",
				content: `Page URL: ${pageUrl}\n\nPage text:\n${pageText}`,
			},
		],
	};
}

function groundedMinutes(value: number | null | undefined, source: string): number | null {
	if (value == null) {
		return null;
	}
	return durationIsGrounded(value, source) ? value : null;
}

export function groundOllamaExtraction(
	value: z.infer<typeof ollamaExtractionSchema>,
	source: string,
): ExtractedFields | null {
	const ingredientsRaw = uniqueStrings(
		value.ingredientsRaw
			.map((line) => cleanIngredient(line))
			.filter((line) => sourceIncludes(source, line)),
	);
	const instructions = uniqueStrings(
		value.instructions
			.map((line) => cleanInstruction(line))
			.filter((line) => sourceIncludes(source, line)),
	);
	if (ingredientsRaw.length === 0 && instructions.length === 0) {
		return null;
	}
	const servingsRaw =
		value.servingsRaw && sourceIncludes(source, value.servingsRaw)
			? cleanText(value.servingsRaw)
			: null;
	const author =
		value.author && sourceIncludes(source, value.author) ? cleanText(value.author) : null;
	const siteName =
		value.siteName && sourceIncludes(source, value.siteName)
			? cleanText(value.siteName)
			: null;
	const title =
		value.title && sourceIncludes(source, value.title) ? cleanText(value.title) : null;
	const cookingMethods = uniqueStrings(
		(value.cookingMethods ?? [])
			.map((method) => cleanText(method))
			.filter((method) => sourceIncludes(source, method)),
	);
	return {
		title,
		ingredientsRaw,
		instructions,
		servingsRaw,
		prepTimeMinutes: groundedMinutes(value.prepTimeMinutes, source),
		cookTimeMinutes: groundedMinutes(value.cookTimeMinutes, source),
		totalTimeMinutes: groundedMinutes(value.totalTimeMinutes, source),
		cookingMethods,
		author,
		siteName,
		sourceUrl: null,
		images: [],
		extractionMethod: "ollama",
	};
}

export function parseModelContent(content: string): unknown {
	const trimmed = content
		.trim()
		.replace(/^```(?:json)?/i, "")
		.replace(/```$/i, "")
		.trim();
	return JSON.parse(trimmed);
}

export const MAX_OLLAMA_RESPONSE_BYTES = 5 * 1024 * 1024;

export type CleanupResponse = Response & { cleanup: () => void };

export async function readBodyWithCap(
	response: Response,
	maxBytes: number,
	controller: AbortController,
): Promise<string> {
	if (controller.signal.aborted) {
		throw new DOMException("The operation was aborted", "AbortError");
	}
	if (response.body && typeof response.body.getReader === "function") {
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let totalBytes = 0;
		let result = "";
		try {
			while (true) {
				const readPromise = reader.read();
				const abortPromise = new Promise<never>((_, reject) => {
					if (controller.signal.aborted) {
						reject(new DOMException("The operation was aborted", "AbortError"));
					} else {
						controller.signal.addEventListener(
							"abort",
							() => reject(new DOMException("The operation was aborted", "AbortError")),
							{ once: true },
						);
					}
				});
				const { done, value } = await Promise.race([readPromise, abortPromise]);
				if (done) {
					break;
				}
				if (value) {
					totalBytes += value.byteLength;
					if (totalBytes > maxBytes) {
						controller.abort();
						await reader.cancel().catch(() => {});
						throw new Error(
							`Ollama response exceeded maximum allowed size of ${maxBytes} bytes.`,
						);
					}
					result += decoder.decode(value, { stream: true });
				}
			}
			result += decoder.decode();
			return result;
		} finally {
			reader.releaseLock?.();
		}
	}
	const rawTextPromise = response.text();
	const abortPromise = new Promise<never>((_, reject) => {
		if (controller.signal.aborted) {
			reject(new DOMException("The operation was aborted", "AbortError"));
		} else {
			controller.signal.addEventListener(
				"abort",
				() => reject(new DOMException("The operation was aborted", "AbortError")),
				{ once: true },
			);
		}
	});
	const text = await Promise.race([rawTextPromise, abortPromise]);
	if (new TextEncoder().encode(text).byteLength > maxBytes) {
		controller.abort();
		throw new Error(`Ollama response exceeded maximum allowed size of ${maxBytes} bytes.`);
	}
	return text;
}

export async function requestWithTimeout(
	fetchImpl: typeof fetch,
	url: string,
	timeoutMs: number,
	signal: AbortSignal | undefined,
	init?: RequestInit,
): Promise<CleanupResponse> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	timer.unref?.();
	const onParentAbort = () => controller.abort();
	if (signal) {
		if (signal.aborted) {
			controller.abort();
		} else {
			signal.addEventListener("abort", onParentAbort, { once: true });
		}
	}
	let cleanedUp = false;
	const cleanup = () => {
		if (cleanedUp) {
			return;
		}
		cleanedUp = true;
		clearTimeout(timer);
		if (signal) {
			signal.removeEventListener("abort", onParentAbort);
		}
	};
	try {
		const response = (await fetchImpl(url, {
			...init,
			redirect: "error",
			signal: controller.signal,
		})) as CleanupResponse;

		response.cleanup = cleanup;

		let cachedText: string | null = null;
		response.text = async () => {
			if (cachedText !== null) {
				return cachedText;
			}
			try {
				cachedText = await readBodyWithCap(response, MAX_OLLAMA_RESPONSE_BYTES, controller);
				return cachedText;
			} finally {
				cleanup();
			}
		};
		response.json = async () => {
			try {
				const text = await response.text();
				return JSON.parse(text);
			} finally {
				cleanup();
			}
		};
		return response;
	} catch (error) {
		cleanup();
		throw error;
	}
}

export function isAbortError(error: unknown): boolean {
	return (
		(error instanceof DOMException && error.name === "AbortError") ||
		(error instanceof Error && error.name === "AbortError")
	);
}

export async function extractWithOllama(
	sourceText: string,
	pageUrl: string,
	options: OllamaExtractOptions,
): Promise<OllamaExtractResult> {
	const warnings: string[] = [];
	if (options.signal?.aborted) {
		return { fields: null, warnings, cancelled: true };
	}
	const endpoint = options.endpoint.replace(/\/+$/, "");
	if (!isLocalOllamaEndpoint(endpoint)) {
		warnings.push("Ollama endpoint is not local; cloud models are disabled.");
		return { fields: null, warnings, cancelled: false };
	}
	const fetchImpl = options.fetchImpl ?? fetch;
	const model = resolveOllamaModel(options);
	try {
		const health = await requestWithTimeout(
			fetchImpl,
			`${endpoint}/api/tags`,
			options.healthCheckMs,
			options.signal,
		);
		if (!health.ok) {
			health.cleanup();
			warnings.push("Local Ollama is not reachable.");
			return { fields: null, warnings, cancelled: false };
		}
		await health.text().catch(() => "");
		const body = buildOllamaChatBody(model, pageUrl, sourceText);
		const chat = await requestWithTimeout(fetchImpl, `${endpoint}/api/chat`, options.timeoutMs, options.signal, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		if (!chat.ok) {
			chat.cleanup();
			warnings.push("Local Ollama rejected the extraction request.");
			return { fields: null, warnings, cancelled: false };
		}
		const payload = (await chat.json()) as { message?: { content?: unknown } };
		const content = payload.message?.content;
		if (typeof content !== "string" || !content.trim()) {
			warnings.push("Local Ollama returned an empty extraction.");
			return { fields: null, warnings, cancelled: false };
		}
		let modelJson: unknown;
		try {
			modelJson = parseModelContent(content);
		} catch {
			warnings.push("Local Ollama returned JSON that failed schema validation.");
			return { fields: null, warnings, cancelled: false };
		}
		const parsed = ollamaExtractionSchema.safeParse(modelJson);
		if (!parsed.success) {
			warnings.push("Local Ollama returned JSON that failed schema validation.");
			return { fields: null, warnings, cancelled: false };
		}
		const fields = groundOllamaExtraction(parsed.data, sourceText);
		if (!fields) {
			warnings.push("Local Ollama output was not grounded in the page text.");
		}
		return { fields, warnings, cancelled: false };
	} catch (error) {
		if (options.signal?.aborted) {
			return { fields: null, warnings, cancelled: true };
		}
		if (isAbortError(error)) {
			warnings.push("Local Ollama timed out or was cancelled.");
			return { fields: null, warnings, cancelled: false };
		}
		warnings.push("Local Ollama could not be reached.");
		return { fields: null, warnings, cancelled: false };
	}
}
