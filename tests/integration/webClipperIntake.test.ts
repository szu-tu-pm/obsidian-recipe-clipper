import { describe, expect, it } from "vitest";
import {
	applyWebClipCorrections,
	correctionsFromDraft,
	isPendingWebClip,
	listPendingWebClips,
	loadWebClipForReview,
	WEB_CLIP_FIELDS,
	WEB_CLIP_TYPE,
	webClipToReviewResult,
	type WebClipReviewResult,
} from "../../src/domain/extraction/webClipperIntake";
import { parseRecipeFile, serializeRecipeFile } from "../../src/domain/schema/recipeMarkdown";
import {
	createManualRecipe,
	ingredientFromRaw,
	safeParseRecipeFrontmatter,
	type RecipeDocument,
} from "../../src/domain/schema/recipeSchema";
import { RecipeIndexer } from "../../src/domain/vault/recipeIndexer";
import { RecipeRepository } from "../../src/domain/vault/recipeRepository";
import {
	ClipVault,
	clipYamlCodec,
	FIXTURE_NAMES,
	loadClip,
	loadSource,
	loadTemplate,
	renderTemplate,
	type FixtureName,
} from "../helpers/webClipperFixtures";

const NOW = "2026-10-17T18:00:00.000Z";

function intake(name: FixtureName, path = `Recipes/${name}.md`, existing = []) {
	return webClipToReviewResult({
		markdown: loadClip(name),
		path,
		yaml: clipYamlCodec,
		existingRecipes: existing,
		now: () => NOW,
	});
}

function draftOf(result: WebClipReviewResult): RecipeDocument {
	return result.status === "extracted" ? result.candidate.draft : result.draft;
}

/** Serialize the reviewed draft and read it back the way the plugin reads any recipe file. */
function roundTrip(draft: RecipeDocument) {
	const markdown = serializeRecipeFile(draft, clipYamlCodec);
	const reparsed = parseRecipeFile(markdown, clipYamlCodec, draft.path);
	const yaml = markdown.slice(4, markdown.indexOf("\n---", 3));
	return { markdown, reparsed, validation: safeParseRecipeFrontmatter(JSON.parse(yaml)) };
}

function setupVault() {
	const vault = new ClipVault();
	const indexer = new RecipeIndexer("Recipes", "Recipes/_attachments");
	const repository = new RecipeRepository(vault, clipYamlCodec, indexer, "Recipes");
	return { vault, indexer, repository };
}

/**
 * Hand-worked expectations, read off each `.source.json` page. Each category is
 * checked on its own; nothing here was produced by running the intake code.
 */
const EXPECTED: Record<
	FixtureName,
	{
		status: "extracted" | "manual-fallback";
		extractionMethod: "json-ld" | "manual";
		title: string;
		sourceUrl: string;
		author: string | null;
		siteName: string | null;
		servings: { raw: string; amount: number | null } | null;
		prep: number | null;
		cook: number | null;
		total: number | null;
		cookingMethods: string[];
		ingredientsRaw: string[];
		instructions: string[];
		images: string[];
		importedAt: string;
	}
> = {
	"complete-howtostep": {
		status: "extracted",
		extractionMethod: "json-ld",
		title: "Black Bean Chili",
		sourceUrl: "https://www.example-kitchen.test/recipes/black-bean-chili",
		author: "Ada Lovelace",
		siteName: "Example Kitchen",
		servings: { raw: "4", amount: 4 },
		prep: 15,
		cook: 60,
		total: 75,
		cookingMethods: ["Simmering"],
		ingredientsRaw: [
			"2 Tbsp. olive oil",
			"1 large onion, diced",
			"3-4 cloves garlic, minced",
			"1 ½ cups dried black beans",
			"400 g chopped tomatoes",
			"salt to taste",
		],
		instructions: [
			"Warm the oil and soften the onion.",
			"Add garlic, beans and tomatoes.",
			"Simmer for 1 hour and season.",
		],
		images: ["https://cdn.example-kitchen.test/chili.jpg"],
		importedAt: "2026-10-17T16:30:00.000Z",
	},
	"partial-string-steps": {
		status: "extracted",
		extractionMethod: "json-ld",
		title: "Quick Flatbread",
		sourceUrl: "https://blog.example.test/2026/10/quick-flatbread/",
		author: "Grace Hopper",
		siteName: "A Small Blog",
		servings: null,
		prep: null,
		cook: null,
		total: null,
		cookingMethods: [],
		ingredientsRaw: ["250 g plain flour", "1 tsp baking powder", "150 ml warm water", "2 T olive oil"],
		instructions: ["Mix the dry ingredients.", "Add the water and oil.", "Cook in a hot pan."],
		images: [],
		importedAt: "2026-10-17T16:30:00.000Z",
	},
	"no-schema": {
		status: "manual-fallback",
		extractionMethod: "manual",
		title: "Saturday market report",
		sourceUrl: "https://news.example.test/food/market-report",
		author: null,
		siteName: "Example News",
		servings: null,
		prep: null,
		cook: null,
		total: null,
		cookingMethods: [],
		ingredientsRaw: [],
		instructions: [],
		images: [],
		importedAt: "2026-10-17T16:30:00.000Z",
	},
	"sections-relative-image": {
		status: "extracted",
		extractionMethod: "json-ld",
		title: "Red Lentil Soup",
		sourceUrl: "https://example.org/r/lentil-soup?id=7",
		author: "Lin",
		siteName: null,
		servings: { raw: "6", amount: 6 },
		prep: null,
		cook: null,
		total: null,
		cookingMethods: [],
		ingredientsRaw: ["1 tsp salt", "1 cup red lentils", "1 tsp salt"],
		instructions: ["Rinse the lentils.", "Simmer until soft."],
		images: ["https://example.org/img/lentil.jpg"],
		importedAt: "2026-10-17T16:30:00.000Z",
	},
	"repeat-url": {
		status: "extracted",
		extractionMethod: "json-ld",
		title: "Black Bean Chili",
		sourceUrl: "https://www.example-kitchen.test/recipes/black-bean-chili/?utm_source=newsletter",
		author: null,
		siteName: "Example Kitchen",
		servings: null,
		prep: null,
		cook: null,
		total: null,
		cookingMethods: [],
		ingredientsRaw: ["2 Tbsp. olive oil", "1 ½ cups dried black beans"],
		instructions: ["Simmer the beans."],
		images: [],
		importedAt: "2026-10-17T17:00:00.000Z",
	},
};

describe("web clipper template", () => {
	const template = loadTemplate();

	it("targets Recipes/, triggers on schema.org Recipe and writes the clip marker", () => {
		expect(template.path).toBe("Recipes");
		expect(template.behavior).toBe("create");
		expect(template.triggers).toEqual(["schema:@Recipe"]);
		const type = template.properties.find((property) => property.name === "type");
		expect(type?.value).toBe(WEB_CLIP_TYPE);
		expect(template.properties.find((p) => p.name === "schemaVersion")).toEqual({
			name: "schemaVersion",
			value: "2",
			type: "number",
		});
	});

	it("writes exactly the frontmatter keys the intake reads, and nothing that sets a rating or image file", () => {
		expect(template.properties.map((property) => property.name).sort()).toEqual(
			[...WEB_CLIP_FIELDS].sort(),
		);
		for (const forbidden of ["rating", "images", "ingredients", "id", "extractionMethod"]) {
			expect(template.properties.some((property) => property.name === forbidden)).toBe(false);
		}
	});

	it("only fills recipe fields from schema.org variables and never from fixed text", () => {
		const schemaKeys: Record<string, string> = {
			title: "name",
			author: "author",
			publisher: "publisher",
			recipeYield: "recipeYield",
			prepTime: "prepTime",
			cookTime: "cookTime",
			totalTime: "totalTime",
			cookingMethod: "cookingMethod",
			image: "image",
			recipeIngredient: "recipeIngredient",
			recipeInstructions: "recipeInstructions",
		};
		for (const [property, schemaKey] of Object.entries(schemaKeys)) {
			expect(template.properties.find((p) => p.name === property)?.value).toBe(
				`{{schema:@Recipe:${schemaKey}}}`,
			);
		}
		expect(template.properties.find((p) => p.name === "sourceUrl")?.value).toBe("{{url}}");
	});

	it.each(FIXTURE_NAMES)("renders %s exactly as the fixture note", (name) => {
		expect(renderTemplate(template, loadSource(name))).toBe(loadClip(name));
	});
});

describe("web clip intake", () => {
	it.each(FIXTURE_NAMES)("%s: fills only what the page provides", (name) => {
		const expected = EXPECTED[name];
		const result = intake(name);
		expect(result.status).toBe(expected.status);
		const draft = draftOf(result);
		const fm = draft.frontmatter;
		expect(draft.path).toBe(`Recipes/${name}.md`);
		expect(fm.type).toBe("recipe");
		expect(fm.extractionMethod).toBe(expected.extractionMethod);
		expect(fm.title).toBe(expected.title);
		expect(fm.sourceUrl).toBe(expected.sourceUrl);
		expect(fm.author).toBe(expected.author);
		expect(fm.siteName).toBe(expected.siteName);
		expect(fm.servings).toEqual(expected.servings);
		expect(fm.prepTimeMinutes).toBe(expected.prep);
		expect(fm.cookTimeMinutes).toBe(expected.cook);
		expect(fm.totalTimeMinutes).toBe(expected.total);
		expect(fm.cookingMethods).toEqual(expected.cookingMethods);
		expect(fm.ingredients.map((item) => item.raw)).toEqual(expected.ingredientsRaw);
		expect(draft.instructions).toEqual(expected.instructions);
		expect(fm.importedAt).toBe(expected.importedAt);
		expect(fm.rating).toBeNull();
		expect(fm.images).toEqual([]);
		expect(draft.notes).toBe("");
		const images = result.status === "extracted" ? result.candidate.candidateImages : [];
		expect(images.map((image) => image.sourceUrl)).toEqual(expected.images);
	});

	it.each(FIXTURE_NAMES)(
		"%s: the reviewed note validates against the recipe schema and keeps attribution",
		(name) => {
			const expected = EXPECTED[name];
			const { reparsed, validation, markdown } = roundTrip(draftOf(intake(name)));
			expect(validation.success).toBe(true);
			expect(markdown).not.toContain(WEB_CLIP_TYPE);
			expect(reparsed.editedExternally).toBe(false);
			expect(reparsed.frontmatter.sourceUrl).toBe(expected.sourceUrl);
			expect(reparsed.frontmatter.author).toBe(expected.author);
			expect(reparsed.frontmatter.siteName).toBe(expected.siteName);
			expect(reparsed.frontmatter.ingredients.map((item) => item.raw)).toEqual(
				expected.ingredientsRaw,
			);
		},
	);

	it("parses clipped lines with the Stage 1 parser and keeps units as typed", () => {
		const fm = draftOf(intake("complete-howtostep")).frontmatter;
		// Read off the raw lines: "2 Tbsp. olive oil", "3-4 cloves garlic, minced",
		// "1 ½ cups dried black beans", "400 g chopped tomatoes", "salt to taste".
		expect(fm.ingredients[0]).toMatchObject({ quantity: 2, unit: "Tbsp", parseConfidence: "exact" });
		expect(fm.ingredients[2]).toMatchObject({
			quantity: 3,
			quantityMax: 4,
			unit: "cloves",
			preparation: "minced",
			parseConfidence: "range",
		});
		expect(fm.ingredients[3]).toMatchObject({ quantity: 1.5, unit: "cups" });
		expect(fm.ingredients[4]).toMatchObject({ quantity: 400, unit: "g", unitSystem: "metric" });
		expect(fm.ingredients[5]).toMatchObject({ quantity: null, unit: null, parseConfidence: "non_numeric" });
	});

	it("keeps a repeated ingredient line instead of merging it", () => {
		const fm = draftOf(intake("sections-relative-image")).frontmatter;
		expect(fm.ingredients).toHaveLength(3);
		expect(fm.ingredients[0]?.id).not.toBe(fm.ingredients[2]?.id);
	});

	it("warns, and invents nothing, when the clip has no schema.org recipe", () => {
		const result = intake("no-schema");
		expect(result.status).toBe("manual-fallback");
		expect(result.warnings.join(" ")).toMatch(/no schema\.org recipe data/);
	});

	it("rejects notes that are not clips", () => {
		const recipe = createManualRecipe("Plain");
		const markdown = serializeRecipeFile(recipe, clipYamlCodec);
		expect(() =>
			webClipToReviewResult({ markdown, path: "Recipes/plain.md", yaml: clipYamlCodec }),
		).toThrow(/not a web clip/);
		expect(() =>
			webClipToReviewResult({ markdown: "# no frontmatter", path: "x.md", yaml: clipYamlCodec }),
		).toThrow(/missing YAML/);
	});

	it("drops a source URL that is not http(s) and says so", () => {
		const markdown = loadClip("partial-string-steps").replace(
			'sourceUrl: "https://blog.example.test/2026/10/quick-flatbread/"',
			'sourceUrl: "file:///Users/me/flatbread.html"',
		);
		const result = webClipToReviewResult({ markdown, path: "Recipes/x.md", yaml: clipYamlCodec });
		expect(draftOf(result).frontmatter.sourceUrl).toBeNull();
		expect(result.warnings.join(" ")).toMatch(/not an http/);
	});
});

describe("clip review gate", () => {
	it("an unreviewed clip is pending, not indexed, and not available for shopping lists", async () => {
		const { vault, indexer } = setupVault();
		await vault.write("Recipes/Black Bean Chili 2026-10-17 093000.md", loadClip("complete-howtostep"));
		indexer.rebuildFromCache(vault);

		expect(indexer.list()).toEqual([]);
		expect(listPendingWebClips(vault, "Recipes", "Recipes/_attachments")).toEqual([
			{ path: "Recipes/Black Bean Chili 2026-10-17 093000.md", title: "Black Bean Chili" },
		]);
	});

	it("saving the review turns the clip note into an indexed recipe in place", async () => {
		const { vault, indexer, repository } = setupVault();
		const path = "Recipes/Black Bean Chili 2026-10-17 093000.md";
		await vault.write(path, loadClip("complete-howtostep"));
		indexer.rebuildFromCache(vault);

		const review = await loadWebClipForReview(vault, clipYamlCodec, path, [], () => NOW);
		expect(review).not.toBeNull();
		const saved = await repository.save(draftOf(review as WebClipReviewResult));
		indexer.rebuildFromCache(vault);

		expect(saved.path).toBe(path);
		expect(listPendingWebClips(vault, "Recipes", "Recipes/_attachments")).toEqual([]);
		expect(indexer.list().map((entry) => [entry.path, entry.title])).toEqual([
			[path, "Black Bean Chili"],
		]);
		const loaded = await repository.loadByPath(path);
		expect(loaded.ok).toBe(true);
		// A reviewed note is no longer a clip, so loading it again for review is refused.
		expect(await loadWebClipForReview(vault, clipYamlCodec, path, [])).toBeNull();
	});

	it("a review that is cancelled leaves the clip pending", async () => {
		const { vault, indexer } = setupVault();
		const path = "Recipes/clip.md";
		await vault.write(path, loadClip("partial-string-steps"));
		await loadWebClipForReview(vault, clipYamlCodec, path, []);
		indexer.rebuildFromCache(vault);
		expect(indexer.list()).toEqual([]);
		expect(await vault.read(path)).toBe(loadClip("partial-string-steps"));
		expect(await loadWebClipForReview(vault, clipYamlCodec, "Recipes/missing.md", [])).toBeNull();
	});

	it("only clips in the recipes folder, outside attachments, count as pending", () => {
		const clip = { type: WEB_CLIP_TYPE };
		expect(isPendingWebClip("Recipes/a.md", clip, "Recipes", "Recipes/_attachments")).toBe(true);
		expect(isPendingWebClip("Inbox/a.md", clip, "Recipes", "Recipes/_attachments")).toBe(false);
		expect(isPendingWebClip("Recipes/_attachments/a.md", clip, "Recipes", "Recipes/_attachments")).toBe(false);
		expect(isPendingWebClip("Recipes/a.md", { type: "recipe" }, "Recipes", "Recipes/_attachments")).toBe(false);
		expect(isPendingWebClip("Recipes/a.md", null, "Recipes", "Recipes/_attachments")).toBe(false);
	});
});

describe("repeated source URL", () => {
	async function seedExisting(repository: RecipeRepository) {
		const existing = createManualRecipe("Black Bean Chili");
		existing.frontmatter.sourceUrl = "https://example-kitchen.test/recipes/black-bean-chili";
		existing.frontmatter.extractionMethod = "json-ld";
		existing.frontmatter.rating = 5;
		existing.frontmatter.images = [
			{
				path: `Recipes/_attachments/${existing.frontmatter.id}/cover.webp`,
				alt: "My bowl",
				sourceUrl: null,
				isPrimary: true,
			},
		];
		existing.frontmatter.ingredients = [ingredientFromRaw("2 Tbsp. olive oil")];
		existing.notes = "Double the garlic next time.";
		return repository.save(existing);
	}

	it("reports the existing recipe as a duplicate and saving the clip leaves it untouched", async () => {
		const { vault, indexer, repository } = setupVault();
		const existing = await seedExisting(repository);
		const existingPath = existing.path as string;
		const before = await vault.read(existingPath);
		const clipPath = "Recipes/Black Bean Chili 2026-10-17 100000.md";
		await vault.write(clipPath, loadClip("repeat-url"));
		indexer.rebuildFromCache(vault);

		const known = indexer.list().map((entry) => ({ id: entry.id, sourceUrl: entry.sourceUrl, path: entry.path }));
		const review = (await loadWebClipForReview(vault, clipYamlCodec, clipPath, known)) as WebClipReviewResult;
		expect(review.duplicates).toEqual([
			{ id: existing.frontmatter.id, sourceUrl: existing.frontmatter.sourceUrl, path: existingPath },
		]);

		const draft = draftOf(review);
		expect(draft.frontmatter.id).not.toBe(existing.frontmatter.id);
		await repository.save(draft);
		indexer.rebuildFromCache(vault);

		expect(await vault.read(existingPath)).toBe(before);
		const reloaded = await repository.loadByPath(existingPath);
		expect(reloaded.ok && reloaded.recipe.frontmatter.rating).toBe(5);
		expect(reloaded.ok && reloaded.recipe.frontmatter.images.map((image) => image.path)).toEqual([
			`Recipes/_attachments/${existing.frontmatter.id}/cover.webp`,
		]);
		expect(reloaded.ok && reloaded.recipe.notes).toBe("Double the garlic next time.");
		expect(indexer.list().map((entry) => entry.path).sort()).toEqual([clipPath, existingPath].sort());
	});

	it("does not warn when no saved recipe shares the URL", () => {
		expect(intake("repeat-url").duplicates).toEqual([]);
	});
});

describe("review corrections", () => {
	it("keeps unchanged ingredients, reparses edited lines and keeps their raw text", () => {
		const draft = draftOf(intake("complete-howtostep"));
		const corrections = correctionsFromDraft(draft);
		expect(corrections.ingredientsText.split("\n")).toEqual(EXPECTED["complete-howtostep"].ingredientsRaw);
		const corrected = applyWebClipCorrections(draft, {
			ingredientsText: corrections.ingredientsText
				.replace("salt to taste", "1 tsp sea salt")
				.concat("\n- 2 Tbsp. olive oil\n\n"),
			instructionsText: "1. Warm the oil.\n2) Add everything else.\n",
			cookingMethodsText: "Simmering, Stovetop ,",
		});
		const ingredients = corrected.frontmatter.ingredients;
		expect(ingredients.map((item) => item.raw)).toEqual([
			"2 Tbsp. olive oil",
			"1 large onion, diced",
			"3-4 cloves garlic, minced",
			"1 ½ cups dried black beans",
			"400 g chopped tomatoes",
			"1 tsp sea salt",
			"2 Tbsp. olive oil",
		]);
		expect(ingredients[0]?.id).toBe(draft.frontmatter.ingredients[0]?.id);
		expect(ingredients[6]?.id).not.toBe(draft.frontmatter.ingredients[0]?.id);
		expect(ingredients[5]).toMatchObject({ quantity: 1, unit: "tsp", parseConfidence: "exact" });
		expect(corrected.instructions).toEqual(["Warm the oil.", "Add everything else."]);
		expect(corrected.frontmatter.cookingMethods).toEqual(["Simmering", "Stovetop"]);
		expect(roundTrip(corrected).validation.success).toBe(true);
	});
});

describe("mutation probes", () => {
	it("dropping the author property from the template loses the author the check relies on", () => {
		const template = loadTemplate();
		const source = loadSource("complete-howtostep");
		const author = (t: typeof template) =>
			draftOf(
				webClipToReviewResult({
					markdown: renderTemplate(t, source),
					path: "Recipes/x.md",
					yaml: clipYamlCodec,
				}),
			).frontmatter.author;
		expect(author(template)).toBe("Ada Lovelace");
		const mutated = {
			...template,
			properties: template.properties.map((property) =>
				property.name === "author" ? { ...property, value: "" } : property,
			),
		};
		expect(author(mutated)).toBeNull();
	});

	it("a clip without the marker is not pending, so the review gate depends on the marker", async () => {
		const { vault } = setupVault();
		await vault.write("Recipes/a.md", loadClip("complete-howtostep"));
		await vault.write(
			"Recipes/b.md",
			loadClip("complete-howtostep").replace(`type: "${WEB_CLIP_TYPE}"`, 'type: "note"'),
		);
		expect(listPendingWebClips(vault, "Recipes", "Recipes/_attachments").map((clip) => clip.path)).toEqual([
			"Recipes/a.md",
		]);
	});

	it("without the saved recipe in the index the duplicate list is empty, so the warning depends on it", () => {
		const existing = [
			{ id: "rec_01JQC0TEST0000000000000000", sourceUrl: "https://example-kitchen.test/recipes/black-bean-chili" },
		];
		expect(intake("repeat-url", "Recipes/r.md", existing as never).duplicates).toHaveLength(1);
		expect(intake("repeat-url", "Recipes/r.md", []).duplicates).toHaveLength(0);
	});
});
