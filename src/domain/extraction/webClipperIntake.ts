import { parseIngredientLine } from "../aggregation/stage1LexicalParser";
import {
	serializeRecipeFile,
	splitFrontmatter,
	type YamlCodec,
} from "../schema/recipeMarkdown";
import {
	createManualRecipe,
	fnv1aHex,
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

/** Frontmatter keys the template writes and this module reads. All are single values. */
export const WEB_CLIP_FIELDS = [
	"schemaVersion",
	"type",
	"clippedAt",
	"title",
	"pageTitle",
	"sourceUrl",
	"author",
	"authorName",
	"authorNames",
	"pageAuthor",
	"publisher",
	"siteName",
	"recipeYield",
	"prepTime",
	"cookTime",
	"totalTime",
	"cookingMethod",
	"image",
	"imageUrl",
	"imageFirstUrl",
	"instructionTypes",
] as const;

/**
 * Body sections the template writes. Multi-item fields live in the body, one
 * item per line, because a bare array key only renders its first item.
 */
export const WEB_CLIP_SECTIONS = {
	/** `recipeIngredient[*]|list`: every ingredient string. */
	ingredients: "## Ingredients",
	/** `recipeInstructions[*].text|list:numbered`: HowToStep text, one line per item. */
	instructions: "## Instructions",
	/** Bare `recipeIngredient`: a single ingredient string when the page has no array. */
	ingredientText: "### Ingredient text",
	/** `recipeInstructions[*]|list:numbered`: plain-string steps, one line per item. */
	instructionItems: "### Instruction items",
	/** Bare `recipeInstructions`: a single instructions string. */
	instructionText: "### Instruction text",
} as const;

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

type SectionKey = keyof typeof WEB_CLIP_SECTIONS;

/** Lines under each known heading, up to the next heading or `%%` comment fence. */
function readSections(body: string): Partial<Record<SectionKey, string[]>> {
	const byHeading = new Map<string, SectionKey>(
		Object.entries(WEB_CLIP_SECTIONS).map(([key, heading]) => [heading, key as SectionKey]),
	);
	const sections: Partial<Record<SectionKey, string[]>> = {};
	let current: SectionKey | null = null;
	for (const rawLine of body.replace(/\r\n/g, "\n").split("\n")) {
		const trimmed = rawLine.trim();
		if (/^#{1,6}\s/.test(trimmed) || trimmed === "%%") {
			current = byHeading.get(trimmed) ?? null;
			if (current) {
				sections[current] = [];
			}
			continue;
		}
		if (current) {
			sections[current]?.push(rawLine);
		}
	}
	return sections;
}

const LIST_MARKER = /^(?:[-*+]|\d+[.)])(?:\s+|$)/;

/** List items in order. Empty items are kept so two lists over the same array line up. */
function listItems(lines: string[] | undefined): string[] {
	const items: string[] = [];
	for (const line of lines ?? []) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		items.push(trimmed.replace(LIST_MARKER, "").trim());
	}
	return items;
}

function textLines(lines: string[] | undefined): string[] {
	return (lines ?? []).map((line) => line.trim()).filter(Boolean);
}

const OBJECT_PLACEHOLDER = /^\[object [A-Za-z]+\]$/;

/** Step text inside a decoded HowToStep, HowToSection or plain string. */
function stepTexts(value: unknown): string[] {
	if (typeof value === "string") {
		return value.split(/\n+/).map((line) => line.trim()).filter(Boolean);
	}
	if (Array.isArray(value)) {
		return value.flatMap(stepTexts);
	}
	if (!value || typeof value !== "object") {
		return [];
	}
	const record = value as Record<string, unknown>;
	if (typeof record.text === "string") {
		return stepTexts(record.text);
	}
	if (record.itemListElement != null) {
		return stepTexts(record.itemListElement);
	}
	return [];
}

/**
 * Read one rendered item. An object the clipper printed as JSON is decoded; one
 * printed as `[object Object]` cannot be read and is reported, never guessed.
 */
function readItem(item: string, steps: boolean): { texts: string[]; unreadable: boolean } {
	if (!item) {
		return { texts: [], unreadable: false };
	}
	if (OBJECT_PLACEHOLDER.test(item)) {
		return { texts: [], unreadable: true };
	}
	if (item.startsWith("{") || item.startsWith("[")) {
		try {
			const decoded: unknown = JSON.parse(item);
			if (decoded && typeof decoded === "object") {
				const texts = steps ? stepTexts(decoded) : clippedLines(decoded);
				return { texts, unreadable: texts.length === 0 };
			}
		} catch {
			// Plain text that happens to start with a bracket.
		}
	}
	return { texts: [item], unreadable: false };
}

/** Strings from a decoded value: split into lines and trimmed, never merged or deduplicated. */
function clippedLines(value: unknown): string[] {
	if (typeof value === "string") {
		return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return [String(value)];
	}
	return Array.isArray(value) ? value.flatMap(clippedLines) : [];
}

function readIngredients(
	sections: Partial<Record<SectionKey, string[]>>,
	warnings: string[],
): string[] {
	let unreadable = 0;
	const fromList = listItems(sections.ingredients).flatMap((item) => {
		const read = readItem(item, false);
		unreadable += read.unreadable ? 1 : 0;
		return read.texts;
	});
	let lines = fromList;
	if (lines.length === 0) {
		lines = textLines(sections.ingredientText).flatMap((item) => {
			const read = readItem(item, false);
			unreadable += read.unreadable ? 1 : 0;
			return read.texts;
		});
	}
	if (unreadable > 0) {
		warnings.push(
			`${unreadable} clipped ingredient ${unreadable === 1 ? "entry" : "entries"} could not be read. Add ${unreadable === 1 ? "it" : "them"} in review.`,
		);
	}
	return lines;
}

function readInstructions(
	sections: Partial<Record<SectionKey, string[]>>,
	instructionTypes: string | null,
	warnings: string[],
): string[] {
	const byText = listItems(sections.instructions);
	const byItem = listItems(sections.instructionItems);
	let unreadable = 0;
	const read = (item: string): string[] => {
		const result = readItem(item, true);
		unreadable += result.unreadable ? 1 : 0;
		return result.texts;
	};
	let steps: string[];
	if (byText.length > 0 && byText.length === byItem.length) {
		// Both lists walk the same array, so item i is the same step in each:
		// HowToStep text from the first list, a plain string from the second.
		steps = byText.flatMap((text, index) => (text ? [text] : read(byItem[index] ?? "")));
	} else if (byText.some(Boolean)) {
		steps = byText.filter(Boolean);
		if (byText.some((text) => !text)) {
			warnings.push("Some clipped steps were not HowToStep text and may be missing. Check them in review.");
		}
	} else {
		steps = byItem.flatMap(read);
		if (steps.length === 0) {
			steps = textLines(sections.instructionText).flatMap(read);
		}
	}
	const types = (instructionTypes ?? "").split(",").map((type) => type.trim());
	if (types.includes("HowToSection")) {
		warnings.push(
			steps.length === 0
				? "The page groups its steps into sections, which the clipper template cannot read. Add the steps in review."
				: "The page groups its steps into sections. Check that every step was clipped.",
		);
	}
	if (unreadable > 0) {
		warnings.push(
			`${unreadable} clipped ${unreadable === 1 ? "step" : "steps"} could not be read. Add ${unreadable === 1 ? "it" : "them"} in review.`,
		);
	}
	return steps;
}

/** A name from plain text, or from an object the clipper printed as JSON. */
function nameValue(value: unknown): string | null {
	const decoded = decodeClipValue(value);
	if (typeof decoded === "string") {
		if (OBJECT_PLACEHOLDER.test(decoded)) {
			return null;
		}
		const names = decoded.split(",").map((name) => cleanText(name)).filter(Boolean);
		return names.length > 0 ? names.join(", ") : null;
	}
	if (typeof decoded === "number") {
		return String(decoded);
	}
	if (Array.isArray(decoded)) {
		const names = decoded.map(nameValue).filter((name): name is string => Boolean(name));
		return names.length > 0 ? names.join(", ") : null;
	}
	if (decoded && typeof decoded === "object") {
		return nameValue((decoded as Record<string, unknown>).name);
	}
	return null;
}

/** An image URL from plain text, or from an ImageObject the clipper printed as JSON. */
function imageValue(value: unknown): string | null {
	const decoded = decodeClipValue(value);
	if (typeof decoded === "string") {
		return OBJECT_PLACEHOLDER.test(decoded) ? null : decoded;
	}
	if (Array.isArray(decoded)) {
		return imageValue(decoded[0]);
	}
	if (decoded && typeof decoded === "object") {
		const record = decoded as Record<string, unknown>;
		return imageValue(record.url ?? record.contentUrl ?? null);
	}
	return null;
}

function scalarValue(value: unknown): string | null {
	const decoded = decodeClipValue(value);
	if (typeof decoded === "number" && Number.isFinite(decoded)) {
		return String(decoded);
	}
	if (typeof decoded !== "string" || OBJECT_PLACEHOLDER.test(decoded)) {
		return null;
	}
	return cleanText(decoded) || null;
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
	const sections = readSections(splitFrontmatter(options.markdown).body);
	const ingredientsRaw = readIngredients(sections, warnings);
	const instructions = readInstructions(sections, textValue(clip.instructionTypes), warnings);
	const image = [clip.imageUrl, clip.imageFirstUrl, clip.image]
		.map(imageValue)
		.find((value): value is string => Boolean(value));
	const node: Record<string, unknown> = {
		"@type": "Recipe",
		name: scalarValue(clip.title),
		recipeIngredient: ingredientsRaw,
		recipeInstructions: instructions,
		recipeYield: scalarValue(clip.recipeYield),
		prepTime: scalarValue(clip.prepTime),
		cookTime: scalarValue(clip.cookTime),
		totalTime: scalarValue(clip.totalTime),
		cookingMethod: scalarValue(clip.cookingMethod),
		author: nameValue(clip.authorNames) ?? nameValue(clip.authorName) ?? nameValue(clip.author),
		publisher: nameValue(clip.publisher),
		image: image ?? null,
	};
	const fields = extractJsonLdRecipes([JSON.stringify(node)], sourceUrl ?? "about:blank")[0];

	const attribution: Attribution = {
		sourceUrl,
		author: fields?.author ?? nameValue(clip.pageAuthor),
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
		// A clip note holds only the structured text, so there is no visible list to compare.
		ingredientDisagreements: [],
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

/** A clip opened for review, with the revision of the note it was read from. */
export interface LoadedWebClip {
	path: string;
	revision: string;
	review: WebClipReviewResult;
}

export function webClipRevision(markdown: string): string {
	return `${markdown.length}:${fnv1aHex(markdown)}`;
}

/** Read a clip from the vault. Returns null when the note is gone or is no longer a clip. */
export async function loadWebClipForReview(
	vault: VaultPort,
	yaml: YamlCodec,
	path: string,
	existingRecipes: ExistingSourceRecipe[],
	now?: () => string,
): Promise<LoadedWebClip | null> {
	let markdown: string;
	try {
		markdown = await vault.read(path);
	} catch {
		return null;
	}
	try {
		const review = webClipToReviewResult({ markdown, path, yaml, existingRecipes, now });
		return { path, revision: webClipRevision(markdown), review };
	} catch {
		return null;
	}
}

export type WebClipSaveOutcome =
	| { status: "saved"; recipe: RecipeDocument }
	| { status: "changed"; message: string }
	| { status: "failed"; message: string };

export const CLIP_CHANGED_MESSAGE =
	"This web clip changed after the review opened, so nothing was saved. Reload the clip to review the newer version.";

/**
 * Save a reviewed clip in place, but only over the exact note the review was
 * read from. The note is re-read immediately before writing; if it changed or
 * is gone, nothing is written. If the write throws or does not read back
 * exactly, the original clip text is written back, so a failed save never
 * leaves a partial note.
 */
function sameNoteText(left: string, right: string): boolean {
	return left.replace(/\r\n/g, "\n") === right.replace(/\r\n/g, "\n");
}

export async function saveReviewedWebClip(
	vault: VaultPort,
	yaml: YamlCodec,
	path: string,
	revision: string,
	recipe: RecipeDocument,
	now: () => string = () => new Date().toISOString(),
): Promise<WebClipSaveOutcome> {
	let original: string;
	try {
		original = await vault.read(path);
	} catch {
		return { status: "changed", message: CLIP_CHANGED_MESSAGE };
	}
	if (webClipRevision(original) !== revision) {
		return { status: "changed", message: CLIP_CHANGED_MESSAGE };
	}
	const next: RecipeDocument = {
		...recipe,
		path,
		editedExternally: false,
		frontmatter: { ...recipe.frontmatter, updatedAt: now() },
	};
	const markdown = serializeRecipeFile(next, yaml);
	try {
		await vault.write(path, markdown);
		if (!sameNoteText(await vault.read(path), markdown)) {
			throw new Error("The saved note did not read back as written.");
		}
		return { status: "saved", recipe: next };
	} catch (error) {
		const detail = error instanceof Error ? error.message : "The note could not be written.";
		let restored = false;
		try {
			await vault.write(path, original);
			restored = sameNoteText(await vault.read(path), original);
		} catch {
			restored = false;
		}
		return {
			status: "failed",
			message: restored
				? `The recipe could not be saved (${detail}). The web clip is unchanged and still needs review.`
				: `The recipe could not be saved (${detail}), and the web clip could not be restored. Check ${path}.`,
		};
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
