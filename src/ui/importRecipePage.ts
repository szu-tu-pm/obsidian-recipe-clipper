import type { ImportActivity } from "../domain/extraction/importSession";
import { extractRecipeFromPage } from "../domain/extraction/urlClipper";
import type { UrlExtractionResult } from "../domain/extraction/types";
import type { PluginServices } from "../wrapper/PluginServiceAdapter";

const EXPLICIT_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function ensureHttpsUrl(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length === 0 || EXPLICIT_SCHEME.test(trimmed)) {
		return trimmed;
	}
	if (trimmed.startsWith("//")) {
		return `https:${trimmed}`;
	}
	return `https://${trimmed}`;
}

export async function importRecipePage(
	url: string,
	services: PluginServices,
	signal: AbortSignal,
	onProgress?: (phase: ImportActivity) => void,
	fetchImpl: typeof fetch = fetch,
): Promise<UrlExtractionResult> {
	const settings = services.getSettings();
	onProgress?.("fetching");
	const response = await fetchImpl(url, { signal });
	const html = await response.text();
	onProgress?.("extracting");
	return extractRecipeFromPage({
		html,
		pageUrl: url,
		httpStatus: response.status,
		signal,
		existingRecipes: services.listRecipes().map((recipe) => ({
			id: recipe.id,
			sourceUrl: recipe.sourceUrl,
			path: recipe.path,
		})),
		ollama: {
			endpoint: settings.ollamaEndpoint,
			model: settings.ollamaModel,
			lightweightModel: settings.ollamaLightweightModel,
			healthCheckMs: settings.ollamaHealthCheckMs,
			timeoutMs: settings.ollamaTimeoutMs,
		},
	});
}

export async function downloadSourceImage(
	url: string,
	signal?: AbortSignal,
	fetchImpl: typeof fetch = fetch,
): Promise<ArrayBuffer | null> {
	const response = await fetchImpl(url, { signal });
	if (!response.ok) {
		return null;
	}
	return response.arrayBuffer();
}

export function sourceImageFilename(url: string, index: number): string {
	try {
		const name = new URL(url).pathname.split("/").pop() ?? "";
		const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "");
		if (cleaned && /\.(jpe?g|png|webp|avif)$/i.test(cleaned)) {
			return cleaned;
		}
	} catch {
		// Fall through to a numbered name. Do not invent a title-based filename.
	}
	return `source-${index + 1}.jpg`;
}
