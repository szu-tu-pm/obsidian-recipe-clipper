import { z } from "zod";

export const RECIPE_SCHEMA_VERSION = 2 as const;
export const RECIPE_SCHEMA_VERSION_V1 = 1 as const;
export const RECIPE_TYPE = "recipe" as const;

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RECIPE_ID_PATTERN = /^rec_[0-9A-HJKMNP-TV-Z]{26}$/;
const INGREDIENT_ID_PATTERN = /^ing_[0-9A-HJKMNP-TV-Z]{26}$/;

function encodeCrockford(value: number, length: number): string {
	let result = "";
	let remaining = value;
	for (let i = 0; i < length; i++) {
		result = CROCKFORD[remaining % 32] + result;
		remaining = Math.floor(remaining / 32);
	}
	return result;
}

function randomCrockford(length: number): string {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	let result = "";
	for (const byte of bytes) {
		result += CROCKFORD[byte % 32];
	}
	return result;
}

export function generateRecipeId(now = Date.now()): string {
	return `rec_${encodeCrockford(now, 10)}${randomCrockford(16)}`;
}

export function generateIngredientId(now = Date.now()): string {
	return `ing_${encodeCrockford(now, 10)}${randomCrockford(16)}`;
}

export const extractionMethodSchema = z.enum([
	"json-ld",
	"microdata",
	"dom-heuristic",
	"ollama",
	"manual",
]);

export const unitSystemSchema = z.enum(["metric", "imperial", "unknown"]);

export const parseConfidenceSchema = z.enum([
	"exact",
	"range",
	"non_numeric",
	"ambiguous",
]);

export const recipeIdSchema = z.string().regex(RECIPE_ID_PATTERN);
export const ingredientIdSchema = z.string().regex(INGREDIENT_ID_PATTERN);

export const servingsSchema = z.object({
	raw: z.string(),
	amount: z.number().positive().nullable(),
});

export const recipeImageSchema = z.object({
	path: z.string().min(1),
	alt: z.string().default(""),
	sourceUrl: z.string().nullable().default(null),
	isPrimary: z.boolean().default(false),
});

export const recipeIngredientSchema = z.object({
	id: ingredientIdSchema,
	raw: z.string(),
	name: z.string(),
	canonicalId: z.string().nullable().default(null),
	quantity: z.number().nullable().default(null),
	quantityMax: z.number().nullable().default(null),
	unit: z.string().nullable().default(null),
	unitSystem: unitSystemSchema.nullable().default(null),
	preparation: z.string().nullable().default(null),
	qualifiers: z.array(z.string()).default([]),
	optional: z.boolean().default(false),
	parseConfidence: parseConfidenceSchema.nullable().default(null),
});

export const ratingSchema = z.union([
	z.literal(1),
	z.literal(2),
	z.literal(3),
	z.literal(4),
	z.literal(5),
	z.null(),
]);

/**
 * Present only on a translated recipe. Holds the text the translation replaced
 * so it can be reverted. Optional, so existing files stay valid at schemaVersion 2.
 */
export const recipeTranslationSchema = z.object({
	language: z.string().min(1),
	translatedAt: z.string().min(1),
	promptVersion: z.string().min(1),
	original: z.object({
		title: z.string().min(1),
		ingredients: z.array(z.object({ id: ingredientIdSchema, raw: z.string() })),
		instructions: z.array(z.string()),
	}),
});

export const recipeFrontmatterSchema = z.object({
	schemaVersion: z.literal(RECIPE_SCHEMA_VERSION),
	type: z.literal(RECIPE_TYPE),
	id: recipeIdSchema,
	title: z.string().min(1),
	sourceUrl: z.string().nullable().default(null),
	author: z.string().nullable().default(null),
	siteName: z.string().nullable().default(null),
	importedAt: z.string().min(1),
	updatedAt: z.string().min(1),
	extractionMethod: extractionMethodSchema,
	servings: servingsSchema.nullable().default(null),
	prepTimeMinutes: z.number().int().nonnegative().nullable().default(null),
	cookTimeMinutes: z.number().int().nonnegative().nullable().default(null),
	totalTimeMinutes: z.number().int().nonnegative().nullable().default(null),
	cookingMethods: z.array(z.string()).default([]),
	rating: ratingSchema.default(null),
	images: z.array(recipeImageSchema).max(5).default([]),
	ingredients: z.array(recipeIngredientSchema).default([]),
	bodyHash: z.string().optional(),
	// Keep last: bodyHash is computed over key order, and new keys are appended.
	translation: recipeTranslationSchema.optional(),
});

export type ExtractionMethod = z.infer<typeof extractionMethodSchema>;
export type UnitSystem = z.infer<typeof unitSystemSchema>;
export type ParseConfidence = z.infer<typeof parseConfidenceSchema>;
export type RecipeImage = z.infer<typeof recipeImageSchema>;
export type RecipeIngredient = z.infer<typeof recipeIngredientSchema>;
export type RecipeFrontmatter = z.infer<typeof recipeFrontmatterSchema>;
export type RecipeRating = z.infer<typeof ratingSchema>;
export type RecipeTranslation = z.infer<typeof recipeTranslationSchema>;

export interface RecipeDocument {
	frontmatter: RecipeFrontmatter;
	instructions: string[];
	notes: string;
	path?: string;
	editedExternally: boolean;
}

export function isRecipeId(value: string): boolean {
	return RECIPE_ID_PATTERN.test(value);
}

export function createManualRecipe(title: string): RecipeDocument {
	const now = new Date().toISOString();
	return {
		frontmatter: {
			schemaVersion: RECIPE_SCHEMA_VERSION,
			type: RECIPE_TYPE,
			id: generateRecipeId(),
			title,
			sourceUrl: null,
			author: null,
			siteName: null,
			importedAt: now,
			updatedAt: now,
			extractionMethod: "manual",
			servings: null,
			prepTimeMinutes: null,
			cookTimeMinutes: null,
			totalTimeMinutes: null,
			cookingMethods: [],
			rating: null,
			images: [],
			ingredients: [],
		},
		instructions: [],
		notes: "",
		editedExternally: false,
	};
}

export function ingredientFromRaw(raw: string): RecipeIngredient {
	const trimmed = raw.replace(/^\s*[-*+]\s+/, "").trim();
	return {
		id: generateIngredientId(),
		raw: trimmed,
		name: trimmed,
		canonicalId: null,
		quantity: null,
		quantityMax: null,
		unit: null,
		unitSystem: null,
		preparation: null,
		qualifiers: [],
		optional: false,
		parseConfidence: null,
	};
}

export function fnv1aHex(input: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

export function canonicalBody(body: string): string {
	return body.replace(/\r\n/g, "\n").replace(/^\n+/, "").replace(/\s+$/, "");
}

export function computeBodyHash(
	frontmatter: Omit<RecipeFrontmatter, "bodyHash">,
	body: string,
): string {
	return fnv1aHex(`${JSON.stringify(frontmatter)}\n${canonicalBody(body)}`);
}

export function slugifyTitle(title: string): string {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
	return slug || "recipe";
}

export function joinVaultPath(...parts: string[]): string {
	return parts
		.join("/")
		.replace(/\\/g, "/")
		.replace(/\/+/g, "/")
		.replace(/^\/+|\/+$/g, "");
}

function migrateParseConfidence(value: unknown): unknown {
	if (value == null) {
		return null;
	}
	const parsed = parseConfidenceSchema.safeParse(value);
	if (parsed.success) {
		return parsed.data;
	}
	// v1 stored a 0-1 score. Drop it rather than inventing a label.
	return null;
}

function migrateIngredient(value: unknown): unknown {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return value;
	}
	const ingredient = value as Record<string, unknown>;
	return {
		...ingredient,
		parseConfidence: migrateParseConfidence(ingredient.parseConfidence),
	};
}

/** Lift v1 frontmatter (numeric parseConfidence) to the current schema version. */
export function migrateRecipeFrontmatterInput(value: unknown): unknown {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return value;
	}
	const input = value as Record<string, unknown>;
	const version = input.schemaVersion;
	if (version !== RECIPE_SCHEMA_VERSION_V1 && version !== RECIPE_SCHEMA_VERSION) {
		return value;
	}
	const ingredients = Array.isArray(input.ingredients)
		? input.ingredients.map(migrateIngredient)
		: input.ingredients;
	return {
		...input,
		schemaVersion: RECIPE_SCHEMA_VERSION,
		ingredients,
	};
}

export function parseRecipeFrontmatter(value: unknown): RecipeFrontmatter {
	return recipeFrontmatterSchema.parse(migrateRecipeFrontmatterInput(value));
}

export function safeParseRecipeFrontmatter(value: unknown) {
	return recipeFrontmatterSchema.safeParse(migrateRecipeFrontmatterInput(value));
}
