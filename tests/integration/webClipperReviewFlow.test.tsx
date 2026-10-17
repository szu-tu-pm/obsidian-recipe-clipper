import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { webClipToReviewResult } from "../../src/domain/extraction/webClipperIntake";
import { DEFAULT_SETTINGS } from "../../src/pluginSettings";
import { CollectionView } from "../../src/ui/CollectionView";
import { WrapperProvider } from "../../src/wrapper/WrapperContext";
import {
	createMockPluginServices,
	seedRecipe,
	type MockRecipeStore,
} from "../helpers/mockPluginServices";
import { clipYamlCodec, loadClip, type FixtureName } from "../helpers/webClipperFixtures";

afterEach(() => {
	cleanup();
});

function clipEntry(store: MockRecipeStore, name: FixtureName, path: string, title: string) {
	return {
		path,
		title,
		review: () =>
			webClipToReviewResult({
				markdown: loadClip(name),
				path,
				yaml: clipYamlCodec,
				existingRecipes: store.recipes.map((recipe) => ({
					id: recipe.frontmatter.id,
					sourceUrl: recipe.frontmatter.sourceUrl,
					path: recipe.path,
				})),
			}),
	};
}

function renderWith(store: MockRecipeStore) {
	const services = createMockPluginServices(store);
	render(
		<WrapperProvider services={services}>
			<CollectionView
				importPage={async () => {
					throw new Error("no URL import in this test");
				}}
				downloadImage={async () => null}
			/>
		</WrapperProvider>,
	);
	return services;
}

describe("web clip review flow", () => {
	it("opens the review for a new clip and keeps it out of shopping lists until saved", async () => {
		const store: MockRecipeStore = { recipes: [], settings: { ...DEFAULT_SETTINGS } };
		const path = "Recipes/Black Bean Chili 2026-10-17 093000.md";
		store.clips = [clipEntry(store, "complete-howtostep", path, "Black Bean Chili")];
		renderWith(store);

		expect(await screen.findByRole("heading", { name: "Review web clip" })).toBeTruthy();
		expect(screen.getByText(/not used as a recipe, or offered for\s+shopping lists/)).toBeTruthy();
		expect(screen.queryByRole("checkbox", { name: /Select Black Bean Chili/ })).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(screen.queryByRole("dialog")).toBeNull();
		// Cancelled clips stay listed as needing review and do not reopen by themselves.
		expect(screen.getByText("1 web clip needs review before it is used as a recipe.")).toBeTruthy();
		expect(screen.queryByRole("checkbox", { name: /Select Black Bean Chili/ })).toBeNull();
		expect(store.recipes).toHaveLength(0);

		fireEvent.click(screen.getByRole("button", { name: "Review web clip Black Bean Chili" }));
		await screen.findByRole("heading", { name: "Review web clip" });

		fireEvent.change(screen.getByLabelText("Ingredients (one per line)"), {
			target: {
				value: [
					"2 Tbsp. olive oil",
					"1 large onion, diced",
					"3-4 cloves garlic, minced",
					"1 ½ cups dried black beans",
					"400 g chopped tomatoes",
					"1 tsp sea salt",
				].join("\n"),
			},
		});
		fireEvent.change(screen.getByLabelText("Cooking methods (comma separated)"), {
			target: { value: "Simmering, Stovetop" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));

		await waitFor(() => expect(store.recipes).toHaveLength(1));
		const saved = store.recipes[0];
		expect(saved?.path).toBe(path);
		expect(saved?.frontmatter.type).toBe("recipe");
		expect(saved?.frontmatter.extractionMethod).toBe("json-ld");
		expect(saved?.frontmatter.ingredients.at(-1)?.raw).toBe("1 tsp sea salt");
		expect(saved?.frontmatter.cookingMethods).toEqual(["Simmering", "Stovetop"]);
		expect(saved?.frontmatter.author).toBe("Ada Lovelace");
		expect(saved?.frontmatter.siteName).toBe("Example Kitchen");
		await waitFor(() => expect(screen.queryByText(/web clip needs review/)).toBeNull());
		expect(screen.getByRole("checkbox", { name: /Select Black Bean Chili/ })).toBeTruthy();
	});

	it("warns about a repeated source URL and leaves the saved recipe's rating, images and notes alone", async () => {
		const existing = seedRecipe("Black Bean Chili", {
			path: "Recipes/black-bean-chili.md",
			notes: "Double the garlic next time.",
		});
		existing.frontmatter.sourceUrl = "https://example-kitchen.test/recipes/black-bean-chili";
		existing.frontmatter.rating = 5;
		existing.frontmatter.images = [
			{ path: "Recipes/_attachments/x/cover.webp", alt: "My bowl", sourceUrl: null, isPrimary: true },
		];
		const snapshot = structuredClone(existing);
		const store: MockRecipeStore = { recipes: [existing], settings: { ...DEFAULT_SETTINGS } };
		const clipPath = "Recipes/Black Bean Chili 2026-10-17 100000.md";
		store.clips = [clipEntry(store, "repeat-url", clipPath, "Black Bean Chili")];
		renderWith(store);

		await screen.findByRole("heading", { name: "Review web clip" });
		expect(screen.getByText(/already saved/i)).toBeTruthy();
		expect(screen.getByText("Recipes/black-bean-chili.md")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
		await waitFor(() => expect(store.recipes).toHaveLength(2));
		expect(store.recipes[0]).toEqual(snapshot);
		expect(store.recipes[1]?.path).toBe(clipPath);
		expect(store.recipes[1]?.frontmatter.id).not.toBe(existing.frontmatter.id);
		expect(store.recipes[1]?.frontmatter.rating).toBeNull();
		expect(store.recipes[1]?.frontmatter.images).toEqual([]);
	});

	it("reviews a clip without schema.org data as a manual entry and fills nothing in", async () => {
		const store: MockRecipeStore = { recipes: [], settings: { ...DEFAULT_SETTINGS } };
		store.clips = [clipEntry(store, "no-schema", "Recipes/market.md", "Saturday market report")];
		renderWith(store);

		await screen.findByRole("heading", { name: "Review web clip" });
		expect(screen.getByText(/This clip has no schema\.org recipe data/)).toBeTruthy();
		expect((screen.getByLabelText("Ingredients (one per line)") as HTMLTextAreaElement).value).toBe("");
		fireEvent.click(screen.getByRole("button", { name: "Save manual entry" }));
		await waitFor(() => expect(store.recipes).toHaveLength(1));
		expect(store.recipes[0]?.frontmatter.extractionMethod).toBe("manual");
		expect(store.recipes[0]?.frontmatter.ingredients).toEqual([]);
		expect(store.recipes[0]?.instructions).toEqual([]);
	});

	it("opens a clip created later, but waits for the recipe editor to close", async () => {
		const store: MockRecipeStore = { recipes: [], settings: { ...DEFAULT_SETTINGS } };
		const services = renderWith(store);
		fireEvent.click(screen.getByRole("button", { name: "New recipe" }));
		expect(screen.getByRole("heading", { name: "New recipe" })).toBeTruthy();

		// The clipper writes a note while the editor is open; the vault change notifies the view.
		store.clips = [clipEntry(store, "partial-string-steps", "Recipes/flatbread.md", "Quick Flatbread")];
		await act(async () => {
			await services.deleteRecipe("rec_none");
		});
		expect(screen.queryByRole("heading", { name: "Review web clip" })).toBeNull();
		expect(screen.getByText("1 web clip needs review before it is used as a recipe.")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(await screen.findByRole("heading", { name: "Review web clip" })).toBeTruthy();
		expect(screen.getByText("Grace Hopper")).toBeTruthy();
	});

	it("says so when a pending clip can no longer be read", async () => {
		const store: MockRecipeStore = { recipes: [], settings: { ...DEFAULT_SETTINGS } };
		store.clips = [
			{
				path: "Recipes/gone.md",
				title: "Gone",
				review: () => null as never,
			},
		];
		renderWith(store);
		expect(await screen.findByText(/could not be read\. It still needs review/)).toBeTruthy();
	});
});
