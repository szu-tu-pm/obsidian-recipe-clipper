import { z } from "zod";

export const RECIPE_SCHEMA_VERSION = 1 as const;
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
	parseConfidence: z
		.enum(["exact", "range", "non_numeric", "ambiguous"])
		.nullable()
		.default(null),
});

export const ratingSchema = z.union([
	z.literal(1),
	z.literal(2),
	z.literal(3),
	z.literal(4),
	z.literal(5),
	z.null(),
]);

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
});

export type ExtractionMethod = z.infer<typeof extractionMethodSchema>;
export type UnitSystem = z.infer<typeof unitSystemSchema>;
export type RecipeImage = z.infer<typeof recipeImageSchema>;
export type RecipeIngredient = z.infer<typeof recipeIngredientSchema>;
export type RecipeFrontmatter = z.infer<typeof recipeFrontmatterSchema>;
export type RecipeRating = z.infer<typeof ratingSchema>;

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

export function parseRecipeFrontmatter(value: unknown): RecipeFrontmatter {
	return recipeFrontmatterSchema.parse(value);
}

export function safeParseRecipeFrontmatter(value: unknown) {
	return recipeFrontmatterSchema.safeParse(value);
}
