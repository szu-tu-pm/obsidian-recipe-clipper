import type { RecipeIndexEntry } from "../domain/vault/recipeIndexer";

export type RatingFilter = "any" | "unrated" | 1 | 2 | 3 | 4 | 5;

export function filterRecipes(
	recipes: RecipeIndexEntry[],
	query: string,
	rating: RatingFilter,
): RecipeIndexEntry[] {
	const needle = query.trim().toLowerCase();
	return recipes.filter((recipe) => {
		if (needle && !recipe.title.toLowerCase().includes(needle)) {
			return false;
		}
		if (rating === "any") {
			return true;
		}
		if (rating === "unrated") {
			return recipe.rating == null;
		}
		return recipe.rating === rating;
	});
}
