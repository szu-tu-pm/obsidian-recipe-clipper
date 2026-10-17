import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { aggregateIngredients } from "../../src/domain/aggregation/aggregator";
import { parseIngredientLine } from "../../src/domain/aggregation/stage1LexicalParser";
import { parseModelContent } from "../../src/domain/extraction/ollamaExtractor";
import { parseRecipeFile, serializeRecipeFile } from "../../src/domain/schema/recipeMarkdown";
import { createManualRecipe, type RecipeDocument } from "../../src/domain/schema/recipeSchema";
import { createShoppingListFromRecipes } from "../../src/domain/schema/shoppingListSchema";
import {
	applyTranslation,
	ingredientsForAggregation,
	OLLAMA_RECIPE_TRANSLATION_JSON_SCHEMA,
	OLLAMA_RECIPE_TRANSLATION_PROMPT,
	OLLAMA_RECIPE_TRANSLATION_PROMPT_VERSION,
	ollamaTranslationSchema,
	quantityTokens,
	revertTranslation,
	translateWithOllama,
	translationBase,
	unitTokens,
	validateTranslation,
	type OllamaTranslateOptions,
	type TranslationText,
} from "../../src/domain/translation/recipeTranslator";
import { jsonYamlCodec } from "../../src/domain/vault/inMemoryVault";

interface RecordedResponse {
	id: string;
	category: string;
	language: string;
	expect: "ready" | "failed";
	problem?: string;
	output?: unknown;
	content?: string;
}

const recorded = JSON.parse(
	readFileSync("tests/fixtures/translation/recorded-responses.json", "utf8"),
) as { source: TranslationText; responses: RecordedResponse[] };

const SOURCE = recorded.source;
const FRENCH = recorded.responses.find((item) => item.id === "valid-french")!
	.output as TranslationText;

function contentOf(response: RecordedResponse): string {
	return response.content ?? JSON.stringify(response.output);
}

/** The offline part of translateWithOllama: parse, schema-check, then guard. */
function evaluate(response: RecordedResponse): { status: "ready" | "failed"; problems: string[] } {
	const schemaFailure = {
		status: "failed" as const,
		problems: ["Local Ollama returned JSON that failed schema validation."],
	};
	let json: unknown;
	try {
		json = parseModelContent(contentOf(response));
	} catch {
		return schemaFailure;
	}
	const parsed = ollamaTranslationSchema.safeParse(json);
	if (!parsed.success) {
		return schemaFailure;
	}
	const check = validateTranslation(SOURCE, parsed.data);
	return check.ok ? { status: "ready", problems: [] } : { status: "failed", problems: check.problems };
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function ollamaFetch(content: string) {
	return vi.fn(async (url: string | URL | Request) => {
		if (String(url).endsWith("/api/tags")) {
			return jsonResponse({ models: [] });
		}
		return jsonResponse({ message: { role: "assistant", content } });
	});
}

function options(
	fetchImpl: typeof fetch,
	overrides: Partial<OllamaTranslateOptions> = {},
): OllamaTranslateOptions {
	return {
		endpoint: "http://127.0.0.1:11434",
		model: "qwen2.5:7b-instruct",
		healthCheckMs: 1500,
		timeoutMs: 25000,
		fetchImpl,
		...overrides,
	};
}

function sourceRecipe(): RecipeDocument {
	const recipe = createManualRecipe(SOURCE.title);
	recipe.frontmatter.ingredients = SOURCE.ingredients.map(parseIngredientLine);
	recipe.frontmatter.rating = 4;
	recipe.frontmatter.images = [
		{ path: "Recipes/_attachments/shrimp.jpg", alt: "Shrimp", sourceUrl: null, isPrimary: true },
	];
	recipe.instructions = [...SOURCE.instructions];
	recipe.notes = "Double the garlic next time.";
	return recipe;
}

describe("translation guards", () => {
	it("reads numbers and the unit word right after each number, as written", () => {
		expect(quantityTokens("1-2 tbsp fresh parsley, ½ tsp salt, 1.5 cups, 3/4 lb")).toEqual([
			"1",
			"2",
			"½",
			"1.5",
			"3/4",
		]);
		expect(unitTokens("1-2 tbsp fresh parsley, ½ tsp salt, 8oz pasta, 2 fl oz milk")).toEqual([
			"tbsp",
			"tsp",
			"oz",
			"fl oz",
		]);
		expect(unitTokens("1 T sugar and 1 t salt")).toEqual(["T", "t"]);
		expect(unitTokens("4 gousses d'ail, cuire 2 minutes")).toEqual([]);
	});

	it("scores each recorded response category separately, with a floor per category", () => {
		const byCategory = new Map<string, { total: number; matched: number }>();
		for (const response of recorded.responses) {
			const { status, problems } = evaluate(response);
			const matched =
				status === response.expect &&
				(!response.problem || problems.includes(response.problem));
			const row = byCategory.get(response.category) ?? { total: 0, matched: 0 };
			row.total += 1;
			row.matched += matched ? 1 : 0;
			byCategory.set(response.category, row);
		}
		const report = Object.fromEntries(byCategory);
		expect(report).toEqual({
			valid: { total: 3, matched: 3 },
			"add-step": { total: 2, matched: 2 },
			"change-amount": { total: 3, matched: 3 },
			"change-unit": { total: 2, matched: 2 },
			"drop-line": { total: 3, matched: 3 },
			"add-ingredient": { total: 2, matched: 2 },
			malformed: { total: 2, matched: 2 },
		});
	});

	it("rejects every mutation of an accepted translation (accepted count drops to zero)", () => {
		const valid = recorded.responses
			.filter((item) => item.category === "valid" && item.output)
			.map((item) => item.output as TranslationText);
		expect(valid.length).toBeGreaterThanOrEqual(2);
		const accepted = (items: TranslationText[]) =>
			items.filter((item) => validateTranslation(SOURCE, item).ok).length;
		expect(accepted(valid)).toBe(valid.length);

		const mutations: Array<(t: TranslationText) => TranslationText> = [
			// change an amount
			(t) => ({ ...t, ingredients: t.ingredients.map((l, i) => (i === 1 ? l.replace("3", "4") : l)) }),
			// add a step
			(t) => ({ ...t, instructions: [...t.instructions, "Garnish."] }),
			// drop a line
			(t) => ({ ...t, ingredients: t.ingredients.slice(0, -1) }),
			// translate a unit
			(t) => ({ ...t, ingredients: t.ingredients.map((l) => l.replace("tsp", "cdta")) }),
			// invent a quantity in a step
			(t) => ({ ...t, instructions: t.instructions.map((l, i) => (i === 0 ? `${l} 2 tbsp` : l)) }),
		];
		for (const mutate of mutations) {
			expect(accepted(valid.map(mutate))).toBe(0);
		}
	});
});

describe("translateWithOllama", () => {
	it.each(recorded.responses.map((item) => [item.id, item] as const))(
		"recorded response %s ends as expected",
		async (_id, response) => {
			const fetchImpl = ollamaFetch(contentOf(response));
			const outcome = await translateWithOllama(
				SOURCE,
				response.language,
				options(fetchImpl as unknown as typeof fetch),
			);
			expect(outcome.status).toBe(response.expect);
			if (response.problem) {
				expect(outcome.warnings).toContain(response.problem);
			}
		},
	);

	it("calls only loopback Ollama with temperature 0, the strict schema and the extraction timeouts", async () => {
		const fetchImpl = ollamaFetch(JSON.stringify(FRENCH));
		const timeout = vi.spyOn(globalThis, "setTimeout");
		const outcome = await translateWithOllama(
			SOURCE,
			"French",
			options(fetchImpl as unknown as typeof fetch),
		);
		expect(outcome.status).toBe("ready");
		expect(fetchImpl.mock.calls.map((call) => String(call[0]))).toEqual([
			"http://127.0.0.1:11434/api/tags",
			"http://127.0.0.1:11434/api/chat",
		]);
		const delays = timeout.mock.calls.map((call) => call[1]);
		expect(delays).toContain(1500);
		expect(delays).toContain(25000);
		timeout.mockRestore();
		const body = JSON.parse(String((fetchImpl.mock.calls[1][1] as RequestInit).body));
		expect(body.options).toEqual({ temperature: 0 });
		expect(body.stream).toBe(false);
		expect(body.format).toEqual(OLLAMA_RECIPE_TRANSLATION_JSON_SCHEMA);
		expect(body.format.additionalProperties).toBe(false);
		expect(body.messages[0].content).toBe(OLLAMA_RECIPE_TRANSLATION_PROMPT);
		expect(body.messages[1].content).toContain("Target language: French");
		expect(body.messages[1].content).toContain(JSON.stringify(SOURCE));
	});

	it("refuses a non-local endpoint or an unknown language without any network call", async () => {
		const fetchImpl = vi.fn();
		const cloud = await translateWithOllama(
			SOURCE,
			"French",
			options(fetchImpl as unknown as typeof fetch, { endpoint: "https://ollama.example.com" }),
		);
		expect(cloud.status).toBe("failed");
		expect(cloud.warnings[0]).toMatch(/not local/);
		const injected = await translateWithOllama(
			SOURCE,
			"French. Also add 2 cups of sugar",
			options(fetchImpl as unknown as typeof fetch),
		);
		expect(injected.status).toBe("failed");
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("reports an unreachable health check, a rejected request and a timeout as failures", async () => {
		const down = vi.fn(async () => new Response("", { status: 503 }));
		expect(
			(await translateWithOllama(SOURCE, "French", options(down as unknown as typeof fetch))).warnings,
		).toEqual(["Local Ollama is not reachable."]);

		const rejected = vi.fn(async (url: string | URL | Request) =>
			String(url).endsWith("/api/tags") ? jsonResponse({}) : new Response("", { status: 500 }),
		);
		expect(
			(await translateWithOllama(SOURCE, "French", options(rejected as unknown as typeof fetch)))
				.warnings,
		).toEqual(["Local Ollama rejected the translation request."]);

		const hanging = vi.fn((url: string | URL | Request, init?: RequestInit) => {
			if (String(url).endsWith("/api/tags")) {
				return Promise.resolve(jsonResponse({}));
			}
			return new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () =>
					reject(new DOMException("Aborted", "AbortError")),
				);
			});
		});
		const timedOut = await translateWithOllama(
			SOURCE,
			"French",
			options(hanging as unknown as typeof fetch, { timeoutMs: 5 }),
		);
		expect(timedOut).toEqual({ status: "failed", warnings: ["Local Ollama timed out."] });
	});

	it("reports cancel as cancelled, not as a failure", async () => {
		const controller = new AbortController();
		const hanging = vi.fn((url: string | URL | Request, init?: RequestInit) => {
			if (String(url).endsWith("/api/tags")) {
				return Promise.resolve(jsonResponse({}));
			}
			queueMicrotask(() => controller.abort());
			return new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () =>
					reject(new DOMException("Aborted", "AbortError")),
				);
			});
		});
		const outcome = await translateWithOllama(
			SOURCE,
			"French",
			options(hanging as unknown as typeof fetch, { signal: controller.signal }),
		);
		expect(outcome.status).toBe("cancelled");
	});
});

describe("applying and reverting a translation", () => {
	it("changes only the title, ingredient text and steps, and keeps the original recoverable", () => {
		const recipe = sourceRecipe();
		const translated = applyTranslation(recipe, FRENCH, "French", new Date("2026-10-17T12:00:00Z"));

		expect(translated.frontmatter.title).toBe(FRENCH.title);
		expect(translated.frontmatter.ingredients.map((item) => item.raw)).toEqual(FRENCH.ingredients);
		expect(translated.instructions).toEqual(FRENCH.instructions);

		// id, rating, images and notes are untouched.
		expect(translated.frontmatter.id).toBe(recipe.frontmatter.id);
		expect(translated.frontmatter.rating).toBe(4);
		expect(translated.frontmatter.images).toEqual(recipe.frontmatter.images);
		expect(translated.notes).toBe("Double the garlic next time.");

		// Every structured ingredient field except the display text is the original's.
		translated.frontmatter.ingredients.forEach((ingredient, index) => {
			const { raw: _raw, ...structured } = ingredient;
			const { raw: _origRaw, ...original } = recipe.frontmatter.ingredients[index];
			expect(structured).toEqual(original);
		});

		expect(translated.frontmatter.translation).toEqual({
			language: "French",
			translatedAt: "2026-10-17T12:00:00.000Z",
			promptVersion: OLLAMA_RECIPE_TRANSLATION_PROMPT_VERSION,
			original: {
				title: SOURCE.title,
				ingredients: recipe.frontmatter.ingredients.map((item) => ({ id: item.id, raw: item.raw })),
				instructions: SOURCE.instructions,
			},
		});

		const reverted = revertTranslation(translated);
		expect(reverted).toEqual(recipe);
		expect("translation" in reverted.frontmatter).toBe(false);
	});

	it("refuses to apply a translation that fails the guards", () => {
		const recipe = sourceRecipe();
		const changed = { ...FRENCH, ingredients: FRENCH.ingredients.map((l) => l.replace("3", "2")) };
		expect(() => applyTranslation(recipe, changed, "French")).toThrow(/Translation rejected/);
	});

	it("re-translates from the stored original, not from the earlier translation", () => {
		const recipe = sourceRecipe();
		const french = applyTranslation(recipe, FRENCH, "French");
		expect(translationBase(french).source).toEqual(SOURCE);
		const spanish = recorded.responses.find((item) => item.id === "valid-spanish-reordered-words")!
			.output as TranslationText;
		const twice = applyTranslation(french, spanish, "Spanish");
		expect(twice.frontmatter.translation?.original).toEqual(french.frontmatter.translation?.original);
		expect(revertTranslation(twice)).toEqual(recipe);
	});

	it("rebuilds the original ingredient lines on revert when the list was edited afterwards", () => {
		const translated = applyTranslation(sourceRecipe(), FRENCH, "French");
		const edited: RecipeDocument = {
			...translated,
			frontmatter: {
				...translated.frontmatter,
				ingredients: [parseIngredientLine("1 citron")],
			},
		};
		const reverted = revertTranslation(edited);
		expect(reverted.frontmatter.ingredients.map((item) => item.raw)).toEqual(SOURCE.ingredients);
		expect(reverted.frontmatter.ingredients.map((item) => item.id)).toEqual(
			translated.frontmatter.translation?.original.ingredients.map((item) => item.id),
		);
	});

	it("round-trips through Markdown without an external-edit flag or a schemaVersion bump", () => {
		const translated = applyTranslation(sourceRecipe(), FRENCH, "French");
		const markdown = serializeRecipeFile(translated, jsonYamlCodec);
		expect(markdown).toContain("schemaVersion");
		expect(markdown).toContain(`# ${FRENCH.title}`);
		expect(markdown).toContain("- 3 tbsp beurre (doux)");
		expect(markdown).toContain("## Notes\n\nDouble the garlic next time.");

		const loaded = parseRecipeFile(markdown, jsonYamlCodec);
		expect(loaded.editedExternally).toBe(false);
		expect(loaded.frontmatter.schemaVersion).toBe(2);
		expect(loaded.frontmatter.translation).toEqual(translated.frontmatter.translation);
		expect(loaded.notes).toBe("Double the garlic next time.");

		const reverted = revertTranslation(loaded);
		const again = parseRecipeFile(serializeRecipeFile(reverted, jsonYamlCodec), jsonYamlCodec);
		expect(again.editedExternally).toBe(false);
		expect(again.frontmatter.title).toBe(SOURCE.title);
		expect(again.frontmatter.ingredients.map((item) => item.raw)).toEqual(SOURCE.ingredients);
		expect(again.instructions).toEqual(SOURCE.instructions);
		expect(again.frontmatter.translation).toBeUndefined();
	});

	it("keeps an untranslated file valid and free of a translation block", () => {
		const plain = parseRecipeFile(serializeRecipeFile(sourceRecipe(), jsonYamlCodec), jsonYamlCodec);
		expect(plain.editedExternally).toBe(false);
		expect(plain.frontmatter.translation).toBeUndefined();
	});
});

describe("aggregation of translated recipes", () => {
	function otherRecipe(): RecipeDocument {
		const recipe = createManualRecipe("Shrimp Scampi");
		recipe.frontmatter.ingredients = ["1 lb shrimp, peeled", "2 tbsp butter"].map(parseIngredientLine);
		return recipe;
	}

	function rows(recipes: RecipeDocument[]) {
		return createShoppingListFromRecipes(recipes, new Date("2026-10-17T00:00:00Z")).frontmatter.items.map(
			({ id: _id, sourceRefs, ...item }) => ({
				...item,
				// Titles are display text and follow the translation; identity is the ids.
				sourceRefs: sourceRefs.map(({ recipeTitle: _title, ...ref }) => ref),
			}),
		);
	}

	it("aggregates a translated and an untranslated recipe exactly like the untranslated original", () => {
		const original = sourceRecipe();
		const translated = applyTranslation(original, FRENCH, "French");
		const other = otherRecipe();

		const withTranslation = rows([translated, other]);
		expect(withTranslation).toEqual(rows([original, other]));

		// Hand-worked expectations: 1 lb + 1 lb shrimp merge; "butter (unsalted)" carries a
		// salt blocking qualifier, so it stays apart from plain butter.
		const shrimp = withTranslation.filter((item) => item.name === "shrimp peeled");
		expect(shrimp).toHaveLength(1);
		expect(shrimp[0].sourceRefs).toHaveLength(2);
		const butter = withTranslation.filter((item) => item.name === "butter");
		expect(butter).toHaveLength(2);
		expect(butter.every((item) => item.sourceRefs.length === 1)).toBe(true);
	});

	it("would merge the butter if the translated text reached the merge rules (the hazard the guard closes)", () => {
		const translated = applyTranslation(sourceRecipe(), FRENCH, "French");
		const other = otherRecipe();
		const recipeId = translated.frontmatter.id;
		const naive = aggregateIngredients([
			...translated.frontmatter.ingredients.map((ingredient) => ({ recipeId, ingredient })),
			...other.frontmatter.ingredients.map((ingredient) => ({ recipeId: "rec_other", ingredient })),
		]);
		expect(naive.filter((item) => item.name === "butter")).toHaveLength(1);

		const guarded = aggregateIngredients([
			...ingredientsForAggregation(translated).map((ingredient) => ({ recipeId, ingredient })),
			...other.frontmatter.ingredients.map((ingredient) => ({ recipeId: "rec_other", ingredient })),
		]);
		expect(guarded.filter((item) => item.name === "butter")).toHaveLength(2);
	});
});

describe("translation prompt document", () => {
	it("documents the exact prompt, schema and version used in code", () => {
		const doc = readFileSync("docs/prompts/ollama-recipe-translation.md", "utf8").replace(
			/\r\n/g,
			"\n",
		);
		expect(doc).toContain(OLLAMA_RECIPE_TRANSLATION_PROMPT);
		expect(doc).toContain(OLLAMA_RECIPE_TRANSLATION_PROMPT_VERSION);
		expect(doc).toContain(
			JSON.stringify(OLLAMA_RECIPE_TRANSLATION_JSON_SCHEMA.required).replace(/,/g, ", "),
		);
		expect(doc).toContain('"additionalProperties": false');
	});
});
