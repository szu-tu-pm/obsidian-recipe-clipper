import { parseIngredientLine } from "../aggregation/stage1LexicalParser";
import { splitFrontmatter, type YamlCodec } from "../schema/recipeMarkdown";
import {
	createManualRecipe,
	generateRecipeId,
	joinVaultPath,
	RECIPE_SCHEMA_VERSION,
	RECIPE_TYPE,
	recipeFrontmatterSchema,
	type RecipeDocument,
	type RecipeIngredient,
} from "../schema/recipeSchema";
import type { FrontmatterCachePort, VaultPort } from "../vault/vaultPort";
import { extractJsonLdRecipes } from "./jsonLdExtractor";
import { cleanText, parseServings } from "./text";
import type {
	Attribution,
	ExistingSourceRecipe,
	ExtractionCandidate,
	UrlExtractionFallback,
	UrlExtractionSuccess,
} from "./types";
import { findDuplicateSourceUrls } from "./urlClipper";

/**
 * Marker written by `clipper/recipe.web-clipper.json`.
 *
 * A clip reuses the recipe schema's own `type` field with a value the schema
 * rejects (`type` must be `recipe`). Every reader that validates recipes, such
 * as the indexer behind the collection and shopping lists, skips a clip without
 * any change, and existing recipe files need no new field or schemaVersion bump.
 * A clip becomes a recipe only when its review is saved, which rewrites the
 * note with `type: recipe` and a generated `rec_*` id.
 */
export const WEB_CLIP_TYPE = "recipe-clip" as const;

/** Frontmatter keys the template writes and this module reads. */
export const WEB_CLIP_FIELDS = [
	"schemaVersion",
	"type",
	"clippedAt",
	"title",
	"pageTitle",
	"sourceUrl",
	"author",
	"pageAuthor",
	"publisher",
	"siteName",
	"recipeYield",
	"prepTime",
	"cookTime",
	"totalTime",
	"cookingMethod",
	"image",
	"recipeIngredient",
	"recipeInstructions",
] as const;

export type WebClipReviewResult = UrlExtractionSuccess | UrlExtractionFallback;

export interface PendingWebClip {
	path: string;
	title: string;
}

export function isWebClip(frontmatter: unknown): boolean {
	return (
		!!frontmatter &&
		typeof frontmatter === "object" &&
		!Array.isArray(frontmatter) &&
		(frontmatter as Record<string, unknown>).type === WEB_CLIP_TYPE
	);
}

function isUnderFolder(path: string, folder: string): boolean {
	const prefix = joinVaultPath(folder);
	return path === prefix || path.startsWith(`${prefix}/`);
}

export function isPendingWebClip(
	path: string,
	frontmatter: unknown,
	recipesFolder: string,
	attachmentsFolder: string,
): boolean {
	return (
		path.endsWith(".md") &&
		isUnderFolder(path, recipesFolder) &&
		!isUnderFolder(path, attachmentsFolder) &&
		isWebClip(frontmatter)
	);
}

function pendingTitle(path: string, frontmatter: Record<string, unknown>): string {
	for (const key of ["title", "pageTitle"]) {
		const value = frontmatter[key];
		if (typeof value === "string" && cleanText(value)) {
			return cleanText(value);
		}
	}
	return path.split("/").pop()?.replace(/\.md$/, "") ?? path;
}

/** Clips in the recipes folder that have not been reviewed yet. */
export function listPendingWebClips(
	cache: FrontmatterCachePort,
	recipesFolder: string,
	attachmentsFolder: string,
): PendingWebClip[] {
	return cache
		.listMarkdown(recipesFolder)
		.filter((row) =>
			isPendingWebClip(row.path, row.frontmatter, recipesFolder, attachmentsFolder),
		)
		.map((row) => ({
			path: row.path,
			title: pendingTitle(row.path, row.frontmatter as Record<string, unknown>),
		}))
		.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * The clipper writes schema.org values as text. Arrays and objects arrive as
 * JSON text; decode them so the JSON-LD reader sees the original structure.
 */
function decodeClipValue(value: unknown): unknown {
	if (value == null) {
		return null;
	}
	if (typeof value !== "string") {
		return value;
	}
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}
	if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
		try {
			return JSON.parse(trimmed);
		} catch {
			return trimmed;
		}
	}
	return trimmed;
}

function textValue(value: unknown): string | null {
	if (typeof value === "string") {
		return cleanText(value) || null;
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return String(value);
	}
	return null;
}

function httpUrl(value: unknown): string | null {
	const text = textValue(value);
	if (!text) {
		return null;
	}
	try {
		const url = new URL(text);
		return url.protocol === "http:" || url.protocol === "https:" ? text : null;
	} catch {
		return null;
	}
}

/** Ingredient lines exactly as clipped: split into lines and trimmed, never merged or deduplicated. */
function clippedIngredientLines(value: unknown): string[] {
	const lines: string[] = [];
	const visit = (item: unknown): void => {
		if (typeof item === "string") {
			for (const line of item.split(/\r?\n/)) {
				const trimmed = line.trim();
				if (trimmed) {
					lines.push(trimmed);
				}
			}
			return;
		}
		if (typeof item === "number" && Number.isFinite(item)) {
			lines.push(String(item));
			return;
		}
		if (Array.isArray(item)) {
			for (const entry of item) {
				visit(entry);
			}
		}
	};
	visit(value);
	return lines;
}

function clippedAt(value: unknown, now: string): string {
	const text = textValue(value);
	if (text) {
		const time = Date.parse(text);
		if (Number.isFinite(time)) {
			return new Date(time).toISOString();
		}
	}
	return now;
}

export interface WebClipIntakeOptions {
	markdown: string;
	path: string;
	yaml: YamlCodec;
	existingRecipes?: ExistingSourceRecipe[];
	now?: () => string;
}

/**
 * Turn a clipped note into the same review result a URL import produces.
 * Nothing is written. The draft keeps the clip's path, so saving the review
 * replaces the clip note with a schema-valid recipe and never touches any
 * other recipe file.
 */
export function webClipToReviewResult(options: WebClipIntakeOptions): WebClipReviewResult {
	const { yaml: yamlText } = splitFrontmatter(options.markdown);
	if (!yamlText) {
		throw new Error("Web clip is missing YAML frontmatter.");
	}
	const raw = options.yaml.parse(yamlText);
	if (!isWebClip(raw)) {
		throw new Error(`Note is not a web clip (type must be ${WEB_CLIP_TYPE}).`);
	}
	const clip = raw as Record<string, unknown>;
	const now = options.now?.() ?? new Date().toISOString();
	const importedAt = clippedAt(clip.clippedAt, now);
	const warnings: string[] = [];

	const sourceUrl = httpUrl(clip.sourceUrl);
	if (!sourceUrl && textValue(clip.sourceUrl)) {
		warnings.push("The clipped source URL is not an http(s) address and was not kept.");
	}
	const ingredientsRaw = clippedIngredientLines(decodeClipValue(clip.recipeIngredient));
	const node: Record<string, unknown> = {
		"@type": "Recipe",
		name: decodeClipValue(clip.title),
		recipeIngredient: ingredientsRaw,
		recipeInstructions: decodeClipValue(clip.recipeInstructions),
		recipeYield: decodeClipValue(clip.recipeYield),
		prepTime: decodeClipValue(clip.prepTime),
		cookTime: decodeClipValue(clip.cookTime),
		totalTime: decodeClipValue(clip.totalTime),
		cookingMethod: decodeClipValue(clip.cookingMethod),
		author: decodeClipValue(clip.author),
		publisher: decodeClipValue(clip.publisher),
		image: decodeClipValue(clip.image),
	};
	// Relative image URLs resolve against the clipped page. Without one they are dropped.
	const fields = extractJsonLdRecipes([JSON.stringify(node)], sourceUrl ?? "about:blank")[0];

	const attribution: Attribution = {
		sourceUrl,
		author: fields?.author ?? textValue(clip.pageAuthor),
		siteName: fields?.siteName ?? textValue(clip.siteName),
	};
	const duplicates = findDuplicateSourceUrls(sourceUrl, options.existingRecipes ?? []);
	const title = fields?.title ?? textValue(clip.pageTitle);
	if (!title) {
		warnings.push("Title was not on the page.");
	}
	const resolvedTitle = title ?? "Untitled recipe";

	if (!fields) {
		warnings.push("The clip has no schema.org recipe data. Enter the recipe manually.");
		const manual = createManualRecipe(resolvedTitle);
		return {
			status: "manual-fallback",
			succeeded: false,
			reason: "unparsed",
			draft: {
				...manual,
				path: options.path,
				frontmatter: {
					...manual.frontmatter,
					sourceUrl: attribution.sourceUrl,
					author: attribution.author,
					siteName: attribution.siteName,
					importedAt,
					updatedAt: importedAt,
				},
			},
			attribution,
			duplicates,
			warnings,
		};
	}

	const ingredients = ingredientsRaw.map((line) => parseIngredientLine(line));
	const frontmatter = recipeFrontmatterSchema.parse({
		schemaVersion: RECIPE_SCHEMA_VERSION,
		type: RECIPE_TYPE,
		id: generateRecipeId(),
		title: resolvedTitle,
		sourceUrl: attribution.sourceUrl,
		author: attribution.author,
		siteName: attribution.siteName,
		importedAt,
		updatedAt: importedAt,
		extractionMethod: "json-ld",
		servings: parseServings(fields.servingsRaw),
		prepTimeMinutes: fields.prepTimeMinutes,
		cookTimeMinutes: fields.cookTimeMinutes,
		totalTimeMinutes: fields.totalTimeMinutes,
		cookingMethods: fields.cookingMethods,
		rating: null,
		images: [],
		ingredients,
	});
	const draft: RecipeDocument = {
		frontmatter,
		instructions: fields.instructions,
		notes: "",
		path: options.path,
		editedExternally: false,
	};
	const candidate: ExtractionCandidate = {
		title: resolvedTitle,
		ingredientsRaw,
		ingredients,
		instructions: fields.instructions,
		servings: frontmatter.servings,
		prepTimeMinutes: frontmatter.prepTimeMinutes,
		cookTimeMinutes: frontmatter.cookTimeMinutes,
		totalTimeMinutes: frontmatter.totalTimeMinutes,
		cookingMethods: frontmatter.cookingMethods,
		candidateImages: fields.images.slice(0, 5),
		attribution,
		extractionMethod: "json-ld",
		draft,
	};
	return {
		status: "extracted",
		succeeded: true,
		candidate,
		candidates: [candidate],
		duplicates,
		warnings,
	};
}

/** Read a clip from the vault. Returns null when the note is gone or is no longer a clip. */
export async function loadWebClipForReview(
	vault: VaultPort,
	yaml: YamlCodec,
	path: string,
	existingRecipes: ExistingSourceRecipe[],
	now?: () => string,
): Promise<WebClipReviewResult | null> {
	let markdown: string;
	try {
		markdown = await vault.read(path);
	} catch {
		return null;
	}
	try {
		return webClipToReviewResult({ markdown, path, yaml, existingRecipes, now });
	} catch {
		return null;
	}
}

export interface WebClipCorrections {
	ingredientsText: string;
	instructionsText: string;
	cookingMethodsText: string;
}

export function correctionsFromDraft(draft: RecipeDocument): WebClipCorrections {
	return {
		ingredientsText: draft.frontmatter.ingredients.map((item) => item.raw).join("\n"),
		instructionsText: draft.instructions.join("\n"),
		cookingMethodsText: draft.frontmatter.cookingMethods.join(", "),
	};
}

/**
 * Apply the user's review corrections. An unchanged line keeps its parsed
 * ingredient; a new or edited line is parsed again with the Stage 1 parser,
 * so `raw` is always the text the user confirmed and units stay as typed.
 */
export function applyWebClipCorrections(
	draft: RecipeDocument,
	corrections: WebClipCorrections,
): RecipeDocument {
	const unused = [...draft.frontmatter.ingredients];
	const ingredients: RecipeIngredient[] = corrections.ingredientsText
		.split(/\r?\n/)
		.map((line) => line.replace(/^\s*[-*+]\s+/, "").trim())
		.filter(Boolean)
		.map((line) => {
			const index = unused.findIndex((item) => item.raw === line);
			if (index === -1) {
				return parseIngredientLine(line);
			}
			const [kept] = unused.splice(index, 1);
			return kept as RecipeIngredient;
		});
	const instructions = corrections.instructionsText
		.split(/\r?\n/)
		.map((line) => line.replace(/^\s*\d+[.)]\s+/, "").trim())
		.filter(Boolean);
	const cookingMethods = corrections.cookingMethodsText
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
	return {
		...draft,
		instructions,
		frontmatter: { ...draft.frontmatter, ingredients, cookingMethods },
	};
}
