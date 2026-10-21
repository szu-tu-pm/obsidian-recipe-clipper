// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement as h } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { requestPasteRecipe } from "../../src/ui/pasteRequests";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRecipeFile } from "../../src/domain/schema/recipeMarkdown";
import {
	computeBodyHash,
	parseRecipeFrontmatter,
	recipeFrontmatterSchema,
} from "../../src/domain/schema/recipeSchema";
import { InMemoryVault, jsonYamlCodec } from "../../src/domain/vault/inMemoryVault";
import { RecipeIndexer } from "../../src/domain/vault/recipeIndexer";
import { RecipeRepository } from "../../src/domain/vault/recipeRepository";
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

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/pasted-text");
const visible = readFileSync(join(FIXTURES, "chatgpt-thai-curry-visible.txt"), "utf8");
const markdown = readFileSync(join(FIXTURES, "chatgpt-thai-curry-markdown.md"), "utf8");
const SHARE = "https://chatgpt.com/share/6718-thai-curry";

function emptyStore(): MockRecipeStore {
	return { recipes: [], settings: { ...DEFAULT_SETTINGS } };
}

function renderCollection(store: MockRecipeStore, pasteFetch?: typeof fetch) {
	const services = createMockPluginServices(store);
	render(
		h(
			WrapperProvider,
			{ services },
			h(CollectionView, { pasteFetch, importPage: async () => Promise.reject(new Error("no URL import")) }),
		),
	);
	return services;
}

function paste(text: string, link = "") {
	fireEvent.click(screen.getByRole("button", { name: "Paste recipe" }));
	fireEvent.change(screen.getByLabelText("Recipe text"), { target: { value: text } });
	if (link) {
		fireEvent.change(screen.getByLabelText("Source link (optional)"), { target: { value: link } });
	}
}

async function review() {
	fireEvent.click(screen.getByRole("button", { name: "Review recipe" }));
	return screen.findByRole("heading", { name: "Review pasted recipe" });
}

describe("paste recipe entry points", () => {
	it("offers Paste recipe next to Add manually on an empty collection", () => {
		renderCollection(emptyStore());
		expect(screen.getByRole("button", { name: "Add manually" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Paste recipe" })).toBeTruthy();
	});

	it("offers Paste recipe in the header once there are recipes", () => {
		renderCollection({ recipes: [seedRecipe("Old")], settings: { ...DEFAULT_SETTINGS } });
		expect(screen.getByRole("button", { name: "Paste recipe" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Import URL" })).toBeTruthy();
	});

	it("opens the paste window for the command, whether the view is open or still opening", async () => {
		requestPasteRecipe();
		renderCollection(emptyStore());
		expect(await screen.findByRole("dialog", { name: "Paste recipe" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(screen.queryByRole("dialog")).toBeNull();
		act(() => requestPasteRecipe());
		expect(await screen.findByRole("dialog", { name: "Paste recipe" })).toBeTruthy();
	});

	it("keeps Review recipe disabled until there is text", () => {
		renderCollection(emptyStore());
		fireEvent.click(screen.getByRole("button", { name: "Paste recipe" }));
		const button = screen.getByRole("button", { name: "Review recipe" }) as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		fireEvent.change(screen.getByLabelText("Recipe text"), { target: { value: "  \n " } });
		expect(button.disabled).toBe(true);
	});
});

describe("paste, review, save", () => {
	it("writes nothing before save, and nothing when the review is cancelled", async () => {
		const store = emptyStore();
		renderCollection(store);
		paste(visible, SHARE);
		expect(store.recipes).toHaveLength(0);
		await review();
		expect(store.recipes).toHaveLength(0);
		expect(screen.getByText(/Nothing is\s+written to the vault until you save/)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(store.recipes).toHaveLength(0);
	});

	it("cancelling the paste window writes nothing", () => {
		const store = emptyStore();
		renderCollection(store);
		paste(visible);
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(store.recipes).toHaveLength(0);
	});

	it("shows the parsed recipe, the unlabeled-time warning and the notes in the review", async () => {
		renderCollection(emptyStore());
		paste(visible);
		await review();
		const dialog = screen.getByRole("dialog");
		expect(within(dialog).getByText("High-Protein Thai Red Chicken Curry")).toBeTruthy();
		expect(within(dialog).getByText("2–3 servings")).toBeTruthy();
		expect(within(dialog).getByText(/"35–40 min" has no Prep, Cook or Total label/)).toBeTruthy();
		expect(within(dialog).getAllByRole("listitem").length).toBeGreaterThanOrEqual(43);
		expect(dialog.textContent).toContain("My preferred version:");
		expect(dialog.textContent).not.toMatch(/Portion size|Current selection unavailable|image_group/);
	});

	it("saves a schema-valid pasted-text recipe that records the assistant and the share link", async () => {
		const store = emptyStore();
		renderCollection(store);
		paste(visible);
		fireEvent.change(screen.getByLabelText("Source link (optional)"), { target: { value: SHARE } });
		expect((screen.getByLabelText("Assistant name") as HTMLInputElement).value).toBe("ChatGPT");
		fireEvent.click(screen.getByLabelText("Written by an AI assistant"));
		await review();
		expect(screen.getByText("Written by")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
		await waitFor(() => expect(store.recipes).toHaveLength(1));
		const saved = store.recipes[0]!;
		expect(recipeFrontmatterSchema.safeParse(saved.frontmatter).success).toBe(true);
		expect(saved.frontmatter).toMatchObject({
			extractionMethod: "pasted-text",
			generatedBy: "ChatGPT",
			sourceUrl: SHARE,
			title: "High-Protein Thai Red Chicken Curry",
			servings: { raw: "2–3 servings", amount: null },
			totalTimeMinutes: null,
		});
		expect(saved.frontmatter.ingredients).toHaveLength(12);
		expect(saved.instructions).toHaveLength(31);
		expect(saved.notes).toContain("Quick cooking tips");
		expect(saved.notes).not.toMatch(/image_group|Portion size|Current selection unavailable|I can:/);
	});

	it("leaves generatedBy out when the paste is not marked as AI-written, even with a known host", async () => {
		const store = emptyStore();
		renderCollection(store);
		paste(visible, SHARE);
		await review();
		fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
		await waitFor(() => expect(store.recipes).toHaveLength(1));
		expect("generatedBy" in store.recipes[0]!.frontmatter).toBe(false);
		expect(store.recipes[0]!.frontmatter.sourceUrl).toBe(SHARE);
	});

	it("uses a typed assistant name, and a placeholder name when the box is ticked but blank", async () => {
		const store = emptyStore();
		renderCollection(store);
		paste(visible);
		fireEvent.click(screen.getByLabelText("Written by an AI assistant"));
		fireEvent.change(screen.getByLabelText("Assistant name"), { target: { value: "Mistral" } });
		fireEvent.change(screen.getByLabelText("Source link (optional)"), { target: { value: SHARE } });
		expect((screen.getByLabelText("Assistant name") as HTMLInputElement).value).toBe("Mistral");
		await review();
		fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
		await waitFor(() => expect(store.recipes).toHaveLength(1));
		expect(store.recipes[0]!.frontmatter.generatedBy).toBe("Mistral");

		paste("Eggs\nIngredients\n2 eggs\nInstructions\n1. Fry.\n");
		fireEvent.click(screen.getByLabelText("Written by an AI assistant"));
		await review();
		fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
		await waitFor(() => expect(store.recipes).toHaveLength(2));
		expect(store.recipes[1]!.frontmatter.generatedBy).toBe("AI assistant");
	});

	it("warns about the empty ingredient list for the markdown fixture and takes nothing from the steps", async () => {
		const store = emptyStore();
		renderCollection(store);
		paste(markdown);
		await review();
		const dialog = screen.getByRole("dialog");
		expect(within(dialog).getByText(/ingredient list was empty/i)).toBeTruthy();
		expect(within(dialog).getByText(/visible page/)).toBeTruthy();
		expect(within(dialog).getByText("Not in the pasted text", { selector: "p" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
		await waitFor(() => expect(store.recipes).toHaveLength(1));
		expect(store.recipes[0]!.frontmatter.ingredients).toEqual([]);
		expect(store.recipes[0]!.instructions).toHaveLength(31);
	});
});

describe("source link", () => {
	it("warns about a share link already saved, and pasting the same link twice shows the duplicate warning", async () => {
		const existing = seedRecipe("Old curry");
		existing.path = "Recipes/Old curry.md";
		existing.frontmatter.sourceUrl = SHARE;
		const store: MockRecipeStore = { recipes: [existing], settings: { ...DEFAULT_SETTINGS } };
		renderCollection(store);
		paste(visible, SHARE);
		await review();
		expect(screen.getByText(/already saved/i)).toBeTruthy();
		expect(screen.getByText("Recipes/Old curry.md")).toBeTruthy();
		expect(store.recipes).toHaveLength(1);
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
	});

	it("shows the duplicate warning for a second paste after the first was saved", async () => {
		const store = emptyStore();
		renderCollection(store);
		paste(visible, SHARE);
		await review();
		expect(screen.queryByText(/already saved/i)).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
		await waitFor(() => expect(store.recipes).toHaveLength(1));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

		paste(markdown, SHARE);
		await review();
		expect(screen.getByText(/already saved/i)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
		await waitFor(() => expect(store.recipes).toHaveLength(2));
	});

	it("drops a non-http(s) link with a warning and saves no sourceUrl", async () => {
		const store = emptyStore();
		renderCollection(store);
		paste(visible, "javascript:alert(1)");
		await review();
		expect(screen.getByText(/not an http\(s\) link/)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
		await waitFor(() => expect(store.recipes).toHaveLength(1));
		expect(store.recipes[0]!.frontmatter.sourceUrl).toBeNull();
	});
});

describe("saved file", () => {
	it("reads back unchanged from the vault, with the same bodyHash on a re-save", async () => {
		const store = emptyStore();
		renderCollection(store);
		paste(visible, SHARE);
		fireEvent.click(screen.getByLabelText("Written by an AI assistant"));
		await review();
		fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
		await waitFor(() => expect(store.recipes).toHaveLength(1));
		const draft = store.recipes[0]!;

		const vault = new InMemoryVault();
		const indexer = new RecipeIndexer("Recipes", "Recipes/_attachments");
		const repository = new RecipeRepository(vault, jsonYamlCodec, indexer, "Recipes");
		const saved = await repository.save(draft);
		indexer.rebuildFromCache(vault);
		const loaded = await repository.loadById(saved.frontmatter.id);
		expect(loaded.ok).toBe(true);
		if (!loaded.ok) {
			return;
		}
		expect(loaded.recipe.editedExternally).toBe(false);
		expect(loaded.recipe.frontmatter).toEqual({
			...saved.frontmatter,
			bodyHash: expect.any(String),
		});
		expect(loaded.recipe.instructions).toEqual(draft.instructions);
		expect(loaded.recipe.notes).toBe(draft.notes);
		expect(loaded.recipe.frontmatter.generatedBy).toBe("ChatGPT");
		expect(loaded.recipe.frontmatter.extractionMethod).toBe("pasted-text");
		expect(loaded.recipe.frontmatter.ingredients).toEqual(draft.frontmatter.ingredients);
		// A second read of the stored text parses to the same recipe (hash matches, no external edit).
		const again = parseRecipeFile(await vault.read(loaded.recipe.path!), jsonYamlCodec);
		expect(again.editedExternally).toBe(false);
		expect(again.frontmatter.bodyHash).toBe(loaded.recipe.frontmatter.bodyHash);
	});

	it("keeps the bodyHash of a recipe file written before generatedBy and pasted-text existed", () => {
		const legacy = {
			schemaVersion: 2,
			type: "recipe",
			id: "rec_01JQC0TEST0000000000000000",
			title: "Legacy Soup",
			sourceUrl: "https://example.com/soup",
			author: null,
			siteName: "Example",
			importedAt: "2026-10-14T00:00:00.000Z",
			updatedAt: "2026-10-14T00:00:00.000Z",
			extractionMethod: "json-ld",
			servings: { raw: "4 servings", amount: 4 },
			prepTimeMinutes: 10,
			cookTimeMinutes: 20,
			totalTimeMinutes: 30,
			cookingMethods: ["simmer"],
			rating: 4,
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
					parseConfidence: "exact",
				},
			],
		};
		const parsed = parseRecipeFrontmatter(legacy);
		expect("generatedBy" in parsed).toBe(false);
		expect(Object.keys(parsed)).not.toContain("generatedBy");
		// Computed with the schema as it was before this change (git HEAD), not with this code.
		expect(computeBodyHash(parsed, "# Legacy Soup\n\n## Ingredients\n\n- 1 cup stock\n")).toBe("42218546");
	});

	it("appends generatedBy after translation so the key order of older fields is unchanged", () => {
		const keys = Object.keys(recipeFrontmatterSchema.shape);
		expect(keys.slice(-3)).toEqual(["bodyHash", "translation", "generatedBy"]);
	});
});

describe("optional local model for text with no sections", () => {
	const TEXT = "Weeknight lentil soup\n\nI simmered 1 cup red lentils with 4 cups water for 25 minutes.\nThen I stirred in lemon juice.\n";
	const reply = {
		title: "Weeknight lentil soup",
		ingredientsRaw: ["1 cup red lentils", "2 cups saffron"],
		instructions: ["Then I stirred in lemon juice.", "Garnish with truffle shavings."],
		servingsRaw: "serves 6",
	};
	const modelFetch = (calls: string[]): typeof fetch =>
		(async (url: string | URL | Request) => {
			calls.push(String(url));
			return String(url).endsWith("/api/tags")
				? new Response("{}", { status: 200 })
				: new Response(JSON.stringify({ message: { content: JSON.stringify(reply) } }), { status: 200 });
		}) as typeof fetch;

	it("does not contact the model unless asked, and shows the empty draft with a warning", async () => {
		const calls: string[] = [];
		renderCollection(emptyStore(), modelFetch(calls));
		paste(TEXT);
		await review();
		expect(calls).toEqual([]);
		expect(screen.getByText(/No Ingredients or Instructions section was found/)).toBeTruthy();
		expect(screen.queryByText("1 cup red lentils")).toBeNull();
	});

	it("keeps only grounded model values in the review and saves them as pasted text", async () => {
		const calls: string[] = [];
		const store = emptyStore();
		renderCollection(store, modelFetch(calls));
		paste(TEXT);
		fireEvent.click(screen.getByLabelText(/ask my local Ollama model/));
		await review();
		expect(calls.map((url) => new URL(url).pathname)).toEqual(["/api/tags", "/api/chat"]);
		const dialog = screen.getByRole("dialog");
		expect(within(dialog).getByText("1 cup red lentils")).toBeTruthy();
		expect(within(dialog).getByText("Then I stirred in lemon juice.")).toBeTruthy();
		expect(dialog.textContent).not.toMatch(/saffron|truffle|serves 6/);
		expect(within(dialog).getByText(/local model extracted these fields/)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
		await waitFor(() => expect(store.recipes).toHaveLength(1));
		expect(store.recipes[0]!.frontmatter.extractionMethod).toBe("pasted-text");
		expect(store.recipes[0]!.frontmatter.servings).toBeNull();
	});

	it("does not open a review when the model request is cancelled", async () => {
		let release: (() => void) | undefined;
		const slow: typeof fetch = ((_url: string, init?: RequestInit) =>
			new Promise<Response>((_resolve, reject) => {
				release = () => reject(new DOMException("aborted", "AbortError"));
				init?.signal?.addEventListener("abort", () => release?.());
			})) as unknown as typeof fetch;
		const store = emptyStore();
		renderCollection(store, slow);
		paste(TEXT);
		fireEvent.click(screen.getByLabelText(/ask my local Ollama model/));
		fireEvent.click(screen.getByRole("button", { name: "Review recipe" }));
		expect(await screen.findByText("Asking the local model...")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(store.recipes).toHaveLength(0);
	});
});
