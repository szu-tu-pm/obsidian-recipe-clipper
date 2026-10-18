import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecipeDocument } from "../../src/domain/schema/recipeSchema";
import {
	applyTranslation,
	revertTranslation,
} from "../../src/domain/translation/recipeTranslator";
import { DEFAULT_SETTINGS } from "../../src/pluginSettings";
import { CollectionView } from "../../src/ui/CollectionView";
import { WrapperProvider } from "../../src/wrapper/WrapperContext";
import { createMockPluginServices } from "../helpers/mockPluginServices";
import {
	FRENCH,
	recipeFrom,
	recordedReply,
	scampiRecipe,
	SHRIMP,
	shoppingRows,
	texts,
} from "../helpers/translationFixtures";

const output = recordedReply;

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
	const recipe = recipeFrom(SHRIMP);
	recipe.frontmatter.rating = 5;
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
		expect(after.frontmatter.ingredients.map((item) => item.raw)).toEqual(texts(FRENCH.ingredients));
		expect(after.instructions).toEqual(texts(FRENCH.instructions));
		expect(after.frontmatter.id).toBe(snapshot.frontmatter.id);
		expect(after.frontmatter.rating).toBe(5);
		expect(after.frontmatter.images).toEqual(snapshot.frontmatter.images);
		expect(after.notes).toBe("Family favourite.");
		expect(after.frontmatter.translation?.original.ingredients.map((item) => item.raw)).toEqual(
			texts(SHRIMP.ingredients),
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
		expect(after.frontmatter.title).toBe(SHRIMP.title);
		expect(after.frontmatter.ingredients).toEqual(original.frontmatter.ingredients);
		expect(after.instructions).toEqual(texts(SHRIMP.instructions));
		expect(after.frontmatter.translation).toBeUndefined();
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(screen.queryByRole("dialog", { name: "Discard edits?" })).toBeNull();
	});

	function editedTranslation(): RecipeDocument {
		const translated = applyTranslation(shrimpRecipe(), FRENCH, "French");
		return {
			...translated,
			frontmatter: {
				...translated.frontmatter,
				ingredients: translated.frontmatter.ingredients.map((item, index) =>
					index === 3 ? { ...item, id: "ing_0000000000000000000000ED01", raw: "1 tsp sel fin" } : item,
				),
			},
		};
	}

	it("asks before a revert discards edits made after translating, and cancel changes nothing", async () => {
		const edited = editedTranslation();
		const { save, snapshot, stored } = setup(vi.fn() as unknown as typeof fetch, edited);
		const dialog = await openTranslate("Spanish");
		fireEvent.click(within(dialog).getByRole("button", { name: "Restore original" }));
		const confirm = await screen.findByRole("dialog", { name: "Discard edits?" });
		expect(confirm.textContent).toMatch(/will be discarded/);
		fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
		expect(screen.queryByRole("dialog", { name: "Discard edits?" })).toBeNull();
		expect(save).not.toHaveBeenCalled();
		expect(await stored()).toEqual(snapshot);
	});

	it("asks before a revert discards a structured-field edit (same id and text), and cancel keeps it", async () => {
		const translated = applyTranslation(shrimpRecipe(), FRENCH, "French");
		const edited: RecipeDocument = {
			...translated,
			frontmatter: {
				...translated.frontmatter,
				ingredients: translated.frontmatter.ingredients.map((item, index) =>
					index === 2 ? { ...item, quantity: 6 } : item,
				),
			},
		};
		const { save, stored } = setup(vi.fn() as unknown as typeof fetch, edited);
		const dialog = await openTranslate("Spanish");
		fireEvent.click(within(dialog).getByRole("button", { name: "Restore original" }));
		const confirm = await screen.findByRole("dialog", { name: "Discard edits?" });
		fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
		expect(save).not.toHaveBeenCalled();
		expect((await stored()).frontmatter.ingredients[2].quantity).toBe(6);
	});

	it("does not ask before reverting when only notes, rating or images changed", async () => {
		const translated = applyTranslation(shrimpRecipe(), FRENCH, "French");
		const cosmetic: RecipeDocument = {
			...translated,
			notes: "New notes.",
			frontmatter: { ...translated.frontmatter, rating: 1, images: [] },
		};
		const { stored } = setup(vi.fn() as unknown as typeof fetch, cosmetic);
		const dialog = await openTranslate("Spanish");
		fireEvent.click(within(dialog).getByRole("button", { name: "Restore original" }));
		await screen.findByText("Original recipe text restored.");
		expect(screen.queryByRole("dialog", { name: "Discard edits?" })).toBeNull();
		const after = await stored();
		expect(after.frontmatter.ingredients).toEqual(shrimpRecipe().frontmatter.ingredients);
		expect(after.notes).toBe("New notes.");
		expect(after.frontmatter.rating).toBe(1);
		expect(after.frontmatter.images).toEqual([]);
	});

	it("after confirming, a revert writes back exactly the stored original", async () => {
		const original = shrimpRecipe();
		const { stored } = setup(vi.fn() as unknown as typeof fetch, editedTranslation());
		const dialog = await openTranslate("Spanish");
		fireEvent.click(within(dialog).getByRole("button", { name: "Restore original" }));
		const confirm = await screen.findByRole("dialog", { name: "Discard edits?" });
		fireEvent.click(within(confirm).getByRole("button", { name: "Discard edits and restore" }));
		await screen.findByText("Original recipe text restored.");
		const after = await stored();
		expect(after.frontmatter.title).toBe(original.frontmatter.title);
		expect(after.frontmatter.ingredients).toEqual(original.frontmatter.ingredients);
		expect(after.instructions).toEqual(original.instructions);
		expect(after.frontmatter.translation).toBeUndefined();
		expect(after.notes).toBe(original.notes);
		expect(after.frontmatter.rating).toBe(original.frontmatter.rating);
		expect(after.frontmatter.images).toEqual(original.frontmatter.images);
	});

	it("re-translating an edited recipe sends the stored original and asks before accepting", async () => {
		const spanish = recordedReply("valid-spanish-reordered-words");
		const fetchImpl = ollamaReturning(spanish);
		const { save, stored } = setup(fetchImpl, editedTranslation());
		const dialog = await openTranslate("Spanish");
		fireEvent.click(within(dialog).getByRole("button", { name: "Translate" }));
		await within(dialog).findByRole("table");
		const body = JSON.parse(String((vi.mocked(fetchImpl).mock.calls[1][1] as RequestInit).body));
		expect(body.messages[1].content).toContain(JSON.stringify(SHRIMP));
		fireEvent.click(within(dialog).getByRole("button", { name: "Accept translation" }));
		const confirm = await screen.findByRole("dialog", { name: "Discard edits?" });
		expect(save).not.toHaveBeenCalled();
		fireEvent.click(within(confirm).getByRole("button", { name: "Discard edits and accept" }));
		await screen.findByText(/Recipe translated to Spanish/);
		const after = await stored();
		expect(after.frontmatter.ingredients.map((item) => item.id)).toEqual(
			shrimpRecipe().frontmatter.ingredients.map((item) => item.id),
		);
		expect(after.frontmatter.translation?.original.ingredients).toEqual(
			shrimpRecipe().frontmatter.ingredients,
		);
	});
});

describe("RecipeEditorModal with a translated recipe", () => {
	const FR = texts(FRENCH.ingredients);
	const SRC = texts(SHRIMP.ingredients);

	async function saveIngredients(lines: string[]) {
		const translated = applyTranslation(shrimpRecipe(), FRENCH, "French");
		const { stored } = setup(vi.fn() as unknown as typeof fetch, translated);
		fireEvent.click(screen.getByRole("button", { name: "Edit" }));
		fireEvent.change(await screen.findByLabelText("Ingredients (one per line)"), {
			target: { value: lines.join("\n") },
		});
		fireEvent.click(screen.getByRole("button", { name: "4 stars" }));
		fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
		await waitFor(async () => expect((await stored()).frontmatter.rating).toBe(4));
		return { translated, after: await stored() };
	}
	const ids = (recipe: RecipeDocument) => recipe.frontmatter.ingredients.map((item) => item.id);

	it.each([
		["no", FR, [0, 1, 2, 3, 4]],
		["a casing-only", [FR[0], "3 TBSP Beurre (Doux)", ...FR.slice(2)], [0, 1, 2, 3, 4]],
		["a whitespace-only", [FR[0], "3   tbsp beurre  (doux)", ...FR.slice(2)], [0, 1, 2, 3, 4]],
		["a reorder", [FR[0], FR[1], FR[2], FR[4], FR[3]], [0, 1, 2, 4, 3]],
	])(
		"saving with %s edit keeps every id and aggregation; revert gives the whole original",
		async (_name, lines, order) => {
			const { translated, after } = await saveIngredients(lines);
			expect(ids(after)).toEqual(order.map((i) => ids(translated)[i]));
			expect(after.frontmatter.translation).toEqual(translated.frontmatter.translation);
			expect(shoppingRows([after, scampiRecipe()])).toEqual(
				shoppingRows([shrimpRecipe(), scampiRecipe()]),
			);
			expect(revertTranslation(after).frontmatter.ingredients).toEqual(shrimpRecipe().frontmatter.ingredients);
			expect(revertTranslation(after).frontmatter.ingredients.map((item) => item.raw)).toEqual(SRC);
		},
	);

	it("saving a substantive edit re-parses only that line and keeps the stored originals", async () => {
		const { translated, after } = await saveIngredients([FR[0], FR[1], FR[2], "1 tsp sel fin", FR[4]]);
		const before = ids(translated);
		expect(ids(after).filter((id, i) => id === before[i])).toHaveLength(4);
		expect(after.frontmatter.ingredients[3].raw).toBe("1 tsp sel fin");
		expect(after.frontmatter.translation).toEqual(translated.frontmatter.translation);
	});
});
