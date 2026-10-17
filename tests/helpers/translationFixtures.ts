import { readFileSync } from "node:fs";
import { parseIngredientLine } from "../../src/domain/aggregation/stage1LexicalParser";
import { createManualRecipe, type RecipeDocument } from "../../src/domain/schema/recipeSchema";
import { createShoppingListFromRecipes } from "../../src/domain/schema/shoppingListSchema";
import type {
	TranslationPayload,
	TranslationReply,
} from "../../src/domain/translation/recipeTranslator";

export interface RecordedResponse {
	id: string;
	category: string;
	source: string;
	language: string;
	expect: "ready" | "failed";
	problem?: string;
	output?: TranslationReply;
	content?: string;
}

export const recorded = JSON.parse(
	readFileSync("tests/fixtures/translation/recorded-responses.json", "utf8"),
) as { sources: Record<string, TranslationPayload>; responses: RecordedResponse[] };

export const SHRIMP = recorded.sources.shrimp;
export const FLATBREAD = recorded.sources.flatbread;

export function contentOf(response: RecordedResponse): string {
	return response.content ?? JSON.stringify(response.output);
}

export function recordedReply(id: string): TranslationReply {
	const found = recorded.responses.find((item) => item.id === id);
	if (!found?.output) {
		throw new Error(`No recorded output ${id}`);
	}
	return structuredClone(found.output);
}

export const FRENCH = recordedReply("valid-french");

/** A saved recipe built from a fixture source, with the fixture's ingredient ids. */
export function recipeFrom(source: TranslationPayload): RecipeDocument {
	const recipe = createManualRecipe(source.title);
	recipe.frontmatter.id = "rec_0000000000000000000000RC00";
	recipe.frontmatter.ingredients = source.ingredients.map((item) => ({
		...parseIngredientLine(item.text),
		id: item.id,
	}));
	recipe.frontmatter.rating = 4;
	recipe.frontmatter.images = [
		{ path: "Recipes/_attachments/dish.jpg", alt: "Dish", sourceUrl: null, isPrimary: true },
	];
	recipe.instructions = source.instructions.map((item) => item.text);
	recipe.notes = "Double the garlic next time.";
	return recipe;
}

export function texts(items: Array<{ text: string }>): string[] {
	return items.map((item) => item.text);
}

/** A second recipe to aggregate against: shares shrimp, and has plain (unblocked) butter. */
export function scampiRecipe(): RecipeDocument {
	const recipe = createManualRecipe("Shrimp Scampi");
	recipe.frontmatter.id = "rec_0000000000000000000000SC00";
	recipe.frontmatter.ingredients = ["1 lb shrimp, peeled", "2 tbsp butter", "½ tsp salt"].map(
		(line, index) => ({ ...parseIngredientLine(line), id: `ing_0000000000000000000000SC0${index + 1}` }),
	);
	return recipe;
}

/** Shopping-list rows without generated ids or display titles (identity only). */
export function shoppingRows(recipes: RecipeDocument[]) {
	return createShoppingListFromRecipes(recipes, new Date("2026-10-17T00:00:00Z")).frontmatter.items.map(
		({ id: _id, sourceRefs, ...item }) => ({
			...item,
			sourceRefs: sourceRefs.map(({ recipeTitle: _title, ...ref }) => ref),
		}),
	);
}
