import { describe, expect, it } from "vitest";
import { parseRecipeFile, serializeRecipeFile } from "../../src/domain/schema/recipeMarkdown";
import { createManualRecipe, ingredientFromRaw } from "../../src/domain/schema/recipeSchema";
import { InMemoryVault, jsonYamlCodec } from "../../src/domain/vault/inMemoryVault";
import { RecipeIndexer } from "../../src/domain/vault/recipeIndexer";
import { RecipeRepository } from "../../src/domain/vault/recipeRepository";

describe("recipe vault round trip", () => {
	it("saves a schemaVersion 2 recipe and reloads the same rec_* id", async () => {
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
		expect(loaded.recipe.frontmatter.schemaVersion).toBe(2);
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

	it("migrates schemaVersion 1 numeric parseConfidence to the current enum schema", () => {
		const markdown = `---
${JSON.stringify(
	{
		schemaVersion: 1,
		type: "recipe",
		id: "rec_01JQC0TEST0000000000000000",
		title: "Legacy Soup",
		sourceUrl: null,
		author: null,
		siteName: null,
		importedAt: "2026-10-14T00:00:00.000Z",
		updatedAt: "2026-10-14T00:00:00.000Z",
		extractionMethod: "manual",
		servings: null,
		prepTimeMinutes: null,
		cookTimeMinutes: null,
		totalTimeMinutes: null,
		cookingMethods: [],
		rating: null,
		images: [],
		ingredients: [
			{
				id: "ing_01JQC0TEST0000000000000000",
				raw: "1 cup stock",
				name: "stock",
				canonicalId: null,
				quantity: 1,
				quantityMax: null,
				unit: "cup",
				unitSystem: "imperial",
				preparation: null,
				qualifiers: [],
				optional: false,
				parseConfidence: 0.9,
			},
		],
	},
	null,
	2,
)}
---

# Legacy Soup
`;
		const parsed = parseRecipeFile(markdown, jsonYamlCodec);
		expect(parsed.frontmatter.schemaVersion).toBe(2);
		expect(parsed.frontmatter.ingredients[0]?.parseConfidence).toBeNull();
		expect(parsed.frontmatter.title).toBe("Legacy Soup");
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
