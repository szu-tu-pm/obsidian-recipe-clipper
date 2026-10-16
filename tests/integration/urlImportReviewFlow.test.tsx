import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractRecipeFromPage } from "../../src/domain/extraction/urlClipper";
import { ensureHttpsUrl } from "../../src/ui/importRecipePage";
import type { UrlExtractionResult } from "../../src/domain/extraction/types";
import { DEFAULT_SETTINGS } from "../../src/pluginSettings";
import { CollectionView } from "../../src/ui/CollectionView";
import { WrapperProvider } from "../../src/wrapper/WrapperContext";
import {
	createMockPluginServices,
	seedRecipe,
	type MockRecipeStore,
} from "../helpers/mockPluginServices";

afterEach(() => {
	cleanup();
});

const NOW = "2026-10-16T16:00:00.000Z";

function renderCollection(
	store: MockRecipeStore,
	importPage: (url: string) => Promise<UrlExtractionResult>,
	downloadImage: (url: string) => Promise<ArrayBuffer | null> = async () => {
		throw new Error("image download was not confirmed");
	},
	notify: (message: string) => void = () => undefined,
) {
	const services = createMockPluginServices(store);
	render(
		<WrapperProvider services={services}>
			<CollectionView
				importPage={async (url) => importPage(url)}
				downloadImage={downloadImage}
				notify={notify}
			/>
		</WrapperProvider>,
	);
	return services;
}

async function openImport(result: UrlExtractionResult, store?: MockRecipeStore) {
	renderCollection(store ?? { recipes: [], settings: { ...DEFAULT_SETTINGS } }, async () => result);
	fireEvent.click(screen.getByRole("button", { name: "Import URL" }));
	fireEvent.change(screen.getByLabelText("Recipe URL"), {
		target: { value: "https://example.com/chili" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Start import" }));
	await screen.findByRole("dialog");
}

describe("url import review", () => {
	it("prepends https:// when a pasted URL has no protocol", async () => {
		expect(ensureHttpsUrl("https://example.com/chili")).toBe("https://example.com/chili");
		expect(ensureHttpsUrl("http://example.com/chili")).toBe("http://example.com/chili");
		const seen: string[] = [];
		renderCollection({ recipes: [], settings: { ...DEFAULT_SETTINGS } }, async (url) => {
			seen.push(url);
			throw new Error("stop after the URL is prepared");
		});
		fireEvent.click(screen.getByRole("button", { name: "Import URL" }));
		fireEvent.change(screen.getByLabelText("Recipe URL"), {
			target: { value: "allrecipes.com/recipe/123" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Start import" }));
		await waitFor(() => expect(seen).toEqual(["https://allrecipes.com/recipe/123"]));
		expect(screen.getByText("stop after the URL is prepared")).toBeTruthy();
	});

	it("offers Import URL and Add manually on an empty collection", () => {
		renderCollection({ recipes: [], settings: { ...DEFAULT_SETTINGS } }, async () => {
			throw new Error("import should not start");
		});
		expect(screen.getByRole("button", { name: "Import URL" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Add manually" })).toBeTruthy();
	});

	it("does not write a reviewed import until save, and keeps ambiguous raw text", async () => {
		const store: MockRecipeStore = { recipes: [], settings: { ...DEFAULT_SETTINGS } };
		const result = await extractRecipeFromPage({
			html: `<html><body><script type="application/ld+json">
				{"@type":"Recipe","name":"Chili","author":"Ada","recipeYield":"4 servings",
				"recipeIngredient":["1 lb beef","??? leftover bits"],
				"recipeInstructions":["Brown the beef."],"url":"https://example.com/chili"}
			</script></body></html>`,
			pageUrl: "https://example.com/chili",
			now: () => NOW,
		});
		await openImport(result, store);

		expect(screen.getByText("??? leftover bits")).toBeTruthy();
		expect(screen.getByText("ambiguous")).toBeTruthy();
		expect(screen.getByText("Ada")).toBeTruthy();
		expect(store.recipes).toHaveLength(0);

		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(store.recipes).toHaveLength(0);

		fireEvent.click(screen.getByRole("button", { name: "Import URL" }));
		fireEvent.change(screen.getByLabelText("Recipe URL"), {
			target: { value: "https://example.com/chili" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Start import" }));
		await screen.findByRole("heading", { name: "Review import" });
		fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
		await waitFor(() => expect(store.recipes).toHaveLength(1));
		const saved = store.recipes[0];
		expect(saved?.frontmatter.extractionMethod).toBe("json-ld");
		expect(saved?.frontmatter.ingredients.map((item) => item.raw)).toContain("??? leftover bits");
		expect(saved?.frontmatter.ingredients.find((item) => item.raw.includes("leftover"))?.quantity).toBeNull();
		expect(saved?.frontmatter.images).toEqual([]);
		expect(saved?.frontmatter.cookTimeMinutes).toBeNull();
	});

	it("warns when the source URL is already in the vault and still requires confirm", async () => {
		const existing = seedRecipe("Old Chili");
		existing.path = "Recipes/Old Chili.md";
		existing.frontmatter.sourceUrl = "https://example.com/chili";
		const store: MockRecipeStore = {
			recipes: [existing],
			settings: { ...DEFAULT_SETTINGS },
		};
		const result = await extractRecipeFromPage({
			html: `<html><body><script type="application/ld+json">
				{"@type":"Recipe","name":"Chili again","recipeIngredient":["1 cup stock"],
				"recipeInstructions":["Simmer."],"url":"https://example.com/chili"}
			</script></body></html>`,
			pageUrl: "https://example.com/chili",
			now: () => NOW,
		});
		await openImport(result, store);
		expect(screen.getByText(/already saved/i)).toBeTruthy();
		expect(screen.getByText("Recipes/Old Chili.md")).toBeTruthy();
		expect(store.recipes).toHaveLength(1);
		fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
		await waitFor(() => expect(store.recipes).toHaveLength(2));
		expect(store.recipes[0]?.frontmatter.id).toBe(existing.frontmatter.id);
	});

	it("keeps a paywalled URL for manual entry without claiming success", async () => {
		const store: MockRecipeStore = { recipes: [], settings: { ...DEFAULT_SETTINGS } };
		const result = await extractRecipeFromPage({
			html: `<html><head><title>Members</title></head><body><div class="paywall">Subscribe to continue reading</div></body></html>`,
			pageUrl: "https://example.com/members",
			now: () => NOW,
		});
		await openImport(result, store);
		expect(screen.getByText(/did not succeed/i)).toBeTruthy();
		expect(screen.getByText("https://example.com/members")).toBeTruthy();
		expect(store.recipes).toHaveLength(0);
		fireEvent.click(screen.getByRole("button", { name: "Save manual entry" }));
		await waitFor(() => expect(store.recipes).toHaveLength(1));
		expect(store.recipes[0]?.frontmatter.extractionMethod).toBe("manual");
		expect(store.recipes[0]?.frontmatter.sourceUrl).toBe("https://example.com/members");
		expect(store.recipes[0]?.frontmatter.ingredients).toEqual([]);
	});

	it("asks which recipe to review and does not save on cancel", async () => {
		const store: MockRecipeStore = { recipes: [], settings: { ...DEFAULT_SETTINGS } };
		const result = await extractRecipeFromPage({
			html: `<html><body><script type="application/ld+json">
				{"@graph":[
					{"@type":"Recipe","name":"First","recipeIngredient":["1 cup a"],"recipeInstructions":["Do a."]},
					{"@type":"Recipe","name":"Second","recipeIngredient":["2 cups b"],"recipeInstructions":["Do b."]}
				]}
			</script></body></html>`,
			pageUrl: "https://example.com/two",
			now: () => NOW,
		});
		await openImport(result, store);
		fireEvent.click(screen.getByRole("button", { name: "Second" }));
		expect(await screen.findByRole("heading", { name: "Review import" })).toBeTruthy();
		expect(screen.getByText("2 cups b")).toBeTruthy();
		fireEvent.keyDown(window, { key: "Escape" });
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(store.recipes).toHaveLength(0);
	});

	it("downloads a source image only after it is checked", async () => {
		const store: MockRecipeStore = { recipes: [], settings: { ...DEFAULT_SETTINGS } };
		const result = await extractRecipeFromPage({
			html: `<html><body><script type="application/ld+json">
				{"@type":"Recipe","name":"Pancakes","image":"https://cdn.example/pancakes.jpg",
				"recipeIngredient":["1 cup flour"],"recipeInstructions":["Mix."]}
			</script></body></html>`,
			pageUrl: "https://example.com/pancakes",
			now: () => NOW,
		});
		const downloadImage = vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer);
		const services = createMockPluginServices(store);
		render(
			<WrapperProvider services={services}>
				<CollectionView importPage={async () => result} downloadImage={downloadImage} />
			</WrapperProvider>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Import URL" }));
		fireEvent.change(screen.getByLabelText("Recipe URL"), {
			target: { value: "https://example.com/pancakes" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Start import" }));
		await screen.findByRole("heading", { name: "Review import" });
		fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
		await waitFor(() => expect(store.recipes).toHaveLength(1));
		expect(downloadImage).not.toHaveBeenCalled();
		expect(store.recipes[0]?.frontmatter.images).toEqual([]);

		cleanup();
		store.recipes = [];
		render(
			<WrapperProvider services={createMockPluginServices(store)}>
				<CollectionView importPage={async () => result} downloadImage={downloadImage} />
			</WrapperProvider>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Import URL" }));
		fireEvent.change(screen.getByLabelText("Recipe URL"), {
			target: { value: "https://example.com/pancakes" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Start import" }));
		await screen.findByRole("heading", { name: "Review import" });
		fireEvent.click(screen.getByRole("checkbox", { name: "Download this image into the vault" }));
		fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
		await waitFor(() => expect(store.recipes[0]?.frontmatter.images).toHaveLength(1));
		expect(downloadImage).toHaveBeenCalledWith("https://cdn.example/pancakes.jpg");
		expect(store.recipes[0]?.frontmatter.images[0]?.sourceUrl).toBe(
			"https://cdn.example/pancakes.jpg",
		);
	});

	it("keeps the saved recipe and says so when a confirmed image cannot be downloaded", async () => {
		const store: MockRecipeStore = { recipes: [], settings: { ...DEFAULT_SETTINGS } };
		const result = await extractRecipeFromPage({
			html: `<html><body><script type="application/ld+json">
				{"@type":"Recipe","name":"Pancakes","image":"https://cdn.example/pancakes.jpg",
				"recipeIngredient":["1 cup flour"],"recipeInstructions":["Mix."]}
			</script></body></html>`,
			pageUrl: "https://example.com/pancakes",
			now: () => NOW,
		});
		const notify = vi.fn();
		renderCollection(store, async () => result, async () => null, notify);
		fireEvent.click(screen.getByRole("button", { name: "Import URL" }));
		fireEvent.change(screen.getByLabelText("Recipe URL"), {
			target: { value: "https://example.com/pancakes" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Start import" }));
		await screen.findByRole("heading", { name: "Review import" });
		fireEvent.click(screen.getByRole("checkbox", { name: "Download this image into the vault" }));
		fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
		await waitFor(() => expect(store.recipes).toHaveLength(1));
		expect(store.recipes[0]?.frontmatter.images).toEqual([]);
		const notice = "The recipe was saved, but the remote image could not be downloaded.";
		expect(screen.getByText(notice)).toBeTruthy();
		expect(notify).toHaveBeenCalledWith(notice);
		expect(screen.queryByRole("dialog")).toBeNull();
	});
});
