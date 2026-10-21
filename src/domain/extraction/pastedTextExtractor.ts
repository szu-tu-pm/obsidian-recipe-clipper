import {
	hasExplicitNumericQuantity,
	isNonNumericQualifier,
	parseIngredientLine,
} from "../aggregation/stage1LexicalParser";
import {
	generateIngredientId,
	generateRecipeId,
	RECIPE_SCHEMA_VERSION,
	RECIPE_TYPE,
	recipeFrontmatterSchema,
	type RecipeDocument,
	type RecipeIngredient,
} from "../schema/recipeSchema";
import {
	extractWithOllama,
	type OllamaExtractOptions,
	type OllamaExtractResult,
} from "./ollamaExtractor";
import { cleanText, parseDurationMinutes, parseServings } from "./text";
import type { ExistingSourceRecipe, ExtractedFields, UrlExtractionSuccess } from "./types";
import { findDuplicateSourceUrls } from "./urlClipper";

/**
 * Local, deterministic reader for recipe-shaped text pasted from an AI chat, an email, a
 * message or a note. It never calls a model and never invents a value: a field the text does
 * not state stays empty, and anything it cannot place is kept in Notes or reported as a warning.
 */

export const NO_SECTIONS_WARNING =
	"No Ingredients or Instructions section was found, so nothing was imported from the text. Add the recipe in the editor, or ask the local model to extract it.";

const EMPTY_INGREDIENTS_WARNING =
	"The ingredient list was empty. Chat pages often show ingredients in an interactive list that does not come through when copied. Copy the ingredient list from the visible page and paste again, or add the ingredients before saving. Nothing was taken from the steps.";

const MISSING_INGREDIENTS_WARNING =
	"No Ingredients section was found. Copy the ingredient list from the visible page and paste again, or add the ingredients before saving. Nothing was taken from the steps.";

export const PASTED_AI_ASSISTANTS: Record<string, string> = {
	"chatgpt.com": "ChatGPT",
	"claude.ai": "Claude",
	"gemini.google.com": "Gemini",
};

export function assistantNameForLink(link: string): string | null {
	const resolved = resolveSourceLink(link).url;
	if (!resolved) {
		return null;
	}
	const host = new URL(resolved).hostname.toLowerCase().replace(/^www\./, "");
	return PASTED_AI_ASSISTANTS[host] ?? null;
}

/** Keep only an http(s) link. Anything else is dropped with a warning. */
export function resolveSourceLink(link: string | null | undefined): {
	url: string | null;
	warning: string | null;
} {
	const trimmed = (link ?? "").trim();
	if (!trimmed) {
		return { url: null, warning: null };
	}
	const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
	try {
		const parsed = new URL(candidate);
		if (parsed.protocol === "http:" || parsed.protocol === "https:") {
			return { url: candidate, warning: null };
		}
	} catch {
		// Fall through to the warning below.
	}
	return {
		url: null,
		warning: `The source link "${trimmed}" is not an http(s) link, so it was not saved.`,
	};
}

// ---------------------------------------------------------------------------
// Chat noise
// ---------------------------------------------------------------------------

const INLINE_IMAGE_GROUP = /\b(?:image_group|navlist|product_entity)\s*\{[^}]*\}/g;
const CITATION_SPAN = /\uE200[^\uE201]*\uE201/g;
const PRIVATE_USE = /[\uE000-\uF8FF]/g;
const WIDGET_OPTION = /^(?:[-*\u2022]\s*)?\d+\s+servings?$/i;
const CURRENT_SELECTION = /^current selection unavailable\.?$/i;
const FOLLOW_UP =
	/^(?:(?:if you(?:'d)? (?:want|like),?\s+)?(?:i can|i could|i'd be happy to)\b|(?:would you like|do you want me to|want me to|shall i|should i)\b|let me know (?:if|what)\b)/i;
const LIST_ITEM = /^\s*(?:[-*\u2022]|\d+[.)])\s+/;

/**
 * Removes what a chat page adds around a recipe: image placeholders, the interactive
 * portion-size widget and follow-up offers such as "If you want, I can:".
 */
export function stripChatNoise(lines: string[]): string[] {
	const kept: string[] = [];
	let inWidget = false;
	let inOffer = false;
	for (const original of lines) {
		const line = original
			.replace(CITATION_SPAN, "")
			.replace(PRIVATE_USE, "")
			.replace(INLINE_IMAGE_GROUP, "");
		const trimmed = line.trim();
		const plain = trimmed.replace(/\*+/g, "").trim();
		if (original.trim() && !trimmed) {
			continue;
		}
		if (inWidget) {
			if (!trimmed || WIDGET_OPTION.test(plain) || CURRENT_SELECTION.test(plain)) {
				continue;
			}
			inWidget = false;
		}
		if (inOffer) {
			if (!trimmed || LIST_ITEM.test(trimmed)) {
				continue;
			}
			inOffer = false;
		}
		if (/^portion size:?$/i.test(plain)) {
			inWidget = true;
			continue;
		}
		if (CURRENT_SELECTION.test(plain)) {
			continue;
		}
		if (FOLLOW_UP.test(plain)) {
			inOffer = true;
			continue;
		}
		kept.push(line);
	}
	return kept;
}

// ---------------------------------------------------------------------------
// Ingredient lines
// ---------------------------------------------------------------------------

const PLACEHOLDER = "ITEM";
const NAME_FIRST_SPLIT = /^(.+?)\s+[—–]\s+(.+)$|^(.+?)\s+-\s+(.+)$/;
const LEADS_WITH_QUANTITY = /^\s*(?:\d|[¼½¾⅐-⅞])/;
const LEADING_OPTIONAL = /^optional\b\s*:?\s*/i;

function stripMarkdown(text: string): string {
	return text.replace(/\*\*|__/g, "");
}

function stripListMarker(text: string): string {
	return text
		.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s+/, "")
		.replace(/^\[[ xX]\]\s+/, "")
		.trim();
}

function lowerFirstIfSentenceCase(name: string): string {
	return /^\p{Lu}/u.test(name) && !/\p{Lu}/u.test(name.slice(1))
		? name.charAt(0).toLowerCase() + name.slice(1)
		: name;
}

function pastedIngredient(
	raw: string,
	fields: Partial<RecipeIngredient> & { name: string },
): RecipeIngredient {
	return {
		id: generateIngredientId(),
		raw,
		canonicalId: null,
		quantity: null,
		quantityMax: null,
		unit: null,
		unitSystem: null,
		preparation: null,
		qualifiers: [],
		optional: false,
		parseConfidence: null,
		...fields,
	};
}

/** `Name — quantity, preparation`: the name comes first and the quantity after the dash. */
function parseNameFirst(raw: string, left: string, right: string): RecipeIngredient {
	const parentheticals: string[] = [];
	for (const match of left.split("(").slice(1)) {
		parentheticals.push(match.split(")")[0].trim());
	}
	let name = cleanText(left.replace(/\([^)]*\)/g, " "));
	const optionalPrefix = LEADING_OPTIONAL.test(name);
	name = lowerFirstIfSentenceCase(cleanText(name.replace(LEADING_OPTIONAL, "")).replace(/:$/, ""));
	const optional = optionalPrefix || /\boptional\b/i.test(raw);
	const noteQualifiers = parentheticals.filter(Boolean);

	if (!hasExplicitNumericQuantity(right)) {
		return pastedIngredient(raw, {
			name,
			qualifiers: [...noteQualifiers, cleanText(right)],
			optional,
			parseConfidence: isNonNumericQualifier(right) ? "non_numeric" : "ambiguous",
		});
	}

	// Let the shared parser read the quantity part with a stand-in name, so a name with
	// commas ("Boneless, skinless chicken thighs") is never split into name and preparation.
	const split = right.search(/[,(]/);
	const head = split === -1 ? right : right.slice(0, split).trim();
	const tail = split === -1 ? "" : right.slice(split).trim();
	const synthetic = `${head} ${PLACEHOLDER}${tail.startsWith(",") ? tail : ` ${tail}`}`.trim();
	const parsed = parseIngredientLine(synthetic);
	// An unlisted unit word ("bottle") ends up in front of the stand-in name. Keep it, as typed.
	const leftover = parsed.name.replace(new RegExp(`\\s*${PLACEHOLDER}$`), "").trim();
	const unitWord = !parsed.unit && /^[a-z]+$/i.test(leftover) ? leftover : null;
	// A quantity must lead the part after the dash. "about 2 cups" or "enough for 2" is kept as
	// written instead of being read as exactly 2.
	if (parsed.quantity === null || !LEADS_WITH_QUANTITY.test(head)) {
		return pastedIngredient(raw, {
			name,
			qualifiers: [...noteQualifiers, cleanText(right)],
			optional,
			parseConfidence: "ambiguous",
		});
	}
	return pastedIngredient(raw, {
		name,
		quantity: parsed.quantity,
		quantityMax: parsed.quantityMax,
		unit: unitWord ?? parsed.unit,
		unitSystem: unitWord ? "unknown" : parsed.unitSystem,
		preparation: parsed.preparation,
		qualifiers: [...noteQualifiers, ...parsed.qualifiers],
		optional,
		parseConfidence: parsed.parseConfidence,
	});
}

/**
 * Reads one ingredient line, either `Name — quantity, preparation` (as AI assistants write
 * them) or `quantity unit name, preparation`. Units stay as typed and `raw` keeps the line
 * as pasted.
 */
export function parsePastedIngredient(line: string): RecipeIngredient {
	const text = cleanText(stripMarkdown(stripListMarker(line)));
	const split = text.match(NAME_FIRST_SPLIT);
	if (split) {
		const left = (split[1] ?? split[3] ?? "").trim();
		const right = (split[2] ?? split[4] ?? "").trim();
		if (left && right && !LEADS_WITH_QUANTITY.test(left)) {
			return parseNameFirst(text, left, right);
		}
	}
	if (LEADING_OPTIONAL.test(text)) {
		const parsed = parseIngredientLine(text.replace(LEADING_OPTIONAL, ""));
		return { ...parsed, raw: text, optional: true };
	}
	return parseIngredientLine(text);
}

// ---------------------------------------------------------------------------
// Sections, steps, times and servings
// ---------------------------------------------------------------------------

const EMOJI_PREFIX = new RegExp(
	"^[\\s\\p{Extended_Pictographic}\\p{Emoji_Presentation}\\uFE0F\\u200D\\u20E3]+",
	"u",
);
const HORIZONTAL_RULE = /^(?:[-*_]\s*){3,}$/;
const INGREDIENTS_HEADING = /^(?:the\s+)?ingredients?(?:\s+list)?$/i;
const INSTRUCTIONS_HEADING =
	/^(?:(?:step[- ]by[- ]step\s+)?(?:instructions?|directions?|method|preparation|procedure|steps)|how to make(?:\s+it)?)$/i;
const NOTES_WORDS = /\b(?:notes?|tips?|storage|variations?|substitutions?|nutrition|macros?)\b/i;

const DURATION =
	"\\d+(?:\\.\\d+)?(?:\\s*(?:[–—-]|to)\\s*\\d+(?:\\.\\d+)?)?\\s*(?:hours?|hrs?|minutes?|mins?)(?:\\s*(?:and\\s*)?\\d+\\s*(?:minutes?|mins?))?";
const TIME_SEGMENT = new RegExp(
	`^(?:(prep(?:aration)?|cook(?:ing)?|total)?(?:\\s*time)?\\s*[:\\-–]?\\s*)(${DURATION})$`,
	"i",
);
const SERVINGS_SEGMENT =
	/^(?:(?:servings?|serves|makes|yields?)\b\s*:?\s*\S.*|\d+(?:\.\d+)?(?:\s*(?:[–—-]|to)\s*\d+(?:\.\d+)?)?\s+servings?(?:\s.*)?)$/i;
const RANGE = /\d\s*(?:[–—-]|to)\s*\d/;
const PHASE = new RegExp(
	`^(\\d+)\\s+(?:\\*\\*(.+?)\\*\\*|(.+?))(?:\\s*\\(?(${DURATION})\\)?)?\\s*$`,
	"i",
);

function cleanTitle(text: string): string | null {
	const title = cleanText(stripMarkdown(text).replace(/^#+\s*/, "").replace(EMOJI_PREFIX, ""));
	return title || null;
}

function sectionKind(text: string): "ingredients" | "instructions" | null {
	const normalized = cleanText(
		stripMarkdown(text).replace(/^#+\s*/, "").replace(EMOJI_PREFIX, "").replace(/:$/, ""),
	);
	if (INGREDIENTS_HEADING.test(normalized)) {
		return "ingredients";
	}
	if (INSTRUCTIONS_HEADING.test(normalized)) {
		return "instructions";
	}
	return null;
}

function isBoldOnly(text: string): boolean {
	return /^\*\*[^*]+\*\*:?$/.test(text);
}

function detectPhase(text: string): string | null {
	if (LIST_ITEM.test(text)) {
		return null;
	}
	const match = text.match(PHASE);
	if (!match) {
		return null;
	}
	const bold = match[2];
	const time = match[4];
	if (!bold && !time) {
		return null;
	}
	const name = cleanText(stripMarkdown(bold ?? match[3] ?? "")).replace(/[\s:–—-]+$/, "");
	return name || null;
}

interface MetaResult {
	servings: { raw: string; amount: number | null } | null;
	prepTimeMinutes: number | null;
	cookTimeMinutes: number | null;
	totalTimeMinutes: number | null;
	notes: string[];
	rest: string[];
	warnings: string[];
}

/** Times and servings from the lines between the title and the first section. */
function readMeta(lines: string[]): MetaResult {
	const meta: MetaResult = {
		servings: null,
		prepTimeMinutes: null,
		cookTimeMinutes: null,
		totalTimeMinutes: null,
		notes: [],
		rest: [],
		warnings: [],
	};
	const fieldFor = {
		prep: "prepTimeMinutes",
		cook: "cookTimeMinutes",
		total: "totalTimeMinutes",
	} as const;
	const label = { prep: "Prep time", cook: "Cook time", total: "Time" } as const;
	for (const line of lines) {
		const text = stripListMarker(stripMarkdown(line));
		const segments = text
			.split(/\s{2,}|\t|\s[·|\u2022]\s|\)\s*\(/)
			.map((segment) => segment.replace(/^[([]+|[)\]]+$/g, "").trim())
			.filter(Boolean);
		const unread: string[] = [];
		for (const segment of segments) {
			const time = segment.match(TIME_SEGMENT);
			if (time) {
				const kind = /^prep/i.test(time[1] ?? "") ? "prep" : /^cook/i.test(time[1] ?? "") ? "cook" : "total";
				const field = fieldFor[kind];
				const minutes = RANGE.test(time[2]) ? null : parseDurationMinutes(time[2]);
				// Only a duration with an explicit Prep, Cook or Total label fills a time field.
				if (!time[1]) {
					meta.notes.push(`Time as written: ${time[2]}`);
					meta.warnings.push(
						`The time "${time[2]}" has no Prep, Cook or Total label, so no time field was filled. The original text is in Notes.`,
					);
					continue;
				}
				if (minutes !== null && meta[field] === null) {
					meta[field] = minutes;
					continue;
				}
				meta.notes.push(`${label[kind]} as written: ${time[2]}`);
				meta.warnings.push(
					RANGE.test(time[2])
						? `${label[kind]} "${time[2]}" is a range, so it was not saved as a single number. The field is empty and the original text is in Notes.`
						: `${label[kind]} "${time[2]}" could not be saved as minutes. The field is empty and the original text is in Notes.`,
				);
				continue;
			}
			if (segment.length <= 40 && SERVINGS_SEGMENT.test(segment) && meta.servings === null) {
				meta.servings = parseServings(segment);
				continue;
			}
			unread.push(segment);
		}
		if (segments.length > 0 && unread.length === segments.length) {
			meta.rest.push(cleanText(text));
		} else {
			meta.rest.push(...unread);
		}
	}
	return meta;
}

export interface PasteParserParts {
	/** Drops chat noise from the pasted lines. */
	stripNoise(lines: string[]): string[];
	/** Reads one ingredient line. */
	parseIngredient(line: string): RecipeIngredient;
}

export const DEFAULT_PARSER_PARTS: PasteParserParts = {
	stripNoise: stripChatNoise,
	parseIngredient: parsePastedIngredient,
};

export interface ParsedPaste {
	title: string | null;
	ingredients: RecipeIngredient[];
	instructions: string[];
	servings: { raw: string; amount: number | null } | null;
	prepTimeMinutes: number | null;
	cookTimeMinutes: number | null;
	totalTimeMinutes: number | null;
	notes: string;
	warnings: string[];
	/** Whether an Ingredients or Instructions heading was found, even if nothing is under it. */
	sections: { ingredients: boolean; instructions: boolean };
}

export function normalizePastedText(text: string): string {
	return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");
}

export function parsePastedText(
	text: string,
	parts: PasteParserParts = DEFAULT_PARSER_PARTS,
): ParsedPaste {
	const lines = parts.stripNoise(normalizePastedText(text).split("\n"));
	type Mode = "preamble" | "ingredients" | "instructions" | "other";
	let mode = "preamble" as Mode;
	const preamble: Array<{ text: string; heading: boolean }> = [];
	const ingredients: RecipeIngredient[] = [];
	const instructions: string[] = [];
	const notes: string[] = [];
	const sections = { ingredients: false, instructions: false };
	let phase: string | null = null;
	let listSeen = false;

	const enter = (kind: "ingredients" | "instructions"): void => {
		mode = kind;
		sections[kind] = true;
		phase = null;
		listSeen = false;
	};

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || HORIZONTAL_RULE.test(trimmed)) {
			continue;
		}
		const markdownHeading = trimmed.match(/^#{1,6}\s+(.*)$/);
		const kind = sectionKind(trimmed);
		if (kind) {
			enter(kind);
			continue;
		}
		if (markdownHeading) {
			const heading = cleanText(stripMarkdown(markdownHeading[1] ?? ""));
			if (mode === "preamble") {
				preamble.push({ text: heading, heading: true });
			} else {
				mode = "other";
				notes.push(heading);
			}
			continue;
		}
		if (mode === "preamble") {
			preamble.push({ text: trimmed, heading: false });
		} else if (mode === "ingredients") {
			if (isBoldOnly(trimmed) || /:$/.test(trimmed)) {
				continue; // A group label such as "For the sauce:".
			}
			ingredients.push(parts.parseIngredient(stripListMarker(trimmed)));
		} else if (mode === "instructions") {
			if (isBoldOnly(trimmed)) {
				const label = cleanText(stripMarkdown(trimmed)).replace(/:$/, "");
				if (NOTES_WORDS.test(label)) {
					mode = "other";
					notes.push(label);
				} else {
					phase = label;
					listSeen = true;
				}
				continue;
			}
			const named = detectPhase(trimmed);
			if (named) {
				phase = named;
				listSeen = true;
				continue;
			}
			const isListItem = LIST_ITEM.test(trimmed) || /^step\s*\d+\s*[:.)-]/i.test(trimmed);
			if (!isListItem && listSeen) {
				mode = "other";
				notes.push(cleanText(stripMarkdown(trimmed)));
				continue;
			}
			listSeen ||= isListItem;
			const step = cleanText(
				stripMarkdown(trimmed.replace(/^\s*(?:step\s*\d+\s*[:.)-]|[-*\u2022]|\d+[.)])\s*/i, "")),
			);
			if (step) {
				instructions.push(phase ? `${phase}: ${step}` : step);
			}
		} else {
			notes.push(cleanText(stripMarkdown(trimmed)));
		}
	}

	const chosenHeading = preamble.findIndex((entry) => entry.heading);
	const titleIndex = chosenHeading !== -1 ? chosenHeading : 0;
	const title = preamble.length > 0 ? cleanTitle(preamble[titleIndex]?.text ?? "") : null;
	const leftovers = preamble.filter((_entry, index) => index !== titleIndex).map((entry) => entry.text);

	const warnings: string[] = [];
	if (!sections.ingredients && !sections.instructions) {
		warnings.push(NO_SECTIONS_WARNING);
		return {
			title,
			ingredients: [],
			instructions: [],
			servings: null,
			prepTimeMinutes: null,
			cookTimeMinutes: null,
			totalTimeMinutes: null,
			notes: "",
			warnings,
			sections,
		};
	}
	const meta = readMeta(leftovers);
	warnings.push(...meta.warnings);
	if (sections.ingredients && ingredients.length === 0) {
		warnings.push(EMPTY_INGREDIENTS_WARNING);
	} else if (!sections.ingredients) {
		warnings.push(MISSING_INGREDIENTS_WARNING);
	}
	if (instructions.length === 0) {
		warnings.push("No instruction steps were found in the text.");
	}
	return {
		title,
		ingredients,
		instructions,
		servings: meta.servings,
		prepTimeMinutes: meta.prepTimeMinutes,
		cookTimeMinutes: meta.cookTimeMinutes,
		totalTimeMinutes: meta.totalTimeMinutes,
		// No blank lines: the note body is read back line by line and blank lines would vanish.
		notes: [...meta.notes, ...meta.rest, ...notes].join("\n"),
		warnings,
		sections,
	};
}

// ---------------------------------------------------------------------------
// Review result
// ---------------------------------------------------------------------------

export interface PastedRecipeInput {
	text: string;
	/** Link the user gave. Only an http(s) link is kept. */
	sourceLink?: string | null;
	/** Name of the AI assistant, only when the user marked the paste as AI-written. */
	generatedBy?: string | null;
	now?: string;
	existingRecipes?: ExistingSourceRecipe[];
}

function toResult(
	parsed: ParsedPaste,
	input: PastedRecipeInput,
	extraWarnings: string[] = [],
): UrlExtractionSuccess {
	const now = input.now ?? new Date().toISOString();
	const link = resolveSourceLink(input.sourceLink);
	const warnings = [...parsed.warnings, ...extraWarnings];
	if (link.warning) {
		warnings.push(link.warning);
	}
	const title = parsed.title ?? "Untitled recipe";
	if (!parsed.title) {
		warnings.push("No title was found in the text.");
	}
	const generatedBy = input.generatedBy?.trim();
	const frontmatter = recipeFrontmatterSchema.safeParse({
		schemaVersion: RECIPE_SCHEMA_VERSION,
		type: RECIPE_TYPE,
		id: generateRecipeId(),
		title,
		sourceUrl: link.url,
		author: null,
		siteName: null,
		importedAt: now,
		updatedAt: now,
		extractionMethod: "pasted-text",
		servings: parsed.servings,
		prepTimeMinutes: parsed.prepTimeMinutes,
		cookTimeMinutes: parsed.cookTimeMinutes,
		totalTimeMinutes: parsed.totalTimeMinutes,
		cookingMethods: [],
		rating: null,
		images: [],
		ingredients: parsed.ingredients,
		...(generatedBy ? { generatedBy } : {}),
	});
	if (!frontmatter.success) {
		throw new Error("Pasted recipe did not match the recipe schema.");
	}
	const draft: RecipeDocument = {
		frontmatter: frontmatter.data,
		instructions: parsed.instructions,
		notes: parsed.notes,
		editedExternally: false,
	};
	const candidate = {
		title,
		ingredientsRaw: parsed.ingredients.map((ingredient) => ingredient.raw),
		ingredients: parsed.ingredients,
		instructions: parsed.instructions,
		servings: parsed.servings,
		prepTimeMinutes: parsed.prepTimeMinutes,
		cookTimeMinutes: parsed.cookTimeMinutes,
		totalTimeMinutes: parsed.totalTimeMinutes,
		cookingMethods: [],
		candidateImages: [],
		attribution: { sourceUrl: link.url, author: null, siteName: null },
		extractionMethod: "pasted-text" as const,
		ingredientDisagreements: [],
		draft,
	};
	return {
		status: "extracted",
		succeeded: true,
		candidate,
		candidates: [candidate],
		duplicates: findDuplicateSourceUrls(link.url, input.existingRecipes ?? []),
		warnings,
	};
}

/** Parse pasted text locally into a recipe for the review-before-save screen. */
export function extractPastedRecipe(
	input: PastedRecipeInput,
	parts: PasteParserParts = DEFAULT_PARSER_PARTS,
): UrlExtractionSuccess {
	return toResult(parsePastedText(input.text, parts), input);
}

export type ModelExtract = (
	sourceText: string,
	pageUrl: string,
	options: OllamaExtractOptions,
) => Promise<OllamaExtractResult>;

export const MODEL_EXTRACTION_WARNING =
	"The local model extracted these fields. Only values that appear in the pasted text were kept. Check them before saving.";

/**
 * Like `extractPastedRecipe`, but when the text has no Ingredients or Instructions section it
 * asks the local model to extract the recipe. The model's answer is grounded by
 * `ollamaExtractor.ts`, which keeps only values that appear in the pasted text.
 */
export async function extractPastedRecipeWithModel(
	input: PastedRecipeInput,
	ollama: OllamaExtractOptions,
	extract: ModelExtract = extractWithOllama,
	parts: PasteParserParts = DEFAULT_PARSER_PARTS,
): Promise<{ result: UrlExtractionSuccess; cancelled: boolean }> {
	const parsed = parsePastedText(input.text, parts);
	if (parsed.sections.ingredients || parsed.sections.instructions) {
		return { result: toResult(parsed, input), cancelled: false };
	}
	const link = resolveSourceLink(input.sourceLink);
	const answer = await extract(normalizePastedText(input.text), link.url ?? "pasted text", ollama);
	if (answer.cancelled || !answer.fields) {
		return { result: toResult(parsed, input, answer.warnings), cancelled: answer.cancelled };
	}
	const fields: ExtractedFields = answer.fields;
	const fromModel: ParsedPaste = {
		title: fields.title ? cleanTitle(fields.title) : parsed.title,
		ingredients: fields.ingredientsRaw.map((line) => parts.parseIngredient(line)),
		instructions: fields.instructions,
		servings: parseServings(fields.servingsRaw),
		prepTimeMinutes: fields.prepTimeMinutes,
		cookTimeMinutes: fields.cookTimeMinutes,
		totalTimeMinutes: fields.totalTimeMinutes,
		notes: "",
		warnings: parsed.warnings.filter((warning) => warning !== NO_SECTIONS_WARNING),
		sections: { ingredients: false, instructions: false },
	};
	return {
		result: toResult(fromModel, input, [...answer.warnings, MODEL_EXTRACTION_WARNING]),
		cancelled: false,
	};
}
