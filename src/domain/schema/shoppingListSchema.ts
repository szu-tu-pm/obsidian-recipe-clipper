import { z } from "zod";
import type { AggregatedIngredient } from "../aggregation/aggregator";
import { aggregateIngredients, type AggregateSource } from "../aggregation/aggregator";
import { canonicalizeMeasure, lookupUnit } from "../aggregation/unitNormalizer";
import { slugifyTitle, type RecipeDocument } from "./recipeSchema";

export const SHOPPING_LIST_SCHEMA_VERSION = 1 as const;
export const SHOPPING_LIST_TYPE = "shopping-list" as const;

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const LIST_ID_PATTERN = /^list_[0-9A-HJKMNP-TV-Z]{26}$/;
const ITEM_ID_PATTERN = /^sli_[0-9A-HJKMNP-TV-Z]{26}$/;

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

export function generateShoppingListId(now = Date.now()): string {
	return `list_${encodeCrockford(now, 10)}${randomCrockford(16)}`;
}

export function generateShoppingListItemId(now = Date.now()): string {
	return `sli_${encodeCrockford(now, 10)}${randomCrockford(16)}`;
}

export const availabilityStatusSchema = z.enum(["need", "partial", "have"]);

export const AVAILABILITY_LABELS = {
	need: "Do not have",
	partial: "Have some",
	have: "Have all",
} as const;

export function nextAvailabilityStatus(
	status: AvailabilityStatus,
): AvailabilityStatus {
	if (status === "need") {
		return "partial";
	}
	if (status === "partial") {
		return "have";
	}
	return "need";
}

export const shoppingSourceRefSchema = z.object({
	recipeId: z.string().min(1),
	ingredientId: z.string().min(1),
	recipeTitle: z.string().default(""),
});

export const shoppingListItemSchema = z.object({
	id: z.string().regex(ITEM_ID_PATTERN),
	name: z.string().min(1),
	canonicalId: z.string().nullable().default(null),
	requiredQuantity: z.number().nullable().default(null),
	requiredQuantityMax: z.number().nullable().default(null),
	requiredUnit: z.string().nullable().default(null),
	dimension: z.string().nullable().default(null),
	preparation: z.string().nullable().default(null),
	status: availabilityStatusSchema.default("need"),
	ownedQuantity: z.number().nullable().default(null),
	ownedUnit: z.string().nullable().default(null),
	remainingQuantity: z.number().nullable().default(null),
	sourceRefs: z.array(shoppingSourceRefSchema).default([]),
	mergeRuleId: z.string().min(1),
	mergeReason: z.string().min(1),
	rulesVersion: z.string().nullable().default(null),
});

export const shoppingListFrontmatterSchema = z.object({
	schemaVersion: z.literal(SHOPPING_LIST_SCHEMA_VERSION),
	type: z.literal(SHOPPING_LIST_TYPE),
	id: z.string().regex(LIST_ID_PATTERN),
	title: z.string().min(1),
	createdAt: z.string().min(1),
	updatedAt: z.string().min(1),
	sourceRecipeIds: z.array(z.string()).default([]),
	items: z.array(shoppingListItemSchema).default([]),
});

export type AvailabilityStatus = z.infer<typeof availabilityStatusSchema>;
export type ShoppingSourceRef = z.infer<typeof shoppingSourceRefSchema>;
export type ShoppingListItem = z.infer<typeof shoppingListItemSchema>;
export type ShoppingListFrontmatter = z.infer<typeof shoppingListFrontmatterSchema>;

export interface ShoppingListDocument {
	frontmatter: ShoppingListFrontmatter;
	path?: string;
}

export type PantryDisplay =
	| { mode: "remaining"; text: string }
	| { mode: "separate"; requiredText: string; ownedText: string }
	| { mode: "required-only"; text: string };

export function formatQuantity(value: number): string {
	const rounded = Math.round(value * 1000) / 1000;
	return String(rounded);
}

export function formatMeasure(
	quantity: number | null,
	quantityMax: number | null,
	unit: string | null,
): string {
	if (quantity == null || !Number.isFinite(quantity)) {
		return "unspecified";
	}
	const amount =
		quantityMax != null && quantityMax !== quantity
			? `${formatQuantity(quantity)}–${formatQuantity(quantityMax)}`
			: formatQuantity(quantity);
	return unit ? `${amount} ${unit}` : amount;
}

/**
 * Remaining amount in the required unit when the on-hand unit shares a dimension.
 * Cross-dimension and unknown units return null so the row can show both amounts.
 */
export function remainingInRequiredUnit(
	item: Pick<
		ShoppingListItem,
		"requiredQuantity" | "requiredUnit" | "ownedQuantity" | "ownedUnit"
	>,
): number | null {
	const { requiredQuantity, requiredUnit, ownedQuantity, ownedUnit } = item;
	if (requiredQuantity == null || ownedQuantity == null) {
		return null;
	}
	if (!Number.isFinite(requiredQuantity) || requiredQuantity <= 0) {
		return null;
	}
	if (!Number.isFinite(ownedQuantity) || ownedQuantity < 0) {
		return null;
	}

	const required = canonicalizeMeasure(requiredUnit, requiredQuantity, null);
	if (!required) {
		return null;
	}
	const ownedProbe = canonicalizeMeasure(ownedUnit, ownedQuantity === 0 ? 1 : ownedQuantity, null);
	if (!ownedProbe || ownedProbe.dimension !== required.dimension) {
		return null;
	}

	const factor = requiredUnit ? lookupUnit(requiredUnit)?.factor : 1;
	if (!factor) {
		return null;
	}
	const ownedCanonical = ownedQuantity === 0 ? 0 : ownedProbe.quantity;
	return Math.max(0, required.quantity - ownedCanonical) / factor;
}

export function pantryDisplay(item: ShoppingListItem): PantryDisplay {
	const requiredText = `Required: ${formatMeasure(item.requiredQuantity, item.requiredQuantityMax, item.requiredUnit)}`;
	if (item.ownedQuantity == null) {
		return {
			mode: "required-only",
			text: formatMeasure(item.requiredQuantity, item.requiredQuantityMax, item.requiredUnit),
		};
	}
	const remaining = remainingInRequiredUnit(item);
	if (remaining == null) {
		return {
			mode: "separate",
			requiredText,
			ownedText: `On hand: ${formatMeasure(item.ownedQuantity, null, item.ownedUnit)}`,
		};
	}
	const unit = item.requiredUnit ? ` ${item.requiredUnit}` : "";
	return { mode: "remaining", text: `Remaining: ${formatQuantity(remaining)}${unit}` };
}

export function applyPantryEdit(
	item: ShoppingListItem,
	patch: Partial<
		Pick<
			ShoppingListItem,
			| "name"
			| "requiredQuantity"
			| "requiredQuantityMax"
			| "requiredUnit"
			| "status"
			| "ownedQuantity"
			| "ownedUnit"
		>
	>,
): ShoppingListItem {
	const next: ShoppingListItem = { ...item, ...patch };
	return { ...next, remainingQuantity: remainingInRequiredUnit(next) };
}

export function itemAccessibleName(item: ShoppingListItem): string {
	return `${item.name} ${item.requiredUnit ?? "no unit"}`;
}

export function shoppingListTitle(recipes: RecipeDocument[]): string {
	const names = recipes.map((recipe) => recipe.frontmatter.title.trim()).filter(Boolean);
	if (names.length === 0) {
		return "Shopping list";
	}
	if (names.length <= 3) {
		return names.join(", ");
	}
	return `${names.slice(0, 2).join(", ")} + ${names.length - 2} more`;
}

export function shoppingListSlug(title: string, createdAt: string): string {
	const date = createdAt.slice(0, 10);
	return `${date}-${slugifyTitle(title)}`;
}

export function createShoppingListFromRecipes(
	recipes: RecipeDocument[],
	now = new Date(),
): ShoppingListDocument {
	const timestamp = now.toISOString();
	const titles = new Map(
		recipes.map((recipe) => [recipe.frontmatter.id, recipe.frontmatter.title]),
	);
	const sources: AggregateSource[] = recipes.flatMap((recipe) =>
		recipe.frontmatter.ingredients.map((ingredient) => ({
			recipeId: recipe.frontmatter.id,
			ingredient,
		})),
	);
	const items = aggregateIngredients(sources).map((row) => itemFromAggregate(row, titles));
	return {
		frontmatter: {
			schemaVersion: SHOPPING_LIST_SCHEMA_VERSION,
			type: SHOPPING_LIST_TYPE,
			id: generateShoppingListId(now.getTime()),
			title: shoppingListTitle(recipes),
			createdAt: timestamp,
			updatedAt: timestamp,
			sourceRecipeIds: recipes.map((recipe) => recipe.frontmatter.id),
			items,
		},
	};
}

export function replaceShoppingListContents(
	current: ShoppingListDocument,
	generated: ShoppingListDocument,
): ShoppingListDocument {
	return {
		...current,
		frontmatter: {
			...current.frontmatter,
			title: generated.frontmatter.title,
			sourceRecipeIds: generated.frontmatter.sourceRecipeIds,
			items: generated.frontmatter.items,
			updatedAt: new Date().toISOString(),
		},
	};
}

export function createManualShoppingItem(
	name: string,
	requiredQuantity: number | null,
	requiredUnit: string | null,
): ShoppingListItem {
	const probeQuantity =
		requiredQuantity != null && requiredQuantity > 0 ? requiredQuantity : 1;
	const measure = canonicalizeMeasure(requiredUnit, probeQuantity, null);
	return applyPantryEdit(
		{
			id: generateShoppingListItemId(),
			name: name.trim(),
			canonicalId: null,
			requiredQuantity,
			requiredQuantityMax: null,
			requiredUnit,
			dimension: measure?.dimension ?? null,
			preparation: null,
			status: "need",
			ownedQuantity: null,
			ownedUnit: null,
			remainingQuantity: null,
			sourceRefs: [],
			mergeRuleId: "v1.manual",
			mergeReason: "Added manually.",
			rulesVersion: null,
		},
		{},
	);
}

function itemFromAggregate(
	row: AggregatedIngredient,
	titles: Map<string, string>,
): ShoppingListItem {
	return applyPantryEdit(
		{
			id: generateShoppingListItemId(),
			name: row.name,
			canonicalId: row.canonicalId,
			requiredQuantity: row.quantity,
			requiredQuantityMax: row.quantityMax,
			requiredUnit: row.unit,
			dimension: row.dimension,
			preparation: row.preparation,
			status: "need",
			ownedQuantity: null,
			ownedUnit: null,
			remainingQuantity: null,
			sourceRefs: row.sourceRefs.map((ref) => ({
				recipeId: ref.recipeId,
				ingredientId: ref.ingredientId,
				recipeTitle: titles.get(ref.recipeId) ?? "",
			})),
			mergeRuleId: row.mergeRuleId,
			mergeReason: row.mergeReason,
			rulesVersion: row.rulesVersion,
		},
		{},
	);
}

export function parseShoppingListFrontmatter(value: unknown): ShoppingListFrontmatter {
	return shoppingListFrontmatterSchema.parse(value);
}
