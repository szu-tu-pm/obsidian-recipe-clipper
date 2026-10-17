import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { aggregateIngredients } from "../../src/domain/aggregation/aggregator";
import { parseIngredientLine } from "../../src/domain/aggregation/stage1LexicalParser";
import { parseModelContent } from "../../src/domain/extraction/ollamaExtractor";
import {
	parseRecipeFile,
	reconcileIngredientLines,
	serializeRecipeFile,
} from "../../src/domain/schema/recipeMarkdown";
import type { RecipeDocument } from "../../src/domain/schema/recipeSchema";
import {
	applyTranslation,
	hasEditsSinceTranslation,
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
	type TranslationPayload,
	type TranslationReply,
} from "../../src/domain/translation/recipeTranslator";
import { jsonYamlCodec } from "../../src/domain/vault/inMemoryVault";
import {
	contentOf,
	FLATBREAD,
	FRENCH,
	recipeFrom,
	recorded,
	recordedReply,
	scampiRecipe,
	SHRIMP,
	shoppingRows,
	texts,
	type RecordedResponse,
} from "../helpers/translationFixtures";

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
	const check = validateTranslation(recorded.sources[response.source], parsed.data);
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

/** What the recipe editor does with the ingredient textarea on save. */
function editIngredients(recipe: RecipeDocument, lines: string[]): RecipeDocument {
	return {
		...recipe,
		frontmatter: {
			...recipe.frontmatter,
			ingredients: reconcileIngredientLines(lines, recipe.frontmatter.ingredients),
		},
	};
}

/** A reply that "translates" a base by tagging each part, keeping amounts and keys. */
function echoReply(source: TranslationPayload, tag: string): TranslationReply {
	return {
		title: `${source.title} (${tag})`,
		ingredients: source.ingredients.map((item) => ({ id: item.id, text: `${item.text} ${tag}` })),
		instructions: source.instructions.map((item) => ({ step: item.step, text: `${item.text} ${tag}` })),
	};
}

describe("translation guards", () => {
	it("reads digits, fractions, ranges and English number words, and the unit after each", () => {
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

		const words =
			"two cups flour, a pinch of salt, an onion, twenty-five minutes, thirty five, half a cup, one dozen";
		expect(quantityTokens(words)).toEqual(["2", "1", "25", "35", "1/2", "1", "1", "12"]);
		expect(unitTokens(words)).toEqual(["cups", "pinch", "cup"]);
		expect(quantityTokens("Twelve eggs. A Simple Soup à la carte, a quarter")).toEqual(["12", "1/4"]);
	});

	it("scores each recorded response category separately, with a floor per category", () => {
		const byCategory = new Map<string, { total: number; matched: number }>();
		for (const response of recorded.responses) {
			const { status, problems } = evaluate(response);
			const matched =
				status === response.expect && (!response.problem || problems.includes(response.problem));
			const row = byCategory.get(response.category) ?? { total: 0, matched: 0 };
			row.total += 1;
			row.matched += matched ? 1 : 0;
			byCategory.set(response.category, row);
		}
		expect(Object.fromEntries(byCategory)).toEqual({
			valid: { total: 7, matched: 7 },
			"add-step": { total: 2, matched: 2 },
			"change-amount": { total: 3, matched: 3 },
			"change-unit": { total: 2, matched: 2 },
			"drop-line": { total: 3, matched: 3 },
			"add-ingredient": { total: 2, matched: 2 },
			"word-amount": { total: 4, matched: 4 },
			reorder: { total: 2, matched: 2 },
			"missing-id": { total: 2, matched: 2 },
			malformed: { total: 3, matched: 3 },
			"pair-swap": { total: 3, matched: 3 },
		});
	});

	it("rejects every mutation of an accepted translation (accepted count drops to zero)", () => {
		const valid = recorded.responses
			.filter((item) => item.category === "valid" && item.output)
			.map((item) => ({ source: recorded.sources[item.source], reply: item.output as TranslationReply }));
		expect(valid.length).toBeGreaterThanOrEqual(4);
		const accepted = (items: typeof valid) =>
			items.filter((item) => validateTranslation(item.source, item.reply).ok).length;
		expect(accepted(valid)).toBe(valid.length);

		const mapIngredient = (r: TranslationReply, index: number, change: (text: string) => string) => ({
			...r,
			ingredients: r.ingredients.map((item, i) => (i === index ? { ...item, text: change(item.text) } : item)),
		});
		const firstIndex = (r: TranslationReply, pattern: RegExp) =>
			r.ingredients.findIndex((item) => pattern.test(item.text));

		const mutations: Record<string, (r: TranslationReply) => TranslationReply | null> = {
			"change a digit amount": (r) => {
				const i = firstIndex(r, /\d/);
				return i < 0 ? null : mapIngredient(r, i, (t) => t.replace(/\d/, (d) => String((Number(d) + 1) % 10)));
			},
			"change a word amount": (r) => {
				const i = firstIndex(r, /\btwo\b/);
				return i < 0 ? null : mapIngredient(r, i, (t) => t.replace(/\btwo\b/, "three"));
			},
			"add a step": (r) => ({
				...r,
				instructions: [...r.instructions, { step: r.instructions.length + 1, text: "Garnish." }],
			}),
			"drop a line": (r) => ({ ...r, ingredients: r.ingredients.slice(0, -1) }),
			"translate a unit": (r) => {
				const i = firstIndex(r, /\b(tsp|tbsp|cups?|pinch)\b/);
				return i < 0 ? null : mapIngredient(r, i, (t) => t.replace(/\b(tsp|tbsp|cups?|pinch)\b/, "cdta"));
			},
			"invent a quantity in a step": (r) => ({
				...r,
				instructions: r.instructions.map((item, i) => (i === 0 ? { ...item, text: `${item.text} 2 tbsp` } : item)),
			}),
			"swap the last two lines with their ids": (r) => {
				const list = [...r.ingredients];
				[list[list.length - 2], list[list.length - 1]] = [list[list.length - 1], list[list.length - 2]];
				return { ...r, ingredients: list };
			},
			"swap amounts between two units (both multisets unchanged)": (r) => {
				const swap = (text: string): string | null => {
					const pairs = [...text.matchAll(/(\d+)(\s+)(cups?|tbsp|tsp|lb)\b/g)];
					const [a, b] = pairs;
					if (!a || !b || a[1] === b[1] || a[3] === b[3]) {
						return null;
					}
					const ia = a.index ?? 0;
					const ib = b.index ?? 0;
					return (
						text.slice(0, ia) + b[1] + text.slice(ia + a[1].length, ib) + a[1] + text.slice(ib + b[1].length)
					);
				};
				const swapIn = <T extends { text: string }>(items: T[]) => {
					const index = items.findIndex((item) => swap(item.text) !== null);
					return index < 0
						? null
						: items.map((item, i) => (i === index ? { ...item, text: swap(item.text) as string } : item));
				};
				const ingredients = swapIn(r.ingredients);
				if (ingredients) {
					return { ...r, ingredients };
				}
				const instructions = swapIn(r.instructions);
				return instructions ? { ...r, instructions } : null;
			},
			"swap the lower ends of two ranges with different units": (r) => {
				const swapLows = (text: string): string | null => {
					const ranges = [...text.matchAll(/(\d+)-(\d+)\s+(cups?|tbsp|tsp|lb)\b/g)];
					const [a, b] = ranges;
					if (!a || !b || a[1] === b[1] || a[3] === b[3]) {
						return null;
					}
					const ia = a.index ?? 0;
					const ib = b.index ?? 0;
					return text.slice(0, ia) + b[1] + text.slice(ia + a[1].length, ib) + a[1] + text.slice(ib + b[1].length);
				};
				const index = r.ingredients.findIndex((item) => swapLows(item.text) !== null);
				return index < 0
					? null
					: {
							...r,
							ingredients: r.ingredients.map((item, i) =>
								i === index ? { ...item, text: swapLows(item.text) as string } : item,
							),
						};
			},
			"drop an id": (r) => ({
				...r,
				ingredients: r.ingredients.map((item, i) => (i === 0 ? { text: item.text } : item)),
			}),
		};
		for (const [name, mutate] of Object.entries(mutations)) {
			const applied = valid
				.map((item) => ({ source: item.source, reply: mutate(structuredClone(item.reply)) }))
				.filter((item): item is (typeof valid)[number] => item.reply !== null);
			expect(applied.length, name).toBeGreaterThanOrEqual(1);
			expect(accepted(applied), name).toBe(0);
		}
	});

	it("catches a swap of two lines whose amounts are identical or absent", () => {
		const reply = recordedReply("valid-flatbread-french-digits");
		const [oil, salt] = [reply.ingredients[3], reply.ingredients[4]];
		// Same texts in place, ids swapped: the model moved the lines.
		const swapped = { ...reply, ingredients: [...reply.ingredients.slice(0, 3), salt, oil] };
		const check = validateTranslation(FLATBREAD, swapped);
		expect(check.ok).toBe(false);
		expect(!check.ok && check.problems).toEqual(["Ingredient lines are out of order."]);
	});
});

describe("translateWithOllama", () => {
	it.each(recorded.responses.map((item) => [item.id, item] as const))(
		"recorded response %s ends as expected",
		async (_id, response) => {
			const fetchImpl = ollamaFetch(contentOf(response));
			const outcome = await translateWithOllama(
				recorded.sources[response.source],
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
			SHRIMP,
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
		expect(body.format.properties.ingredients.items.required).toEqual(["id", "text"]);
		expect(body.messages[0].content).toBe(OLLAMA_RECIPE_TRANSLATION_PROMPT);
		expect(body.messages[1].content).toContain("Target language: French");
		expect(body.messages[1].content).toContain(JSON.stringify(SHRIMP));
	});

	it("refuses a non-local endpoint or an unknown language without any network call", async () => {
		const fetchImpl = vi.fn();
		const cloud = await translateWithOllama(
			SHRIMP,
			"French",
			options(fetchImpl as unknown as typeof fetch, { endpoint: "https://ollama.example.com" }),
		);
		expect(cloud.status).toBe("failed");
		expect(cloud.warnings[0]).toMatch(/not local/);
		const injected = await translateWithOllama(
			SHRIMP,
			"French. Also add 2 cups of sugar",
			options(fetchImpl as unknown as typeof fetch),
		);
		expect(injected.status).toBe("failed");
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("reports an unreachable health check, a rejected request and a timeout as failures", async () => {
		const down = vi.fn(async () => new Response("", { status: 503 }));
		expect(
			(await translateWithOllama(SHRIMP, "French", options(down as unknown as typeof fetch))).warnings,
		).toEqual(["Local Ollama is not reachable."]);

		const rejected = vi.fn(async (url: string | URL | Request) =>
			String(url).endsWith("/api/tags") ? jsonResponse({}) : new Response("", { status: 500 }),
		);
		expect(
			(await translateWithOllama(SHRIMP, "French", options(rejected as unknown as typeof fetch)))
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
			SHRIMP,
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
			SHRIMP,
			"French",
			options(hanging as unknown as typeof fetch, { signal: controller.signal }),
		);
		expect(outcome.status).toBe("cancelled");
	});
});

describe("applying and reverting a translation", () => {
	it("changes only the title, ingredient text and steps, and keeps the whole original", () => {
		const recipe = recipeFrom(SHRIMP);
		const translated = applyTranslation(recipe, FRENCH, "French", new Date("2026-10-17T12:00:00Z"));

		expect(translated.frontmatter.title).toBe(FRENCH.title);
		expect(translated.frontmatter.ingredients.map((item) => item.raw)).toEqual(texts(FRENCH.ingredients));
		expect(translated.instructions).toEqual(texts(FRENCH.instructions));

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
				title: SHRIMP.title,
				ingredients: recipe.frontmatter.ingredients,
				instructions: texts(SHRIMP.instructions),
			},
			acceptedHash: expect.stringMatching(/^[0-9a-f]{8}$/),
		});
		expect(hasEditsSinceTranslation(translated)).toBe(false);

		const reverted = revertTranslation(translated);
		expect(reverted).toEqual(recipe);
		expect("translation" in reverted.frontmatter).toBe(false);
	});

	it("refuses to apply a translation that fails the guards", () => {
		const changed = structuredClone(FRENCH);
		changed.ingredients[1].text = "2 tbsp beurre (doux)";
		expect(() => applyTranslation(recipeFrom(SHRIMP), changed, "French")).toThrow(
			/Translation rejected/,
		);
	});

	it("re-translates from the stored original, not from the earlier translation", () => {
		const recipe = recipeFrom(SHRIMP);
		const french = applyTranslation(recipe, FRENCH, "French");
		expect(translationBase(french).source).toEqual(SHRIMP);
		const twice = applyTranslation(french, recordedReply("valid-spanish-reordered-words"), "Spanish");
		expect(twice.frontmatter.translation?.original).toEqual(french.frontmatter.translation?.original);
		expect(revertTranslation(twice)).toEqual(recipe);
	});

	it("round-trips through Markdown without an external-edit flag or a schemaVersion bump", () => {
		const translated = applyTranslation(recipeFrom(SHRIMP), FRENCH, "French");
		const markdown = serializeRecipeFile(translated, jsonYamlCodec);
		expect(markdown).toContain(`# ${FRENCH.title}`);
		expect(markdown).toContain("- 3 tbsp beurre (doux)");
		expect(markdown).toContain("## Notes\n\nDouble the garlic next time.");

		const loaded = parseRecipeFile(markdown, jsonYamlCodec);
		expect(loaded.editedExternally).toBe(false);
		expect(loaded.frontmatter.schemaVersion).toBe(2);
		expect(loaded.frontmatter.translation).toEqual(translated.frontmatter.translation);
		expect(hasEditsSinceTranslation(loaded)).toBe(false);

		const again = parseRecipeFile(serializeRecipeFile(revertTranslation(loaded), jsonYamlCodec), jsonYamlCodec);
		expect(again.editedExternally).toBe(false);
		expect(again.frontmatter.title).toBe(SHRIMP.title);
		expect(again.frontmatter.ingredients).toEqual(recipeFrom(SHRIMP).frontmatter.ingredients);
		expect(again.instructions).toEqual(texts(SHRIMP.instructions));
		expect(again.frontmatter.translation).toBeUndefined();
	});

	it("keeps an untranslated file valid and free of a translation block", () => {
		const plain = parseRecipeFile(serializeRecipeFile(recipeFrom(SHRIMP), jsonYamlCodec), jsonYamlCodec);
		expect(plain.editedExternally).toBe(false);
		expect(plain.frontmatter.translation).toBeUndefined();
	});
});

describe("edits after translating", () => {
	const original = () => recipeFrom(SHRIMP);
	const french = () => applyTranslation(original(), FRENCH, "French");
	const FR = texts(FRENCH.ingredients);
	const ids = (recipe: RecipeDocument) => recipe.frontmatter.ingredients.map((item) => item.id);

	/** Revert writes back the whole stored original; notes, rating and images stay. */
	function expectExactOriginal(reverted: RecipeDocument): void {
		const expected = original();
		expect(reverted.frontmatter.title).toBe(expected.frontmatter.title);
		expect(reverted.frontmatter.ingredients).toEqual(expected.frontmatter.ingredients);
		expect(reverted.instructions).toEqual(expected.instructions);
		expect(reverted.frontmatter.translation).toBeUndefined();
		expect(reverted.notes).toBe(expected.notes);
		expect(reverted.frontmatter.rating).toBe(expected.frontmatter.rating);
		expect(reverted.frontmatter.images).toEqual(expected.frontmatter.images);
	}

	it.each([
		["casing only", [FR[0], "3 TBSP Beurre (Doux)", ...FR.slice(2)]],
		["whitespace only", [FR[0], "3   tbsp beurre   (doux)", ...FR.slice(2)]],
	])("a %s edit keeps the id and identity; revert and re-translation use the whole original", (_name, lines) => {
		const translated = french();
		const edited = editIngredients(translated, lines);
		expect(ids(edited)).toEqual(ids(translated));
		expect(edited.frontmatter.ingredients[1].raw).toBe(lines[1]);
		const { raw: _a, ...kept } = edited.frontmatter.ingredients[1];
		const { raw: _b, ...before } = translated.frontmatter.ingredients[1];
		expect(kept).toEqual(before);

		expect(shoppingRows([edited, scampiRecipe()])).toEqual(shoppingRows([original(), scampiRecipe()]));
		expect(hasEditsSinceTranslation(edited)).toBe(true);
		expect(translationBase(edited).source).toEqual(SHRIMP);
		expectExactOriginal(revertTranslation(edited));
	});

	it("a reorder keeps every id; revert restores the original order", () => {
		const translated = french();
		const edited = editIngredients(translated, [FR[0], FR[1], FR[2], FR[4], FR[3]]);
		const before = ids(translated);
		expect(ids(edited)).toEqual([before[0], before[1], before[2], before[4], before[3]]);
		expect(shoppingRows([edited, scampiRecipe()])).toEqual(shoppingRows([original(), scampiRecipe()]));
		expect(translationBase(edited).source).toEqual(SHRIMP);
		expectExactOriginal(revertTranslation(edited));
	});

	it("a substantive edit gets fresh identity; re-translation and revert start from the stored original", () => {
		const translated = french();
		const edited = editIngredients(translated, [FR[0], FR[1], FR[2], "1 tsp sel fin", FR[4]]);
		const before = ids(translated);
		const after = ids(edited);
		expect(after.filter((id, i) => id === before[i])).toHaveLength(4);
		expect(after[3]).not.toBe(before[3]);
		const { id: _id, ...fresh } = edited.frontmatter.ingredients[3];
		const { id: _pid, ...parsed } = parseIngredientLine("1 tsp sel fin");
		expect(fresh).toEqual(parsed);
		expect(edited.frontmatter.translation).toEqual(translated.frontmatter.translation);

		// Aggregation: unchanged lines aggregate as the original; the edited line as typed.
		const expected = original();
		expected.frontmatter.ingredients[3] = edited.frontmatter.ingredients[3];
		expect(shoppingRows([edited, scampiRecipe()])).toEqual(shoppingRows([expected, scampiRecipe()]));

		// Re-translation starts from the stored original, never from current text.
		expect(hasEditsSinceTranslation(edited)).toBe(true);
		const base = translationBase(edited);
		expect(base.source).toEqual(SHRIMP);
		const twice = applyTranslation(edited, echoReply(base.source, "es"), "Spanish");
		expect(twice.frontmatter.translation?.original).toEqual(translated.frontmatter.translation?.original);
		expect(ids(twice)).toEqual(before);
		expectExactOriginal(revertTranslation(edited));
		expectExactOriginal(revertTranslation(twice));
	});

	it("revert after duplicate translated steps, with the first one deleted, equals the stored original", () => {
		const recipe = recipeFrom(SHRIMP);
		recipe.instructions = ["Stir.", "Add the garlic and cook for 1 minute.", "Stir."];
		const translated = applyTranslation(recipe, echoReply(translationBase(recipe).source, "fr"), "French");
		expect(translated.instructions).toEqual(["Stir. fr", "Add the garlic and cook for 1 minute. fr", "Stir. fr"]);
		const edited: RecipeDocument = { ...translated, instructions: translated.instructions.slice(1) };
		expect(hasEditsSinceTranslation(edited)).toBe(true);
		expect(texts(translationBase(edited).source.instructions)).toEqual(recipe.instructions);
		const reverted = revertTranslation(edited);
		expect(reverted.instructions).toEqual(["Stir.", "Add the garlic and cook for 1 minute.", "Stir."]);
		expect(reverted.frontmatter.ingredients).toEqual(recipe.frontmatter.ingredients);
		expect(reverted.frontmatter.title).toBe(recipe.frontmatter.title);
	});

	it("the edit fingerprint covers structured ingredient fields but not notes, rating or images", () => {
		const translated = french();
		const withQuantity: RecipeDocument = {
			...translated,
			frontmatter: {
				...translated.frontmatter,
				ingredients: translated.frontmatter.ingredients.map((item, i) =>
					i === 2 ? { ...item, quantity: 6 } : item,
				),
			},
		};
		expect(withQuantity.frontmatter.ingredients[2].id).toBe(translated.frontmatter.ingredients[2].id);
		expect(withQuantity.frontmatter.ingredients[2].raw).toBe(translated.frontmatter.ingredients[2].raw);
		expect(hasEditsSinceTranslation(withQuantity)).toBe(true);
		for (const field of ["name", "unit", "preparation", "canonicalId"] as const) {
			const changed: RecipeDocument = {
				...translated,
				frontmatter: {
					...translated.frontmatter,
					ingredients: translated.frontmatter.ingredients.map((item, i) =>
						i === 2 ? { ...item, [field]: "changed" } : item,
					),
				},
			};
			expect(hasEditsSinceTranslation(changed), field).toBe(true);
		}

		const cosmetic: RecipeDocument = {
			...translated,
			notes: "New notes.",
			frontmatter: {
				...translated.frontmatter,
				rating: 1,
				images: [],
			},
		};
		expect(hasEditsSinceTranslation(cosmetic)).toBe(false);
		// Revert keeps notes, rating and images while restoring the original text.
		const reverted = revertTranslation(cosmetic);
		expect(reverted.notes).toBe("New notes.");
		expect(reverted.frontmatter.rating).toBe(1);
		expect(reverted.frontmatter.images).toEqual([]);
	});

	it("an edited title or added step counts as an edit and is discarded by revert", () => {
		const translated = french();
		const edited: RecipeDocument = {
			...translated,
			instructions: [...translated.instructions, "Servir aussitôt."],
			frontmatter: { ...translated.frontmatter, title: "Mes crevettes" },
		};
		expect(hasEditsSinceTranslation(edited)).toBe(true);
		expect(translationBase(edited).source).toEqual(SHRIMP);
		expectExactOriginal(revertTranslation(edited));
	});
});

describe("line matching keeps ids where they belong", () => {
	const original = () => recipeFrom(SHRIMP);
	const FR = texts(FRENCH.ingredients);
	const ids = (recipe: RecipeDocument) => recipe.frontmatter.ingredients.map((item) => item.id);

	it("a line edited to equal another line does not take that line's id", () => {
		const translated = applyTranslation(original(), FRENCH, "French");
		const before = ids(translated);
		const edited = editIngredients(translated, [FR[0], FR[2], FR[2], FR[3], FR[4]]);
		const after = ids(edited);
		expect([after[0], after[2], after[3], after[4]]).toEqual([before[0], before[2], before[3], before[4]]);
		expect(before).not.toContain(after[1]);
		const { id: _id, ...fresh } = edited.frontmatter.ingredients[1];
		const { id: _pid, ...parsed } = parseIngredientLine(FR[2]);
		expect(fresh).toEqual(parsed);

		const expected = original();
		expected.frontmatter.ingredients[1] = edited.frontmatter.ingredients[1];
		expect(shoppingRows([edited, scampiRecipe()])).toEqual(shoppingRows([expected, scampiRecipe()]));
		// The untouched garlic line still aggregates as the original "4 cloves garlic, minced".
		expect(ingredientsForAggregation(edited)[2].raw).toBe(SHRIMP.ingredients[2].text);
	});

	it("duplicate identical lines keep their ids where they were", () => {
		const recipe = recipeFrom({
			title: "Salted Bread",
			ingredients: [
				{ id: "ing_0000000000000000000000DU01", text: "1 tsp salt" },
				{ id: "ing_0000000000000000000000DU02", text: "1 cup flour" },
				{ id: "ing_0000000000000000000000DU03", text: "1 tsp salt" },
			],
			instructions: [{ step: 1, text: "Mix." }],
		});
		const [salt1, flour, salt2] = recipe.frontmatter.ingredients;
		const salt = (r: RecipeDocument) => shoppingRows([r]).find((row) => row.name === "salt");

		const same = editIngredients(recipe, ["1 tsp salt", "1 cup flour", "1 TSP salt"]);
		expect(ids(same)).toEqual([salt1.id, flour.id, salt2.id]);
		expect(salt(same)?.requiredQuantity).toBe(2);

		const editedBetween = editIngredients(recipe, ["1 tsp salt", "2 cups flour", "1 tsp salt"]);
		expect(ids(editedBetween)[0]).toBe(salt1.id);
		expect(ids(editedBetween)[2]).toBe(salt2.id);
		expect([salt1.id, flour.id, salt2.id]).not.toContain(ids(editedBetween)[1]);
		expect(salt(editedBetween)?.requiredQuantity).toBe(2);

		const firstDeleted = editIngredients(recipe, ["1 cup flour", "1 tsp salt"]);
		expect(ids(firstDeleted)).toEqual([flour.id, salt2.id]);
		expect(salt(firstDeleted)?.requiredQuantity).toBe(1);
		const expected = { ...recipe, frontmatter: { ...recipe.frontmatter, ingredients: [flour, salt2] } };
		expect(shoppingRows([firstDeleted])).toEqual(shoppingRows([expected]));

		const moved = editIngredients(recipe, ["1 cup flour", "1 tsp salt", "1 tsp salt"]);
		expect(ids(moved)).toEqual([flour.id, salt1.id, salt2.id]);
		expect(salt(moved)?.requiredQuantity).toBe(2);
	});

	it("a move combined with an edit keeps the moved line's id and gives only the edited line a new one", () => {
		const translated = applyTranslation(original(), FRENCH, "French");
		const before = ids(translated);
		const edited = editIngredients(translated, [FR[4], FR[0], FR[1], FR[2], "1 tsp sel fin"]);
		const after = ids(edited);
		expect(after.slice(0, 4)).toEqual([before[4], before[0], before[1], before[2]]);
		expect(before).not.toContain(after[4]);

		const o = original().frontmatter.ingredients;
		const expected = original();
		expected.frontmatter.ingredients = [o[4], o[0], o[1], o[2], edited.frontmatter.ingredients[4]];
		expect(shoppingRows([edited, scampiRecipe()])).toEqual(shoppingRows([expected, scampiRecipe()]));
	});
});

describe("edits made outside the plugin", () => {
	function editBody(recipe: RecipeDocument, change: (markdown: string) => string): RecipeDocument {
		const markdown = serializeRecipeFile(recipe, jsonYamlCodec);
		const edited = change(markdown);
		expect(edited).not.toBe(markdown);
		const loaded = parseRecipeFile(edited, jsonYamlCodec);
		expect(loaded.editedExternally).toBe(true);
		return loaded;
	}
	const notesOnly = (markdown: string) =>
		markdown.replace("Double the garlic next time.", "Double the garlic. Add lemon zest.");

	it("a Notes-only edit to a translated recipe leaves merging identical to the untranslated recipe", () => {
		const original = recipeFrom(SHRIMP);
		const translated = applyTranslation(original, FRENCH, "French");
		const loaded = editBody(translated, notesOnly);
		expect(loaded.notes).toBe("Double the garlic. Add lemon zest.");
		expect(loaded.frontmatter.ingredients).toEqual(translated.frontmatter.ingredients);
		expect(loaded.frontmatter.translation).toEqual(translated.frontmatter.translation);
		expect(shoppingRows([loaded, scampiRecipe()])).toEqual(shoppingRows([original, scampiRecipe()]));
		// Hand-worked: shrimp and salt each merge across both recipes; the unsalted butter
		// stays apart from the plain butter.
		const rows = shoppingRows([loaded, scampiRecipe()]);
		expect(rows.filter((row) => row.name === "butter")).toHaveLength(2);
		expect(rows.find((row) => row.name === "shrimp peeled")?.sourceRefs).toHaveLength(2);
		expect(rows.find((row) => row.name === "salt")?.sourceRefs).toHaveLength(2);
	});

	it("an outside edit to one ingredient line changes only that line's identity", () => {
		const translated = applyTranslation(recipeFrom(SHRIMP), FRENCH, "French");
		const loaded = editBody(translated, (markdown) =>
			markdown.replace("- 3 tbsp beurre (doux)", "- 3 tbsp beurre salé"),
		);
		const before = translated.frontmatter.ingredients;
		const after = loaded.frontmatter.ingredients;
		[0, 2, 3, 4].forEach((i) => expect(after[i]).toEqual(before[i]));
		expect(after[1].id).not.toBe(before[1].id);
		expect(after[1].raw).toBe("3 tbsp beurre salé");
		expect(hasEditsSinceTranslation(loaded)).toBe(true);
		expect(translationBase(loaded).source).toEqual(SHRIMP);
	});

	it("a Notes-only edit to an untranslated recipe keeps every ingredient (no regression)", () => {
		const original = recipeFrom(SHRIMP);
		const loaded = editBody(original, notesOnly);
		expect(loaded.frontmatter.ingredients).toEqual(original.frontmatter.ingredients);
		expect(shoppingRows([loaded, scampiRecipe()])).toEqual(shoppingRows([original, scampiRecipe()]));
	});
});

describe("aggregation of translated recipes", () => {
	it("aggregates a translated and an untranslated recipe exactly like the untranslated original", () => {
		const original = recipeFrom(SHRIMP);
		const translated = applyTranslation(original, FRENCH, "French");
		const withTranslation = shoppingRows([translated, scampiRecipe()]);
		expect(withTranslation).toEqual(shoppingRows([original, scampiRecipe()]));

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
		const translated = applyTranslation(recipeFrom(SHRIMP), FRENCH, "French");
		const other = scampiRecipe();
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
		expect(doc).toContain('"required": ["id", "text"]');
		expect(doc).toContain('"required": ["step", "text"]');
		expect(doc).toContain('"additionalProperties": false');
	});
});
