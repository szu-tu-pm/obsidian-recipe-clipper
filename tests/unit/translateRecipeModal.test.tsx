import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseIngredientLine } from "../../src/domain/aggregation/stage1LexicalParser";
import type { RecipeDocument } from "../../src/domain/schema/recipeSchema";
import {
	applyTranslation,
	type TranslationText,
} from "../../src/domain/translation/recipeTranslator";
import { DEFAULT_SETTINGS } from "../../src/pluginSettings";
import { CollectionView } from "../../src/ui/CollectionView";
import { WrapperProvider } from "../../src/wrapper/WrapperContext";
import { createMockPluginServices, seedRecipe } from "../helpers/mockPluginServices";

const recorded = JSON.parse(
	readFileSync("tests/fixtures/translation/recorded-responses.json", "utf8"),
) as {
	source: TranslationText;
	responses: Array<{ id: string; output?: TranslationText }>;
};
const SOURCE = recorded.source;
const output = (id: string) => recorded.responses.find((item) => item.id === id)!.output!;
const FRENCH = output("valid-french");

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function ollamaReturning(translation: unknown): typeof fetch {
	return vi.fn(async (url: string | URL | Request) =>
		String(url).endsWith("/api/tags")
			? jsonResponse({ models: [] })
			: jsonResponse({ message: { content: JSON.stringify(translation) } }),
	) as unknown as typeof fetch;
}

function hangingOllama(): typeof fetch {
	return vi.fn((url: string | URL | Request, init?: RequestInit) => {
		if (String(url).endsWith("/api/tags")) {
			return Promise.resolve(jsonResponse({}));
		}
		return new Promise<Response>((_resolve, reject) => {
			init?.signal?.addEventListener("abort", () =>
				reject(new DOMException("Aborted", "AbortError")),
			);
		});
	}) as unknown as typeof fetch;
}

function shrimpRecipe(): RecipeDocument {
	const recipe = seedRecipe(SOURCE.title);
	recipe.frontmatter.ingredients = SOURCE.ingredients.map(parseIngredientLine);
	recipe.frontmatter.rating = 5;
	recipe.frontmatter.images = [
		{ path: "Recipes/_attachments/shrimp.jpg", alt: "", sourceUrl: null, isPrimary: true },
	];
	recipe.instructions = [...SOURCE.instructions];
	recipe.notes = "Family favourite.";
	return recipe;
}

function setup(fetchImpl: typeof fetch, recipe: RecipeDocument = shrimpRecipe()) {
	const services = createMockPluginServices({
		recipes: [recipe],
		settings: { ...DEFAULT_SETTINGS, ollamaTimeoutMs: 25_000 },
	});
	const save = vi.spyOn(services, "saveRecipe");
	const snapshot = structuredClone(recipe);
	render(
		<WrapperProvider services={services}>
			<CollectionView translationFetch={fetchImpl} />
		</WrapperProvider>,
	);
	const stored = async () => {
		const loaded = await services.loadRecipe(recipe.frontmatter.id);
		if (!loaded.ok) {
			throw new Error(loaded.message);
		}
		return loaded.recipe;
	};
	return { services, save, snapshot, stored };
}

async function openTranslate(language = "French"): Promise<HTMLElement> {
	fireEvent.click(screen.getByRole("button", { name: "Translate" }));
	const dialog = await screen.findByRole("dialog", { name: "Translate recipe" });
	fireEvent.change(within(dialog).getByLabelText("Target language"), {
		target: { value: language },
	});
	return dialog;
}

describe("TranslateRecipeModal", () => {
	it("shows the original and the translation side by side and writes nothing until accepted", async () => {
		const { save, snapshot, stored } = setup(ollamaReturning(FRENCH));
		const dialog = await openTranslate();
		fireEvent.click(within(dialog).getByRole("button", { name: "Translate" }));

		const table = await within(dialog).findByRole("table", { name: "Review the translation" });
		const butterRow = within(table).getByRole("row", { name: /Ingredient 2/ });
		expect(within(butterRow).getByText("3 tbsp butter (unsalted)")).toBeTruthy();
		expect(within(butterRow).getByText("3 tbsp beurre (doux)")).toBeTruthy();
		expect(within(table).getAllByRole("row")).toHaveLength(1 + 1 + 5 + 3);
		expect(save).not.toHaveBeenCalled();
		expect(await stored()).toEqual(snapshot);

		fireEvent.click(within(dialog).getByRole("button", { name: "Accept translation" }));
		await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
		await screen.findByText(/Recipe translated to French/);

		const after = await stored();
		expect(after.frontmatter.title).toBe(FRENCH.title);
		expect(after.frontmatter.ingredients.map((item) => item.raw)).toEqual(FRENCH.ingredients);
		expect(after.instructions).toEqual(FRENCH.instructions);
		expect(after.frontmatter.id).toBe(snapshot.frontmatter.id);
		expect(after.frontmatter.rating).toBe(5);
		expect(after.frontmatter.images).toEqual(snapshot.frontmatter.images);
		expect(after.notes).toBe("Family favourite.");
		expect(after.frontmatter.translation?.original.ingredients.map((item) => item.raw)).toEqual(
			SOURCE.ingredients,
		);
	});

	it("discards a reviewed translation without saving", async () => {
		const { save, snapshot, stored } = setup(ollamaReturning(FRENCH));
		const dialog = await openTranslate();
		fireEvent.click(within(dialog).getByRole("button", { name: "Translate" }));
		fireEvent.click(await within(dialog).findByRole("button", { name: "Discard" }));
		expect(within(dialog).queryByRole("table")).toBeNull();
		fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
		expect(save).not.toHaveBeenCalled();
		expect(await stored()).toEqual(snapshot);
	});

	it.each([
		["change-amount-butter", "Ingredient 2 changed its numbers (3 → 2)."],
		["add-step-serving-tip", "Expected 3 steps, got 4."],
		["drop-line-salt", "Expected 5 ingredient lines, got 4."],
	])("rejects the recorded %s response and leaves the recipe unchanged", async (id, problem) => {
		const { save, snapshot, stored } = setup(ollamaReturning(output(id)));
		const dialog = await openTranslate();
		fireEvent.click(within(dialog).getByRole("button", { name: "Translate" }));
		expect((await within(dialog).findByRole("alert")).textContent).toMatch(
			/Translation failed. The recipe was not changed./,
		);
		expect(within(dialog).getByText(problem)).toBeTruthy();
		expect(within(dialog).queryByRole("button", { name: "Accept translation" })).toBeNull();
		expect(save).not.toHaveBeenCalled();
		expect(await stored()).toEqual(snapshot);
	});

	it("leaves the recipe unchanged when Ollama times out", async () => {
		const services = createMockPluginServices({
			recipes: [shrimpRecipe()],
			settings: { ...DEFAULT_SETTINGS, ollamaTimeoutMs: 5 },
		});
		const save = vi.spyOn(services, "saveRecipe");
		render(
			<WrapperProvider services={services}>
				<CollectionView translationFetch={hangingOllama()} />
			</WrapperProvider>,
		);
		const dialog = await openTranslate();
		fireEvent.click(within(dialog).getByRole("button", { name: "Translate" }));
		await within(dialog).findByText("Local Ollama timed out.");
		expect(save).not.toHaveBeenCalled();
	});

	it("cancels a running translation and leaves the recipe unchanged", async () => {
		const { save, snapshot, stored } = setup(hangingOllama());
		const dialog = await openTranslate();
		fireEvent.click(within(dialog).getByRole("button", { name: "Translate" }));
		fireEvent.click(await within(dialog).findByRole("button", { name: "Cancel translation" }));
		expect((await within(dialog).findByRole("alert")).textContent).toMatch(/cancelled/);
		expect(save).not.toHaveBeenCalled();
		expect(await stored()).toEqual(snapshot);
	});

	it("restores the original text of a translated recipe", async () => {
		const original = shrimpRecipe();
		const translated = applyTranslation(original, FRENCH, "French");
		const fetchImpl = vi.fn() as unknown as typeof fetch;
		const { stored } = setup(fetchImpl, translated);
		const dialog = await openTranslate("Spanish");
		expect(within(dialog).getByText(/Currently translated to French/)).toBeTruthy();
		fireEvent.click(within(dialog).getByRole("button", { name: "Restore original" }));
		await screen.findByText("Original recipe text restored.");
		const after = await stored();
		expect(after.frontmatter.title).toBe(SOURCE.title);
		expect(after.frontmatter.ingredients).toEqual(original.frontmatter.ingredients);
		expect(after.instructions).toEqual(SOURCE.instructions);
		expect(after.frontmatter.translation).toBeUndefined();
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});

describe("RecipeEditorModal with a translated recipe", () => {
	it("keeps the structured identity of unchanged translated lines on save", async () => {
		const translated = applyTranslation(shrimpRecipe(), FRENCH, "French");
		const { stored } = setup(vi.fn() as unknown as typeof fetch, translated);
		fireEvent.click(screen.getByRole("button", { name: "Edit" }));
		fireEvent.click(await screen.findByRole("button", { name: "4 stars" }));
		fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
		await waitFor(async () => expect((await stored()).frontmatter.rating).toBe(4));
		const after = await stored();
		expect(after.frontmatter.ingredients).toEqual(translated.frontmatter.ingredients);
		expect(after.frontmatter.translation).toEqual(translated.frontmatter.translation);
	});
});
