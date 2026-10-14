import { describe, expect, it } from "vitest";
import { parseRecipeFile, serializeRecipeFile } from "../../src/domain/schema/recipeMarkdown";
import { createManualRecipe, ingredientFromRaw } from "../../src/domain/schema/recipeSchema";
import { InMemoryVault, jsonYamlCodec } from "../../src/domain/vault/inMemoryVault";
import { RecipeIndexer } from "../../src/domain/vault/recipeIndexer";
import { RecipeRepository } from "../../src/domain/vault/recipeRepository";

describe("recipe vault round trip", () => {
	it("saves a schemaVersion 1 recipe and reloads the same rec_* id", async () => {
		const vault = new InMemoryVault();
		const indexer = new RecipeIndexer("Recipes", "Recipes/_attachments");
		const repository = new RecipeRepository(vault, jsonYamlCodec, indexer, "Recipes");
		const created = createManualRecipe("Test Pancakes");
		created.frontmatter.ingredients = [ingredientFromRaw("1 cup flour")];
		created.instructions = ["Mix", "Cook"];
		created.notes = "Weekend breakfast";

		const saved = await repository.save(created);
		indexer.rebuildFromCache(vault);
		const loaded = await repository.loadById(saved.frontmatter.id);

		expect(loaded.ok).toBe(true);
		if (!loaded.ok) {
			return;
		}
		expect(loaded.recipe.frontmatter.schemaVersion).toBe(1);
		expect(loaded.recipe.frontmatter.id).toBe(saved.frontmatter.id);
		expect(loaded.recipe.frontmatter.id.startsWith("rec_")).toBe(true);
		expect(loaded.recipe.frontmatter.title).toBe("Test Pancakes");
		expect(loaded.recipe.instructions).toEqual(["Mix", "Cook"]);
	});

	it("detects direct Markdown edits via bodyHash and reparses without dropping the id", () => {
		const recipe = createManualRecipe("Soup");
		recipe.frontmatter.ingredients = [ingredientFromRaw("2 cups stock")];
		const markdown = serializeRecipeFile(recipe, jsonYamlCodec);
		const edited = markdown.replace("- 2 cups stock", "- 3 cups stock\n- salt");
		const parsed = parseRecipeFile(edited, jsonYamlCodec);

		expect(parsed.editedExternally).toBe(true);
		expect(parsed.frontmatter.id).toBe(recipe.frontmatter.id);
		expect(parsed.frontmatter.ingredients.map((item) => item.raw)).toEqual([
			"3 cups stock",
			"salt",
		]);
	});

	it("keeps the rec_* id when the file path changes", () => {
		const recipe = createManualRecipe("Rename Me");
		const indexer = new RecipeIndexer("Recipes", "Recipes/_attachments");
		indexer.rebuild([
			{
				path: "Recipes/rename-me.md",
				frontmatter: recipe.frontmatter as unknown as Record<string, unknown>,
			},
		]);
		indexer.applyVaultEvent(
			{ kind: "rename", path: "Recipes/renamed.md", previousPath: "Recipes/rename-me.md" },
			{
				listMarkdown: () => [],
				readFrontmatter: () => recipe.frontmatter as unknown as Record<string, unknown>,
			},
		);

		expect(indexer.getById(recipe.frontmatter.id)?.path).toBe("Recipes/renamed.md");
	});
});
