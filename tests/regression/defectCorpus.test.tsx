import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { startImportSession } from "../../src/domain/extraction/importSession";
import type { ExtractionCandidate, UrlExtractionFallback } from "../../src/domain/extraction/types";
import { createManualRecipe } from "../../src/domain/schema/recipeSchema";
import { createShoppingListFromRecipes } from "../../src/domain/schema/shoppingListSchema";
import { InMemoryVault, jsonYamlCodec } from "../../src/domain/vault/inMemoryVault";
import { RecipeIndexer } from "../../src/domain/vault/recipeIndexer";
import { RecipeRepository } from "../../src/domain/vault/recipeRepository";
import { ShoppingListRepository } from "../../src/domain/vault/shoppingListRepository";
import type { VaultPort } from "../../src/domain/vault/vaultPort";
import { CollectionView } from "../../src/ui/CollectionView";
import { ImageGalleryPicker } from "../../src/ui/components/ImageGalleryPicker";
import { MultiRecipePickerModal } from "../../src/ui/components/MultiRecipePickerModal";
import { WrapperProvider } from "../../src/wrapper/WrapperContext";
import { createMockPluginServices } from "../helpers/mockPluginServices";

class FailAfterWriteVault extends InMemoryVault {
	failPaths = new Set<string>();

	override async write(path: string, content: string): Promise<void> {
		await super.write(path, content);
		if (this.failPaths.has(path)) {
			this.failPaths.delete(path);
			throw new Error("disk full");
		}
	}
}

function repositories(vault: VaultPort): {
	recipes: RecipeRepository;
	lists: ShoppingListRepository;
} {
	return {
		recipes: new RecipeRepository(
			vault,
			jsonYamlCodec,
			new RecipeIndexer("Recipes", "Recipes/_attachments"),
			"Recipes",
		),
		lists: new ShoppingListRepository(vault, jsonYamlCodec, "Shopping Lists"),
	};
}

afterEach(() => {
	cleanup();
});

describe("edge-case defect corpus", () => {
	it("leaves a malformed recipe file byte-for-byte unchanged and reports it", async () => {
		const vault = new InMemoryVault();
		const { recipes } = repositories(vault);
		const original = "this is not a recipe\n";
		await vault.write("Recipes/soup.md", original);
		const incoming = createManualRecipe("Soup");
		incoming.path = "Recipes/soup.md";

		await expect(recipes.save(incoming)).rejects.toThrow(/Left Recipes\/soup.md unchanged/);
		expect(await vault.read("Recipes/soup.md")).toBe(original);
		const problems = await recipes.listUnreadable();
		expect(problems).toEqual([
			expect.objectContaining({
				path: "Recipes/soup.md",
			}),
		]);
		expect(problems[0]?.message.length).toBeGreaterThan(0);
	});

	it("does not report a pending web clip or an attachment note as a broken recipe", async () => {
		const vault = new InMemoryVault();
		const { recipes } = repositories(vault);
		const clip = `---\n${JSON.stringify({ type: "recipe-clip", title: "Chili" })}\n---\n\nWaiting for review.\n`;
		await vault.write("Recipes/chili.md", clip);
		await vault.write("Recipes/_attachments/note.md", "not a recipe\n");
		await vault.write("Recipes/soup.md", "this is not a recipe\n");

		expect((await recipes.listUnreadable()).map((problem) => problem.path)).toEqual([
			"Recipes/soup.md",
		]);
	});

	it("restores the previous recipe when a vault write fails after changing the file", async () => {
		const vault = new FailAfterWriteVault();
		const { recipes } = repositories(vault);
		const created = createManualRecipe("Soup");
		const saved = await recipes.save(created);
		const before = await vault.read(saved.path ?? "");
		vault.failPaths.add(saved.path ?? "");

		await expect(
			recipes.save({
				...saved,
				frontmatter: { ...saved.frontmatter, title: "Broken Soup" },
			}),
		).rejects.toThrow("disk full");
		expect(await vault.read(saved.path ?? "")).toBe(before);
	});

	it("removes a new recipe file when the first write fails", async () => {
		const vault = new FailAfterWriteVault();
		const { recipes } = repositories(vault);
		const created = createManualRecipe("Soup");
		vault.failPaths.add("Recipes/soup.md");

		await expect(recipes.save(created)).rejects.toThrow("disk full");
		expect(await vault.exists("Recipes/soup.md")).toBe(false);
	});

	it("leaves a malformed shopping list unchanged and rolls a failed rewrite back", async () => {
		const vault = new FailAfterWriteVault();
		const { lists } = repositories(vault);
		const original = "not a shopping list\n";
		await vault.write("Shopping Lists/week.md", original);
		const incoming = createShoppingListFromRecipes([createManualRecipe("Soup")]);
		incoming.path = "Shopping Lists/week.md";

		await expect(lists.save(incoming)).rejects.toThrow(/Left Shopping Lists\/week.md unchanged/);
		expect(await vault.read("Shopping Lists/week.md")).toBe(original);

		const saved = await lists.save(createShoppingListFromRecipes([createManualRecipe("Stew")]));
		const before = await vault.read(saved.path ?? "");
		vault.failPaths.add(saved.path ?? "");
		await expect(
			lists.save({
				...saved,
				frontmatter: { ...saved.frontmatter, title: "Broken list" },
			}),
		).rejects.toThrow("disk full");
		expect(await vault.read(saved.path ?? "")).toBe(before);
	});

	it("tells the cook when local Ollama timed out, and cancel does not keep a draft", async () => {
		const fallback: UrlExtractionFallback = {
			status: "manual-fallback",
			succeeded: false,
			reason: "unparsed",
			draft: createManualRecipe("Untitled recipe"),
			attribution: { sourceUrl: "https://example.com/soup", author: null, siteName: null },
			duplicates: [],
			warnings: ["Local Ollama timed out."],
		};
		const failed = startImportSession({
			url: "https://example.com/soup",
			run: async () => fallback,
		});
		const snapshot = await failed.done;
		expect(snapshot.phase).toBe("failed");
		expect(snapshot.message).toBe(
			"Local Ollama timed out. The URL is kept so you can enter the recipe manually.",
		);

		const cancelled = startImportSession({
			url: "https://example.com/soup",
			run: (_report, signal) =>
				new Promise((_resolve, reject) => {
					const fail = () => {
						const error = new Error("The operation was aborted.");
						error.name = "AbortError";
						reject(error);
					};
					if (signal.aborted) {
						fail();
					} else {
						signal.addEventListener("abort", fail, { once: true });
					}
				}),
		});
		cancelled.cancel();
		const stopped = await cancelled.done;
		expect(stopped.phase).toBe("cancelled");
		expect(stopped.message).toBe("Import cancelled.");
		expect(stopped.result).toBeNull();
	});

	it("shows a placeholder when an attached image file is missing", () => {
		render(
			<ImageGalleryPicker
				images={[
					{
						path: "Recipes/_attachments/rec/missing.webp",
						alt: "Soup",
						sourceUrl: null,
						isPrimary: true,
					},
				]}
				resolveUrl={() => "app://missing.webp"}
				busy={false}
				error={null}
				onAddFiles={() => undefined}
				onRemove={() => undefined}
				onSetPrimary={() => undefined}
				onAltChange={() => undefined}
			/>,
		);
		fireEvent.error(screen.getByRole("img", { name: "Soup" }));
		expect(screen.getByText("Missing file")).toBeTruthy();
	});

	it("does not save a recipe when the multi-recipe picker is cancelled", () => {
		let selected = false;
		let cancelled = false;
		const candidate = {
			title: "Soup",
			ingredientsRaw: ["1 cup stock"],
			instructions: ["Simmer"],
			draft: createManualRecipe("Soup"),
		} as ExtractionCandidate;
		render(
			<MultiRecipePickerModal
				candidates={[candidate]}
				onSelect={() => {
					selected = true;
				}}
				onCancel={() => {
					cancelled = true;
				}}
			/>,
		);
		expect(screen.getByText(/Nothing is saved until you review the one you pick/)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(cancelled).toBe(true);
		expect(selected).toBe(false);
	});

	it("surfaces a malformed recipe in the collection without opening it", async () => {
		const services = createMockPluginServices();
		services.listRecipeDiagnostics = async () => [
			{ path: "Recipes/soup.md", message: "Recipe file is missing YAML frontmatter." },
		];
		render(
			<WrapperProvider services={services}>
				<CollectionView />
			</WrapperProvider>,
		);
		expect(
			await screen.findByText(
				"Recipes/soup.md: Recipe file is missing YAML frontmatter. The file was not changed.",
			),
		).toBeTruthy();
	});
});
