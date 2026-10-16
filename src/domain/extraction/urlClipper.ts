import { parseIngredientLine } from "../aggregation/stage1LexicalParser";
import {
	createManualRecipe,
	generateRecipeId,
	RECIPE_SCHEMA_VERSION,
	RECIPE_TYPE,
	recipeFrontmatterSchema,
	type RecipeDocument,
} from "../schema/recipeSchema";
import { extractAttribution } from "./attributionExtractor";
import { extractDomHeuristicRecipes } from "./domHeuristicExtractor";
import { extractStructuredRecipes } from "./jsonLdExtractor";
import { extractWithOllama, type OllamaExtractOptions } from "./ollamaExtractor";
import { cleanText, normalizeRecipeSourceUrl, parseServings } from "./text";
import type {
	Attribution,
	DuplicateMatch,
	ExistingSourceRecipe,
	ExtractedFields,
	ExtractionCandidate,
	FallbackReason,
	UrlExtractionFallback,
	UrlExtractionResult,
	UrlExtractionSelection,
	UrlExtractionSuccess,
} from "./types";
import { hasExtractedContent, isCompleteExtraction } from "./types";
import { elementText, MAX_HTML_CHARS, pageText, parseUntrustedHtml } from "./untrustedHtml";

export interface ClipPageOptions {
	html: string;
	pageUrl: string;
	httpStatus?: number;
	selectionIndex?: number;
	signal?: AbortSignal;
	ollama?: OllamaExtractOptions | null;
	now?: () => string;
	existingRecipes?: ExistingSourceRecipe[];
	excludeRecipeId?: string;
}

const BLOCKED_STATUS = new Set([401, 403, 404, 410, 451]);

export function findDuplicateSourceUrls(
	sourceUrl: string | null,
	existing: ExistingSourceRecipe[],
	excludeRecipeId?: string,
): DuplicateMatch[] {
	const normalized = sourceUrl ? normalizeRecipeSourceUrl(sourceUrl) : null;
	if (!normalized) {
		return [];
	}
	const matches: DuplicateMatch[] = [];
	for (const recipe of existing) {
		if (excludeRecipeId && recipe.id === excludeRecipeId) {
			continue;
		}
		if (!recipe.sourceUrl) {
			continue;
		}
		if (normalizeRecipeSourceUrl(recipe.sourceUrl) !== normalized) {
			continue;
		}
		matches.push({
			id: recipe.id,
			sourceUrl: recipe.sourceUrl,
			path: recipe.path,
		});
	}
	return matches;
}

export function selectExtractionCandidate(
	result: UrlExtractionSelection,
	index: number,
): UrlExtractionSuccess | UrlExtractionSelection {
	const candidate = result.candidates[index];
	if (!candidate) {
		return result;
	}
	return {
		status: "extracted",
		succeeded: true,
		candidate,
		candidates: result.candidates,
		duplicates: result.duplicates,
		warnings: result.warnings,
	};
}

function dedupeMatches(matches: DuplicateMatch[]): DuplicateMatch[] {
	const seen = new Set<string>();
	const result: DuplicateMatch[] = [];
	for (const match of matches) {
		if (seen.has(match.id)) {
			continue;
		}
		seen.add(match.id);
		result.push(match);
	}
	return result;
}

function blockedReason(status: number | undefined): FallbackReason | null {
	if (status == null) {
		return null;
	}
	if (status === 402) {
		return "paywalled";
	}
	if (BLOCKED_STATUS.has(status) || status >= 500) {
		return "inaccessible";
	}
	return null;
}

function detectFallbackReason(
	document: Document,
	httpStatus: number | undefined,
	hasVideoEmbed: boolean,
): FallbackReason {
	const blocked = blockedReason(httpStatus);
	if (blocked) {
		return blocked;
	}
	const text = cleanText(document.body?.textContent ?? "");
	if (hasVideoEmbed && !/ingredient/i.test(text)) {
		return "video-only";
	}
	if (hasPaywallMarker(document, text) && text.length < 2500) {
		return "paywalled";
	}
	if (text.length < 40) {
		return "inaccessible";
	}
	return "unparsed";
}

function hasPaywallMarker(document: Document, text: string): boolean {
	for (const node of document.querySelectorAll("[class], [id], [data-paywall]")) {
		const blob = `${node.getAttribute("class") || ""} ${node.getAttribute("id") || ""}`;
		if (/paywall/i.test(blob) || node.hasAttribute("data-paywall")) {
			return true;
		}
	}
	return /subscribe to (read|continue|unlock)|for subscribers only|sign in to keep reading/i.test(
		text,
	);
}

function resolveTitle(
	recipeTitle: string | null,
	document: Document,
): { title: string; placeholder: boolean } {
	const fromRecipe = cleanText(recipeTitle ?? "");
	if (fromRecipe) {
		return { title: fromRecipe, placeholder: false };
	}
	const og = cleanText(
		document.querySelector("meta[property='og:title']")?.getAttribute("content") ?? "",
	);
	if (og) {
		return { title: og, placeholder: false };
	}
	const heading = elementText(document.querySelector("h1"));
	if (heading) {
		return { title: heading, placeholder: false };
	}
	const docTitle = cleanText(document.title || "");
	if (docTitle) {
		return { title: docTitle, placeholder: false };
	}
	return { title: "Untitled recipe", placeholder: true };
}

function buildDraft(
	fields: ExtractedFields,
	attribution: Attribution,
	title: string,
	now: string,
): RecipeDocument {
	const servings = parseServings(fields.servingsRaw);
	const frontmatter = {
		schemaVersion: RECIPE_SCHEMA_VERSION,
		type: RECIPE_TYPE,
		id: generateRecipeId(),
		title,
		sourceUrl: attribution.sourceUrl,
		author: attribution.author,
		siteName: attribution.siteName,
		importedAt: now,
		updatedAt: now,
		extractionMethod: fields.extractionMethod,
		servings,
		prepTimeMinutes: fields.prepTimeMinutes,
		cookTimeMinutes: fields.cookTimeMinutes,
		totalTimeMinutes: fields.totalTimeMinutes,
		cookingMethods: fields.cookingMethods,
		rating: null,
		images: [],
		ingredients: fields.ingredientsRaw.map((raw) => parseIngredientLine(raw)),
	};
	const parsed = recipeFrontmatterSchema.safeParse(frontmatter);
	if (!parsed.success) {
		throw new Error("Extracted recipe did not match the recipe schema.");
	}
	return {
		frontmatter: parsed.data,
		instructions: fields.instructions,
		notes: "",
		editedExternally: false,
	};
}

function toCandidate(
	fields: ExtractedFields,
	document: Document,
	pageUrl: string,
	ollamaAttribution: { author: string | null; siteName: string | null } | null,
	now: string,
	warnings: string[],
): ExtractionCandidate {
	const structured =
		fields.extractionMethod === "json-ld" || fields.extractionMethod === "microdata"
			? fields
			: null;
	const attribution = extractAttribution(
		document,
		pageUrl,
		structured,
		fields.extractionMethod === "ollama" ? ollamaAttribution : null,
	);
	if (fields.extractionMethod === "dom-heuristic") {
		attribution.author ||= fields.author;
		attribution.siteName ||= fields.siteName;
	}
	const resolved = resolveTitle(fields.title, document);
	if (resolved.placeholder) {
		warnings.push("Title was not on the page.");
	}
	const draft = buildDraft(fields, attribution, resolved.title, now);
	return {
		title: resolved.title,
		ingredientsRaw: fields.ingredientsRaw,
		ingredients: draft.frontmatter.ingredients,
		instructions: fields.instructions,
		servings: draft.frontmatter.servings,
		prepTimeMinutes: fields.prepTimeMinutes,
		cookTimeMinutes: fields.cookTimeMinutes,
		totalTimeMinutes: fields.totalTimeMinutes,
		cookingMethods: fields.cookingMethods,
		candidateImages: fields.images.slice(0, 5),
		attribution,
		extractionMethod: fields.extractionMethod,
		draft,
	};
}

function manualDraft(
	document: Document,
	pageUrl: string,
	now: string,
	warnings: string[],
): { draft: RecipeDocument; attribution: Attribution } {
	const attribution = extractAttribution(document, pageUrl, null, null);
	const resolved = resolveTitle(null, document);
	if (resolved.placeholder) {
		warnings.push("Title was not on the page.");
	}
	const draft = createManualRecipe(resolved.title);
	return {
		attribution,
		draft: {
			...draft,
			frontmatter: {
				...draft.frontmatter,
				title: resolved.title,
				sourceUrl: attribution.sourceUrl,
				author: attribution.author,
				siteName: attribution.siteName,
				importedAt: now,
				updatedAt: now,
				extractionMethod: "manual",
			},
		},
	};
}

function fallbackResult(
	document: Document,
	pageUrl: string,
	reason: FallbackReason,
	now: string,
	duplicates: DuplicateMatch[],
	warnings: string[],
): UrlExtractionFallback {
	const manual = manualDraft(document, pageUrl, now, warnings);
	return {
		status: "manual-fallback",
		succeeded: false,
		reason,
		draft: manual.draft,
		attribution: manual.attribution,
		duplicates,
		warnings,
	};
}

function chooseFields(structured: ExtractedFields[], dom: ExtractedFields[]): ExtractedFields[] {
	const completeStructured = structured.filter(isCompleteExtraction);
	if (completeStructured.length > 0) {
		return completeStructured;
	}
	const completeDom = dom.filter(isCompleteExtraction);
	if (completeDom.length > 0) {
		return completeDom;
	}
	const partialStructured = structured.filter(hasExtractedContent);
	if (partialStructured.length > 0) {
		return partialStructured;
	}
	return dom.filter(hasExtractedContent);
}

export async function extractRecipeFromPage(options: ClipPageOptions): Promise<UrlExtractionResult> {
	const now = options.now?.() ?? new Date().toISOString();
	const warnings: string[] = [];
	if (options.signal?.aborted) {
		const empty = parseUntrustedHtml("<html><head><title></title></head><body></body></html>");
		const duplicates = findDuplicateSourceUrls(
			options.pageUrl,
			options.existingRecipes ?? [],
			options.excludeRecipeId,
		);
		return fallbackResult(empty.document, options.pageUrl, "cancelled", now, duplicates, warnings);
	}

	let parsed: ReturnType<typeof parseUntrustedHtml>;
	try {
		parsed = parseUntrustedHtml(options.html || "");
	} catch (error) {
		warnings.push(error instanceof Error ? error.message : "HTML could not be parsed.");
		parsed = parseUntrustedHtml("<html><body></body></html>");
	}
	if (parsed.truncated) {
		warnings.push(`Page HTML was truncated to ${MAX_HTML_CHARS} characters.`);
	}

	const duplicatesFor = (sourceUrl: string | null) =>
		findDuplicateSourceUrls(sourceUrl, options.existingRecipes ?? [], options.excludeRecipeId);

	const blocked = blockedReason(options.httpStatus);
	if (blocked) {
		const manual = manualDraft(parsed.document, options.pageUrl, now, warnings);
		return {
			status: "manual-fallback",
			succeeded: false,
			reason: blocked,
			draft: manual.draft,
			attribution: manual.attribution,
			duplicates: duplicatesFor(manual.attribution.sourceUrl),
			warnings,
		};
	}

	const structured = extractStructuredRecipes(
		parsed.jsonLdBlocks,
		parsed.document,
		options.pageUrl,
	);
	if (options.signal?.aborted) {
		return fallbackResult(
			parsed.document,
			options.pageUrl,
			"cancelled",
			now,
			duplicatesFor(options.pageUrl),
			warnings,
		);
	}
	const dom = extractDomHeuristicRecipes(parsed.document, options.pageUrl);
	let fields = chooseFields(structured, dom);
	let ollamaAttribution: { author: string | null; siteName: string | null } | null = null;

	const tiersMissedContent = fields.length === 0;
	if (tiersMissedContent && options.ollama) {
		const ollama = await extractWithOllama(pageText(parsed.document), options.pageUrl, {
			...options.ollama,
			signal: options.signal,
		});
		warnings.push(...ollama.warnings);
		if (ollama.cancelled || options.signal?.aborted) {
			return fallbackResult(
				parsed.document,
				options.pageUrl,
				"cancelled",
				now,
				duplicatesFor(options.pageUrl),
				warnings,
			);
		}
		if (ollama.fields) {
			fields = [ollama.fields];
			ollamaAttribution = { author: ollama.fields.author, siteName: ollama.fields.siteName };
		}
	}

	if (fields.length === 0) {
		const manual = manualDraft(parsed.document, options.pageUrl, now, warnings);
		return {
			status: "manual-fallback",
			succeeded: false,
			reason: detectFallbackReason(
				parsed.document,
				options.httpStatus,
				parsed.hasVideoEmbed,
			),
			draft: manual.draft,
			attribution: manual.attribution,
			duplicates: duplicatesFor(manual.attribution.sourceUrl),
			warnings,
		};
	}

	const singleStructured = structured.length === 1 ? structured[0] : null;
	const candidates = fields.map((recipe) =>
		toCandidate(
			recipe,
			parsed.document,
			options.pageUrl,
			recipe.extractionMethod === "ollama" ? ollamaAttribution : null,
			now,
			warnings,
		),
	);
	if (singleStructured && candidates.length === 1 && candidates[0]?.extractionMethod !== "json-ld" && candidates[0]?.extractionMethod !== "microdata") {
		const attribution = extractAttribution(
			parsed.document,
			options.pageUrl,
			singleStructured,
			null,
		);
		const candidate = candidates[0];
		candidate.attribution = {
			sourceUrl: attribution.sourceUrl ?? candidate.attribution.sourceUrl,
			author: attribution.author ?? candidate.attribution.author,
			siteName: attribution.siteName ?? candidate.attribution.siteName,
		};
		candidate.draft = {
			...candidate.draft,
			frontmatter: {
				...candidate.draft.frontmatter,
				sourceUrl: candidate.attribution.sourceUrl,
				author: candidate.attribution.author,
				siteName: candidate.attribution.siteName,
			},
		};
	}

	const duplicates = dedupeMatches(
		candidates.flatMap((item) => duplicatesFor(item.attribution.sourceUrl)),
	);
	if (candidates.length > 1 && options.selectionIndex == null) {
		return {
			status: "needs-selection",
			succeeded: false,
			candidates,
			duplicates,
			warnings,
		};
	}
	const index = candidates.length === 1 ? 0 : options.selectionIndex ?? 0;
	const candidate = candidates[index];
	if (!candidate) {
		return {
			status: "needs-selection",
			succeeded: false,
			candidates,
			duplicates,
			warnings,
		};
	}
	return {
		status: "extracted",
		succeeded: true,
		candidate,
		candidates,
		duplicates,
		warnings,
	};
}
