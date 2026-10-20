import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { parseIngredientLine } from "../../src/domain/aggregation/stage1LexicalParser";
import {
	createShoppingListFromRecipes,
	replaceShoppingListContents,
} from "../../src/domain/schema/shoppingListSchema";
import { InMemoryVault, jsonYamlCodec } from "../../src/domain/vault/inMemoryVault";
import { RecipeIndexer } from "../../src/domain/vault/recipeIndexer";
import { RecipeRepository } from "../../src/domain/vault/recipeRepository";
import { ShoppingListRepository } from "../../src/domain/vault/shoppingListRepository";
import { DEFAULT_SETTINGS } from "../../src/pluginSettings";
import { CollectionView } from "../../src/ui/CollectionView";
import { WrapperProvider } from "../../src/wrapper/WrapperContext";
import { createMockPluginServices, seedRecipe } from "../helpers/mockPluginServices";

afterEach(() => {
	cleanup();
});

function recipeWith(title: string, lines: string[]) {
	const recipe = seedRecipe(title);
	recipe.path = `Recipes/${title}.md`;
	recipe.frontmatter.ingredients = lines.map((line) => parseIngredientLine(line));
	return recipe;
}

describe("shopping list vault lifecycle", () => {
	it("persists availability independently of later recipe edits and deletes", async () => {
		const vault = new InMemoryVault();
		const indexer = new RecipeIndexer("Recipes", "Recipes/_attachments");
		const recipes = new RecipeRepository(vault, jsonYamlCodec, indexer, "Recipes");
		const lists = new ShoppingListRepository(vault, jsonYamlCodec, "Shopping Lists");
		const paprika = recipeWith("Paprika Night", ["1 tsp paprika", "1 cup all-purpose flour"]);
		const soup = recipeWith("Flour Soup", ["2 tsp paprika", "120 g all-purpose flour", "salt to taste"]);
		await recipes.save(paprika);
		await recipes.save(soup);
		indexer.rebuildFromCache(vault);

		const created = createShoppingListFromRecipes([paprika, soup]);
		const saved = await lists.save(created);
		expect(saved.path).toMatch(/^Shopping Lists\/\d{4}-\d{2}-\d{2}-paprika-night-flour-soup\.md$/);
		expect(saved.frontmatter.schemaVersion).toBe(1);
		expect(saved.frontmatter.id.startsWith("list_")).toBe(true);

		const ingredientIds = [paprika, soup].flatMap((recipe) =>
			recipe.frontmatter.ingredients.map((ingredient) => ingredient.id),
		);
		const listedIds = saved.frontmatter.items.flatMap((item) =>
			item.sourceRefs.map((ref) => ref.ingredientId),
		);
		expect(listedIds.sort()).toEqual(ingredientIds.sort());

		const merged = saved.frontmatter.items.find((item) => item.name === "paprika");
		expect(merged?.mergeRuleId).toBe("v2.merge-same-dimension");
		expect(merged?.mergeReason).toContain("Compatible units");
		expect(merged?.sourceRefs).toHaveLength(2);
		expect(merged?.status).toBe("need");

		const flour = saved.frontmatter.items.filter((item) => item.name === "flour");
		expect(flour).toHaveLength(2);
		expect(flour.every((item) => item.mergeReason.includes("Cross-dimension"))).toBe(true);

		const edited = {
			...saved,
			frontmatter: {
				...saved.frontmatter,
				items: saved.frontmatter.items.map((item) =>
					item.name === "paprika"
						? {
								...item,
								status: "partial" as const,
								ownedQuantity: 1,
								ownedUnit: "tsp",
								remainingQuantity: 2,
							}
						: item,
				),
			},
		};
		const persisted = await lists.save(edited);
		const raw = await vault.read(persisted.path ?? "");

		paprika.frontmatter.ingredients = [parseIngredientLine("9 tsp paprika")];
		await recipes.save(paprika);
		await recipes.remove(soup.frontmatter.id);

		const reloadedRepo = new ShoppingListRepository(vault, jsonYamlCodec, "Shopping Lists");
		const reloaded = await reloadedRepo.loadById(saved.frontmatter.id);
		expect(reloaded.ok).toBe(true);
		if (!reloaded.ok) {
			return;
		}
		const paprikaItem = reloaded.list.frontmatter.items.find((item) => item.name === "paprika");
		expect(paprikaItem?.status).toBe("partial");
		expect(paprikaItem?.ownedQuantity).toBe(1);
		expect(paprikaItem?.remainingQuantity).toBe(2);
		expect(paprikaItem?.requiredQuantity).toBe(3);
		expect(await vault.read(persisted.path ?? "")).toBe(raw);

		const replacement = replaceShoppingListContents(
			reloaded.list,
			createShoppingListFromRecipes([paprika]),
		);
		const replaced = await reloadedRepo.save(replacement);
		expect(replaced.frontmatter.id).toBe(saved.frontmatter.id);
		expect(replaced.path).toBe(saved.path);
		expect(replaced.frontmatter.items.find((item) => item.name === "paprika")?.status).toBe("need");

		const second = await reloadedRepo.save(createShoppingListFromRecipes([paprika]));
		expect(second.frontmatter.id).not.toBe(saved.frontmatter.id);
		expect(await reloadedRepo.loadById(saved.frontmatter.id)).toMatchObject({ ok: true });
		const listed = await reloadedRepo.list();
		expect(listed.map((list) => list.frontmatter.id)).toContain(saved.frontmatter.id);
		expect(listed.map((list) => list.frontmatter.id)).toContain(second.frontmatter.id);
	});
});

describe("shopping list editor", () => {
	it("toggles pantry availability, filters needed items, and keeps saved lists on regenerate", async () => {
		const paprika = recipeWith("Paprika Night", ["1 tsp paprika", "1 cup all-purpose flour"]);
		const soup = recipeWith("Flour Soup", [
			"2 tsp paprika",
			"120 g all-purpose flour",
			"salt to taste",
		]);
		const services = createMockPluginServices({
			recipes: [paprika, soup],
			settings: { ...DEFAULT_SETTINGS },
		});
		render(
			<WrapperProvider services={services}>
				<CollectionView />
			</WrapperProvider>,
		);

		fireEvent.click(screen.getByRole("checkbox", { name: "Select Paprika Night for shopping list" }));
		fireEvent.click(screen.getByRole("checkbox", { name: "Select Flour Soup for shopping list" }));
		fireEvent.click(screen.getByRole("button", { name: "Generate shopping list" }));

		const dialog = await screen.findByRole("dialog", { name: "Paprika Night, Flour Soup" });
		const paprikaRow = within(dialog).getByRole("listitem", { name: "paprika tsp" });
		expect(within(paprikaRow).getByRole("button", { name: "paprika tsp: Do not have" })).toBeTruthy();
		expect(within(paprikaRow).getByText("v2.merge-same-dimension: Compatible units were summed in the canonical unit.")).toBeTruthy();
		expect(within(paprikaRow).getByText("Paprika Night")).toBeTruthy();
		expect(within(paprikaRow).getByText("Flour Soup")).toBeTruthy();

		fireEvent.click(within(paprikaRow).getByRole("button", { name: "paprika tsp: Do not have" }));
		expect(within(paprikaRow).getByRole("button", { name: "paprika tsp: Have some" })).toBeTruthy();
		fireEvent.change(within(paprikaRow).getByLabelText("On hand quantity for paprika tsp"), {
			target: { value: "1" },
		});
		fireEvent.change(within(paprikaRow).getByLabelText("On hand unit for paprika tsp"), {
			target: { value: "tsp" },
		});
		expect(within(paprikaRow).getByText("Remaining: 2 tsp")).toBeTruthy();

		const flourRow = within(dialog).getByRole("listitem", { name: "flour g" });
		fireEvent.change(within(flourRow).getByLabelText("On hand quantity for flour g"), {
			target: { value: "1" },
		});
		fireEvent.change(within(flourRow).getByLabelText("On hand unit for flour g"), {
			target: { value: "cup" },
		});
		expect(within(flourRow).getByText("Required: 120 g")).toBeTruthy();
		expect(within(flourRow).getByText("On hand: 1 cup")).toBeTruthy();

		fireEvent.click(within(paprikaRow).getByRole("button", { name: "paprika tsp: Have some" }));
		fireEvent.click(within(dialog).getByRole("checkbox", { name: "Needed only" }));
		expect(within(dialog).queryByRole("listitem", { name: "paprika tsp" })).toBeNull();
		expect(within(dialog).getByRole("listitem", { name: "salt no unit" })).toBeTruthy();
		expect(within(dialog).getByRole("listitem", { name: "flour g" })).toBeTruthy();

		fireEvent.change(within(dialog).getByLabelText("New item"), {
			target: { value: "paper towels" },
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "Add item" }));
		const manual = within(dialog).getByRole("listitem", { name: "paper towels no unit" });
		expect(within(manual).getByRole("button", { name: "paper towels no unit: Do not have" })).toBeTruthy();
		expect(within(manual).getByText("Manual item")).toBeTruthy();

		const savedId = services.shoppingLists[0]?.frontmatter.id;
		expect(savedId).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Refresh shopping list" }));
		const confirm = await screen.findByRole("dialog", { name: "Replace this shopping list?" });
		fireEvent.click(within(confirm).getByRole("button", { name: "Create new list" }));
		await waitFor(() => {
			expect(services.shoppingLists).toHaveLength(2);
		});
		const original = await services.loadShoppingList(savedId ?? "");
		expect(original.ok).toBe(true);
		if (!original.ok) {
			return;
		}
		expect(original.list.frontmatter.items.find((item) => item.name === "paprika")?.status).toBe(
			"have",
		);
		expect(original.list.frontmatter.items.find((item) => item.name === "paper towels")).toBeTruthy();

		const openId = services.shoppingLists[1]?.frontmatter.id;
		fireEvent.click(screen.getByRole("button", { name: "Refresh shopping list" }));
		const replace = await screen.findByRole("dialog", { name: "Replace this shopping list?" });
		fireEvent.click(within(replace).getByRole("button", { name: "Replace this list" }));
		await waitFor(() => {
			expect(services.shoppingLists).toHaveLength(2);
			expect(
				services.shoppingLists.find((list) => list.frontmatter.id === openId)?.frontmatter.items,
			).toEqual(
				expect.arrayContaining([expect.objectContaining({ name: "paprika", status: "need" })]),
			);
		});
		const replaced = services.shoppingLists.find((list) => list.frontmatter.id === openId);
		expect(replaced?.frontmatter.items.every((item) => item.status === "need")).toBe(true);
		expect(replaced?.frontmatter.items.some((item) => item.name === "paper towels")).toBe(false);

		fireEvent.click(screen.getByRole("button", { name: "Close" }));
		fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
		fireEvent.click(screen.getByRole("button", { name: "Delete recipe" }));
		await waitFor(() => {
			expect(services.listRecipes()).toHaveLength(1);
		});
		const afterDelete = await services.loadShoppingList(savedId ?? "");
		expect(afterDelete.ok).toBe(true);
		if (!afterDelete.ok) {
			return;
		}
		expect(afterDelete.list.frontmatter.items.find((item) => item.name === "paprika")?.requiredQuantity).toBe(
			3,
		);

		cleanup();
		render(
			<WrapperProvider services={services}>
				<CollectionView />
			</WrapperProvider>,
		);
		fireEvent.click(await screen.findByRole("button", { name: `Open shopping list ${savedId}` }));
		const reopened = await screen.findByRole("dialog", { name: "Paprika Night, Flour Soup" });
		expect(within(reopened).getByRole("button", { name: "paprika tsp: Have all" })).toBeTruthy();
		expect(within(reopened).getByText("Remaining: 2 tsp")).toBeTruthy();

		const name = within(reopened).getByLabelText("Name for paprika tsp");
		fireEvent.change(name, { target: { value: "" } });
		expect((name as HTMLInputElement).value).toBe("");
		fireEvent.blur(name);
		expect((name as HTMLInputElement).value).toBe("paprika");
	});
});
