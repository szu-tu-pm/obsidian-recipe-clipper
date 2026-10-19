import { describe, expect, it } from "vitest";
import {
	applyWebClipCorrections,
	correctionsFromDraft,
	isPendingWebClip,
	listPendingWebClips,
	loadWebClipForReview,
	saveReviewedWebClip,
	WEB_CLIP_FIELDS,
	WEB_CLIP_SECTIONS,
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
	LEGACY_TEMPLATE_PATH,
	loadTemplate,
	OBJECT_TEXT_MODES,
	renderTemplate,
	UndocumentedSyntaxError,
	type FixtureName,
	type UndocumentedObjectText,
} from "../helpers/webClipperFixtures";

const NOW = "2026-10-17T18:00:00.000Z";

function intake(
	name: FixtureName,
	path = `Recipes/${name}.md`,
	existing = [],
	markdown = loadClip(name),
) {
	return webClipToReviewResult({
		markdown,
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
		/** Per undocumented object-text mode when the result depends on it. */
		instructions: string[] | Record<UndocumentedObjectText, string[]>;
		images: string[];
		importedAt: string;
		warnings: RegExp[];
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
		warnings: [],
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
		warnings: [],
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
		warnings: [/no schema\.org recipe data/],
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
		// HowToSection steps are nested two arrays deep, which no documented
		// expression reaches. Only an object printed as JSON carries them.
		instructions: {
			empty: [],
			"object-string": [],
			json: ["Rinse the lentils.", "Simmer until soft."],
		},
		images: ["https://example.org/img/lentil.jpg"],
		importedAt: "2026-10-17T16:30:00.000Z",
		warnings: [/groups its steps into sections/],
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
		warnings: [],
	},
	"string-steps-object-author": {
		status: "extracted",
		extractionMethod: "json-ld",
		title: "Classic Pancakes",
		sourceUrl: "https://pancakes.example.net/classic",
		author: "Julia Child",
		siteName: "Pancake Place",
		servings: { raw: "8 pancakes", amount: 8 },
		prep: null,
		cook: null,
		total: null,
		// A bare array key gives only the first cooking method.
		cookingMethods: ["Frying"],
		ingredientsRaw: ["1 cup all-purpose flour", "2 tbsp sugar", "1 cup milk", "1 egg"],
		instructions: [
			"Whisk the dry ingredients.",
			"Beat in the milk and egg.",
			"Fry ladlefuls on a hot griddle.",
		],
		images: ["https://pancakes.example.net/stack.jpg"],
		importedAt: "2026-10-17T16:30:00.000Z",
		warnings: [],
	},
	"mixed-steps-image-objects": {
		status: "extracted",
		extractionMethod: "json-ld",
		title: "Focaccia",
		sourceUrl: "https://bake.example.com/focaccia",
		// A bare array key gives only the first of two plain-string authors.
		author: "Ken Forkish",
		siteName: "Bake",
		servings: { raw: "1 tray", amount: 1 },
		prep: null,
		cook: null,
		total: null,
		cookingMethods: [],
		ingredientsRaw: ["500 g bread flour", "400 ml water", "10 g salt", "1 tsp instant yeast"],
		instructions: [
			"Mix everything into a shaggy dough.",
			"Rest overnight in the fridge.",
			"Bake at 230 °C for 25 minutes.",
		],
		images: ["https://bake.example.com/a.jpg"],
		importedAt: "2026-10-17T16:30:00.000Z",
		warnings: [],
	},
};

function expectedInstructions(name: FixtureName, mode: UndocumentedObjectText): string[] {
	const value = EXPECTED[name].instructions;
	return Array.isArray(value) ? value : value[mode];
}

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

	it("fills recipe fields only from schema.org or page variables, never from fixed text", () => {
		for (const property of template.properties) {
			if (property.name === "type" || property.name === "schemaVersion") {
				continue;
			}
			expect(property.value).toMatch(/^\{\{(schema:@Recipe:[^}]+|url|title|site|author|date)\}\}$/);
		}
		expect(template.properties.find((p) => p.name === "sourceUrl")?.value).toBe("{{url}}");
	});

	it("lists every ingredient and step in the note body, one item per line", () => {
		const body = template.noteContentFormat;
		for (const heading of Object.values(WEB_CLIP_SECTIONS)) {
			expect(body.split("\n")).toContain(heading);
		}
		expect(body).toContain("{{schema:@Recipe:recipeIngredient[*]|list}}");
		expect(body).toContain("{{schema:@Recipe:recipeInstructions[*].text|list:numbered}}");
		expect(body).toContain("{{schema:@Recipe:recipeInstructions[*]|list:numbered}}");
	});

	it.each(FIXTURE_NAMES)("renders %s exactly as the hand-written fixture note", (name) => {
		expect(renderTemplate(template, loadSource(name))).toBe(loadClip(name));
	});
});

/** How many of the page's ingredients and steps appear, as written, in the rendered clip. */
function captured(templatePath: string | undefined, name: FixtureName) {
	const rendered = renderTemplate(loadTemplate(templatePath), loadSource(name));
	const recipe = loadSource(name).recipe as {
		recipeIngredient: string[];
		recipeInstructions: Array<{ text: string }>;
	};
	return {
		ingredients: recipe.recipeIngredient.filter((line) => rendered.includes(line)).length,
		steps: recipe.recipeInstructions.filter((step) => rendered.includes(step.text)).length,
		ofIngredients: recipe.recipeIngredient.length,
		ofSteps: recipe.recipeInstructions.length,
	};
}

describe("template captures every item (documented renderer)", () => {
	it("the first-shipped bare-key template keeps only the first ingredient and the first step", () => {
		// complete-howtostep has 6 ingredients and 3 HowToStep steps.
		expect(captured(LEGACY_TEMPLATE_PATH, "complete-howtostep")).toEqual({
			ingredients: 1,
			steps: 0,
			ofIngredients: 6,
			ofSteps: 3,
		});
	});

	it("the current template keeps all of them", () => {
		expect(captured(undefined, "complete-howtostep")).toEqual({
			ingredients: 6,
			steps: 3,
			ofIngredients: 6,
			ofSteps: 3,
		});
	});

	it("the legacy clip, read by the intake, has at most one ingredient", () => {
		const markdown = renderTemplate(loadTemplate(LEGACY_TEMPLATE_PATH), loadSource("complete-howtostep"));
		const result = webClipToReviewResult({ markdown, path: "Recipes/x.md", yaml: clipYamlCodec });
		expect(draftOf(result).frontmatter.ingredients.length).toBeLessThanOrEqual(1);
	});
});

describe("renderer emulation follows the documentation", () => {
	const page = { url: "https://e.test/", title: "", site: "", author: "", date: "" };
	const render = (value: string, recipe: Record<string, unknown>, mode?: UndocumentedObjectText) =>
		renderTemplate(
			{
				schemaVersion: "0.1.0",
				name: "t",
				behavior: "create",
				noteNameFormat: "",
				path: "",
				triggers: [],
				properties: [],
				noteContentFormat: value,
			},
			{ category: "unit", page, recipe: { "@type": "Recipe", ...recipe } },
			mode,
		).replace(/^---\n\n---\n/, "");

	it("gives the first item of a bare array key", () => {
		expect(render("{{schema:@Recipe:recipeIngredient}}", { recipeIngredient: ["a", "b"] })).toBe("a");
	});

	it("gives an indexed item and a property from all items", () => {
		const recipe = { author: [{ name: "A" }, { name: "B" }] };
		expect(render("{{schema:@Recipe:author[1].name}}", recipe)).toBe("B");
		expect(render('{{schema:@Recipe:author[*].name|join:", "}}', recipe)).toBe("A, B");
		expect(render('{{schema:@Recipe:author[*].name|join:"\\n"}}', recipe)).toBe("A\nB");
	});

	it("renders list, list:numbered and first as documented", () => {
		const recipe = { recipeIngredient: ["a", "b"] };
		expect(render("{{schema:@Recipe:recipeIngredient[*]|list}}", recipe)).toBe("- a\n- b");
		expect(render("{{schema:@Recipe:recipeIngredient[*]|list:numbered}}", recipe)).toBe("1. a\n2. b");
		expect(render("{{schema:@Recipe:recipeIngredient[*]|first}}", recipe)).toBe("a");
		expect(render("{{schema:@Recipe:name|first}}", { name: "x" })).toBe("x");
	});

	it("prints an object reaching plain text per the chosen mode", () => {
		const recipe = { author: { name: "A" } };
		expect(render("{{schema:@Recipe:author}}", recipe, "empty")).toBe("");
		expect(render("{{schema:@Recipe:author}}", recipe, "json")).toBe('{"name":"A"}');
		expect(render("{{schema:@Recipe:author}}", recipe, "object-string")).toBe("[object Object]");
	});

	it("throws on syntax the documentation does not describe", () => {
		const recipe = { recipeInstructions: [{ itemListElement: [{ text: "x" }] }] };
		expect(() => render("{{schema:@Recipe:recipeInstructions[*].itemListElement[*].text}}", recipe)).toThrow(
			UndocumentedSyntaxError,
		);
		expect(() => render("{{schema:@Recipe:name|map:x => x}}", { name: "n" })).toThrow(UndocumentedSyntaxError);
		expect(() => render("{{schema:@Recipe:name|list}}", { name: "n" })).toThrow(UndocumentedSyntaxError);
		expect(() => render("{{selector:h1}}", {})).toThrow(UndocumentedSyntaxError);
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
		expect(draft.instructions).toEqual(expectedInstructions(name, "empty"));
		expect(fm.importedAt).toBe(expected.importedAt);
		expect(fm.rating).toBeNull();
		expect(fm.images).toEqual([]);
		expect(draft.notes).toBe("");
		const images = result.status === "extracted" ? result.candidate.candidateImages : [];
		expect(images.map((image) => image.sourceUrl)).toEqual(expected.images);
		expect(result.warnings).toHaveLength(expected.warnings.length);
		expected.warnings.forEach((pattern, index) => expect(result.warnings[index]).toMatch(pattern));
	});

	const modeCases = FIXTURE_NAMES.flatMap((name) => OBJECT_TEXT_MODES.map((mode) => [name, mode] as const));
	it.each(modeCases)(
		"%s rendered with objects printed as %s: same recipe, nothing invented",
		(name, mode) => {
			const expected = EXPECTED[name];
			const markdown = renderTemplate(loadTemplate(), loadSource(name), mode);
			const result = intake(name, `Recipes/${name}.md`, [], markdown);
			const draft = draftOf(result);
			expect(result.status).toBe(expected.status);
			expect(draft.frontmatter.title).toBe(expected.title);
			expect(draft.frontmatter.author).toBe(expected.author);
			expect(draft.frontmatter.siteName).toBe(expected.siteName);
			expect(draft.frontmatter.sourceUrl).toBe(expected.sourceUrl);
			expect(draft.frontmatter.servings).toEqual(expected.servings);
			expect(draft.frontmatter.ingredients.map((item) => item.raw)).toEqual(expected.ingredientsRaw);
			expect(draft.instructions).toEqual(expectedInstructions(name, mode));
			const images = result.status === "extracted" ? result.candidate.candidateImages : [];
			expect(images.map((image) => image.sourceUrl)).toEqual(expected.images);
		},
	);

	it("reports steps printed as [object Object] instead of guessing them", () => {
		const markdown = renderTemplate(loadTemplate(), loadSource("sections-relative-image"), "object-string");
		const result = intake("sections-relative-image", "Recipes/s.md", [], markdown);
		expect(result.warnings.join(" ")).toMatch(/could not be read/);
	});

	it.each(FIXTURE_NAMES)(
		"%s: the reviewed note validates against the recipe schema and keeps attribution",
		(name) => {
			const expected = EXPECTED[name];
			const { reparsed, validation, markdown } = roundTrip(draftOf(intake(name)));
			expect(markdown).not.toContain(WEB_CLIP_SECTIONS.instructionItems);
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

	it("uses ingredient and step edits the user made in the clip note before review", () => {
		const markdown = loadClip("repeat-url")
			.replace("- 1 ½ cups dried black beans", "- 1 ½ cups dried black beans\n- 1 tsp cumin")
			.replace("1. Simmer the beans.", "1. Simmer the beans.\n2. Season.");
		const draft = draftOf(intake("repeat-url", "Recipes/r.md", [], markdown));
		expect(draft.frontmatter.ingredients.map((item) => item.raw)).toEqual([
			"2 Tbsp. olive oil",
			"1 ½ cups dried black beans",
			"1 tsp cumin",
		]);
		expect(draft.instructions).toEqual(["Simmer the beans.", "Season."]);
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

		const loaded = await loadWebClipForReview(vault, clipYamlCodec, path, [], () => NOW);
		expect(loaded).not.toBeNull();
		if (!loaded) {
			return;
		}
		const outcome = await saveReviewedWebClip(
			vault,
			clipYamlCodec,
			path,
			loaded.revision,
			draftOf(loaded.review),
		);
		indexer.rebuildFromCache(vault);

		expect(outcome.status).toBe("saved");
		expect(listPendingWebClips(vault, "Recipes", "Recipes/_attachments")).toEqual([]);
		expect(indexer.list().map((entry) => [entry.path, entry.title])).toEqual([
			[path, "Black Bean Chili"],
		]);
		const reloaded = await repository.loadByPath(path);
		expect(reloaded.ok).toBe(true);
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
		const loaded = await loadWebClipForReview(vault, clipYamlCodec, clipPath, known);
		const review = loaded?.review as WebClipReviewResult;
		expect(review.duplicates).toEqual([
			{ id: existing.frontmatter.id, sourceUrl: existing.frontmatter.sourceUrl, path: existingPath },
		]);

		const draft = draftOf(review);
		expect(draft.frontmatter.id).not.toBe(existing.frontmatter.id);
		expect(
			(await saveReviewedWebClip(vault, clipYamlCodec, clipPath, loaded?.revision ?? "", draft)).status,
		).toBe("saved");
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
	it("dropping the author properties from the template loses the author the check relies on", () => {
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
				property.name.startsWith("author") ? { ...property, value: "" } : property,
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

describe("guarded review save", () => {
	const path = "Recipes/Black Bean Chili 2026-10-17 093000.md";

	async function openClip() {
		const { vault, indexer } = setupVault();
		await vault.write(path, loadClip("complete-howtostep"));
		const loaded = await loadWebClipForReview(vault, clipYamlCodec, path, []);
		if (!loaded) {
			throw new Error("clip did not load");
		}
		return { vault, indexer, loaded };
	}

	it("does not write when the clip changed after the review opened", async () => {
		const { vault, indexer, loaded } = await openClip();
		const newer = loadClip("complete-howtostep").replace("- salt to taste", "- salt to taste\n- 1 lime");
		await vault.write(path, newer);

		const outcome = await saveReviewedWebClip(vault, clipYamlCodec, path, loaded.revision, draftOf(loaded.review));
		expect(outcome.status).toBe("changed");
		expect(await vault.read(path)).toBe(newer);
		indexer.rebuildFromCache(vault);
		expect(indexer.list()).toEqual([]);
		expect(listPendingWebClips(vault, "Recipes", "Recipes/_attachments")).toHaveLength(1);
	});

	it("does not write when the clip was deleted after the review opened", async () => {
		const { vault, loaded } = await openClip();
		await vault.remove(path);
		const outcome = await saveReviewedWebClip(vault, clipYamlCodec, path, loaded.revision, draftOf(loaded.review));
		expect(outcome.status).toBe("changed");
		expect(await vault.exists(path)).toBe(false);
	});

	it("restores the original clip when the write throws after writing part of the note", async () => {
		const { vault, indexer, loaded } = await openClip();
		const original = await vault.read(path);
		const failing = Object.create(vault) as ClipVault;
		let calls = 0;
		failing.write = async (target: string, content: string) => {
			calls += 1;
			if (calls === 1) {
				await vault.write(target, content.slice(0, 40));
				throw new Error("disk full");
			}
			await vault.write(target, content);
		};
		failing.read = (target: string) => vault.read(target);

		const outcome = await saveReviewedWebClip(failing, clipYamlCodec, path, loaded.revision, draftOf(loaded.review));
		expect(outcome).toEqual({
			status: "failed",
			message: "The recipe could not be saved (disk full). The web clip is unchanged and still needs review.",
		});
		expect(await vault.read(path)).toBe(original);
		indexer.rebuildFromCache(vault);
		expect(indexer.list()).toEqual([]);
		expect(listPendingWebClips(vault, "Recipes", "Recipes/_attachments")).toHaveLength(1);
	});

	it("accepts a read-back that only differs by CRLF", async () => {
		const { vault, loaded } = await openClip();
		const crlf = Object.create(vault) as ClipVault;
		crlf.write = async (target: string, content: string) => {
			await vault.write(target, content.replace(/\n/g, "\r\n"));
		};
		crlf.read = (target: string) => vault.read(target);
		const outcome = await saveReviewedWebClip(
			crlf,
			clipYamlCodec,
			path,
			loaded.revision,
			draftOf(loaded.review),
		);
		expect(outcome.status).toBe("saved");
	});

	it("restores the original clip when the note does not read back as written", async () => {
		const { vault, loaded } = await openClip();
		const original = await vault.read(path);
		const lossy = Object.create(vault) as ClipVault;
		let calls = 0;
		lossy.write = async (target: string, content: string) => {
			calls += 1;
			await vault.write(target, calls === 1 ? content.slice(0, -10) : content);
		};
		lossy.read = (target: string) => vault.read(target);
		const outcome = await saveReviewedWebClip(lossy, clipYamlCodec, path, loaded.revision, draftOf(loaded.review));
		expect(outcome.status).toBe("failed");
		expect(await vault.read(path)).toBe(original);
	});

	it("says so when even the restore fails", async () => {
		const { vault, loaded } = await openClip();
		const broken = Object.create(vault) as ClipVault;
		broken.write = async () => {
			throw new Error("read-only");
		};
		broken.read = (target: string) => vault.read(target);
		const outcome = await saveReviewedWebClip(broken, clipYamlCodec, path, loaded.revision, draftOf(loaded.review));
		expect(outcome.status).toBe("failed");
		expect(outcome.status === "failed" && outcome.message).toMatch(/could not be restored/);
	});

	it("names a write failure that is not an Error and restores the clip", async () => {
		const { vault, loaded } = await openClip();
		const original = await vault.read(path);
		const broken = Object.create(vault) as ClipVault;
		let calls = 0;
		broken.write = async (target: string, content: string) => {
			calls += 1;
			if (calls === 1) {
				throw "disk full";
			}
			await vault.write(target, content);
		};
		broken.read = (target: string) => vault.read(target);
		const outcome = await saveReviewedWebClip(broken, clipYamlCodec, path, loaded.revision, draftOf(loaded.review));
		expect(outcome).toMatchObject({
			status: "failed",
			message: expect.stringContaining("The note could not be written."),
		});
		expect(outcome.status === "failed" && outcome.message).toMatch(/unchanged and still needs review/);
		expect(await vault.read(path)).toBe(original);
	});
});

describe("odd clip values", () => {
	it("keeps a clip whose fields are numbers, blanks, or objects", async () => {
		const frontmatter = {
			type: WEB_CLIP_TYPE,
			title: "   ",
			pageTitle: null,
			sourceUrl: "not a url",
			clippedAt: "yesterday",
			author: { name: 4 },
			publisher: "[object Object]",
			imageUrl: { caption: "no url" },
			recipeYield: 4,
			prepTime: "   ",
			cookTime: "",
			siteName: 12,
			instructionTypes: "HowToSection",
		};
		const body = [
			"## Ingredients",
			"- {not json",
			'- {"name":"salt"}',
			"### Instruction items",
			"1. [object Object]",
			"2. [object Object]",
			'3. [{"text":1},5]',
		].join("\n");
		const markdown = `---\n${JSON.stringify(frontmatter)}\n---\n${body}\n`;
		const result = webClipToReviewResult({
			markdown,
			path: "Recipes/odd-clip.md",
			yaml: clipYamlCodec,
			now: () => NOW,
		});
		expect(result.warnings).toEqual(
			expect.arrayContaining([
				"The clipped source URL is not an http(s) address and was not kept.",
				"Title was not on the page.",
				"1 clipped ingredient entry could not be read. Add it in review.",
				"3 clipped steps could not be read. Add them in review.",
			]),
		);
		const draft = draftOf(result);
		expect(draft.frontmatter.title).toBe("Untitled recipe");
		expect(draft.frontmatter.author).toBe("4");
		expect(draft.frontmatter.siteName).toBe("12");
		expect(draft.frontmatter.importedAt).toBe(NOW);

		const vault = new ClipVault();
		await vault.write("Recipes/odd-clip.md", markdown);
		expect(listPendingWebClips(vault, "Recipes", "Recipes/_attachments")).toEqual([
			{ path: "Recipes/odd-clip.md", title: "odd-clip" },
		]);
	});
});
