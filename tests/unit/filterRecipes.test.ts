import { describe, expect, it } from "vitest";
import { createManualRecipe } from "../../src/domain/schema/recipeSchema";
import type { RecipeIndexEntry } from "../../src/domain/vault/recipeIndexer";
import { filterRecipes } from "../../src/ui/filterRecipes";

function entry(title: string, rating: RecipeIndexEntry["rating"] = null): RecipeIndexEntry {
	const recipe = createManualRecipe(title);
	return {
		id: recipe.frontmatter.id,
		path: `Recipes/${title}.md`,
		title,
		rating,
		primaryImagePath: null,
		updatedAt: recipe.frontmatter.updatedAt,
		schemaVersion: recipe.frontmatter.schemaVersion,
	};
}

describe("filterRecipes", () => {
	it("filters by title substring and rating without inventing matches", () => {
		const recipes = [
			entry("Pancakes", 5),
			entry("Tomato Soup", 2),
			entry("Salad", null),
		];
		expect(filterRecipes(recipes, "pan", "any").map((item) => item.title)).toEqual([
			"Pancakes",
		]);
		expect(filterRecipes(recipes, "", "unrated").map((item) => item.title)).toEqual([
			"Salad",
		]);
		expect(filterRecipes(recipes, "soup", 5)).toEqual([]);
	});

	it("filters 500 titles in under 16 ms", () => {
		const recipes = Array.from({ length: 500 }, (_, index) =>
			entry(`Recipe ${index} ${index % 2 === 0 ? "Cake" : "Stew"}`, (index % 5) + 1 as 1),
		);
		const started = performance.now();
		const matched = filterRecipes(recipes, "cake", 5);
		const elapsed = performance.now() - started;
		expect(elapsed).toBeLessThan(16);
		expect(matched.length).toBeGreaterThan(0);
	});
});
