import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	applyIngredientChoices,
	compareIngredientLists,
	type IngredientDisagreement,
} from "../../../src/domain/extraction/ingredientDisagreement";
import { extractDomHeuristicRecipes } from "../../../src/domain/extraction/domHeuristicExtractor";
import { extractStructuredRecipes } from "../../../src/domain/extraction/jsonLdExtractor";
import { extractRecipeFromPage } from "../../../src/domain/extraction/urlClipper";
import { parseUntrustedHtml } from "../../../src/domain/extraction/untrustedHtml";

const NOW = "2026-10-20T12:00:00.000Z";
const URL_ = "https://example.com/recipe";

type Category = "agree" | "formatting-only" | "real-difference";
type Compare = typeof compareIngredientLists;

/**
 * Expected flags are worked out by hand from each fixture's two lists, not produced by
 * running the code. Pages are tagged so each category is reported on its own.
 */
const FIXTURES: { file: string; category: Category; expected: IngredientDisagreement[] }[] = [
	{ file: "agree-wprm-card.html", category: "agree", expected: [] },
	{ file: "agree-heading-list.html", category: "agree", expected: [] },
	{ file: "agree-unicode-fractions.html", category: "agree", expected: [] },
	{ file: "agree-different-order.html", category: "agree", expected: [] },
	{ file: "formatting-only.html", category: "formatting-only", expected: [] },
	{ file: "formatting-only-wprm.html", category: "formatting-only", expected: [] },
	{
		file: "allrecipes-cream-of-chicken.html",
		category: "real-difference",
		expected: [
			{
				index: 0,
				structured: "1 10 ounce can cream of chicken",
				visible: "1 (10 ounce) can condensed cream of chicken soup",
			},
		],
	},
	{
		file: "real-difference-quantity.html",
		category: "real-difference",
		expected: [{ index: 0, structured: "2 cups sugar", visible: "1 cup sugar" }],
	},
	{
		file: "real-difference-extra-lines.html",
		category: "real-difference",
		expected: [
			{ index: 1, structured: "pinch of nutmeg", visible: null },
			{ index: null, structured: null, visible: "1 teaspoon vanilla" },
		],
	},
];

const MINIMUM_PER_CATEGORY: Record<Category, number> = {
	agree: 4,
	"formatting-only": 2,
	"real-difference": 3,
};

function loadFixture(file: string): string {
	return readFileSync(`tests/fixtures/ingredient-disagreement/${file}`, "utf8").replace(/\r\n/g, "\n");
}

/** Read both lists the way the URL import does, then run `compare` on them. */
function compareFixture(file: string, compare: Compare): IngredientDisagreement[] {
	const parsed = parseUntrustedHtml(loadFixture(file));
	const structured = extractStructuredRecipes(parsed.jsonLdBlocks, parsed.document, URL_);
	const dom = extractDomHeuristicRecipes(parsed.document, URL_);
	expect(structured).toHaveLength(1);
	expect(dom).toHaveLength(1);
	return compare(structured[0]!.ingredientsRaw, dom[0]!.ingredientsRaw);
}

/** Pages whose flags equal the hand-worked expectation, per category. */
function measure(compare: Compare): Record<Category, { correct: number; total: number }> {
	const result: Record<Category, { correct: number; total: number }> = {
		agree: { correct: 0, total: 0 },
		"formatting-only": { correct: 0, total: 0 },
		"real-difference": { correct: 0, total: 0 },
	};
	for (const fixture of FIXTURES) {
		result[fixture.category].total += 1;
		if (JSON.stringify(compareFixture(fixture.file, compare)) === JSON.stringify(fixture.expected)) {
			result[fixture.category].correct += 1;
		}
	}
	return result;
}

describe("ingredient disagreement between structured data and the visible list", () => {
	it("has enough varied fixtures in every category for the numbers to mean something", () => {
		const scores = measure(compareIngredientLists);
		for (const category of Object.keys(MINIMUM_PER_CATEGORY) as Category[]) {
			expect(scores[category].total).toBeGreaterThanOrEqual(MINIMUM_PER_CATEGORY[category]);
		}
	});

	it("gets every fixture in every category right", () => {
		const scores = measure(compareIngredientLists);
		expect(scores).toEqual({
			agree: { correct: 4, total: 4 },
			"formatting-only": { correct: 2, total: 2 },
			"real-difference": { correct: 3, total: 3 },
		});
	});

	// Mutation probes: run through the same measurement as the gate above.
	it("catches a comparison that never flags anything", () => {
		const scores = measure(() => []);
		expect(scores.agree.correct).toBe(4);
		expect(scores["real-difference"].correct).toBe(0);
	});

	it("catches a comparison that does not normalize before comparing", () => {
		const strict: Compare = (structured, visible) =>
			structured.flatMap((line, index) =>
				visible.includes(line) ? [] : [{ index, structured: line, visible: null }],
			);
		const scores = measure(strict);
		expect(scores["formatting-only"].correct).toBe(0);
		expect(scores.agree.correct).toBe(4);
	});

	it("flags the Allrecipes cream of chicken line and nothing else", () => {
		expect(compareFixture("allrecipes-cream-of-chicken.html", compareIngredientLists)).toEqual([
			{
				index: 0,
				structured: "1 10 ounce can cream of chicken",
				visible: "1 (10 ounce) can condensed cream of chicken soup",
			},
		]);
	});

	it("does not compare when either list is empty", () => {
		expect(compareIngredientLists([], ["1 egg"])).toEqual([]);
		expect(compareIngredientLists(["1 egg"], [])).toEqual([]);
	});

	it("does not pair a line that is only a number with a different line", () => {
		expect(compareIngredientLists(["1/2"], ["1 egg"])).toEqual([
			{ index: 0, structured: "1/2", visible: null },
			{ index: null, structured: null, visible: "1 egg" },
		]);
	});
});

describe("candidate flags from a fetched page", () => {
	it("puts the mismatch on the Allrecipes candidate and keeps the structured text in the draft", async () => {
		const result = await extractRecipeFromPage({
			html: loadFixture("allrecipes-cream-of-chicken.html"),
			pageUrl: URL_,
			now: () => NOW,
		});
		expect(result.status).toBe("extracted");
		if (result.status !== "extracted") {
			return;
		}
		expect(result.candidate.extractionMethod).toBe("json-ld");
		expect(result.candidate.ingredientDisagreements).toEqual([
			{
				index: 0,
				structured: "1 10 ounce can cream of chicken",
				visible: "1 (10 ounce) can condensed cream of chicken soup",
			},
		]);
		expect(result.candidate.draft.frontmatter.ingredients[0]?.raw).toBe(
			"1 10 ounce can cream of chicken",
		);
	});

	it("raises no flags on pages where the lists agree or differ only in formatting", async () => {
		for (const fixture of FIXTURES.filter((item) => item.category !== "real-difference")) {
			const result = await extractRecipeFromPage({
				html: loadFixture(fixture.file),
				pageUrl: URL_,
				now: () => NOW,
			});
			expect(result.status, fixture.file).toBe("extracted");
			if (result.status === "extracted") {
				expect(result.candidate.ingredientDisagreements, fixture.file).toEqual([]);
			}
		}
	});

	it("compares nothing on a page with structured data but no visible ingredient list", async () => {
		const result = await extractRecipeFromPage({
			html: `<html><body><script type="application/ld+json">
				{"@type":"Recipe","name":"Toast","recipeIngredient":["2 slices bread"],"recipeInstructions":["Toast it."]}
			</script><p>Just toast.</p></body></html>`,
			pageUrl: URL_,
			now: () => NOW,
		});
		expect(result.status).toBe("extracted");
		if (result.status === "extracted") {
			expect(result.candidate.ingredientDisagreements).toEqual([]);
		}
	});

	it("compares nothing when the visible recipe came from a page with no structured data", async () => {
		const result = await extractRecipeFromPage({
			html: `<html><body><div class="wprm-recipe"><h2 class="wprm-recipe-name">Rice</h2>
				<ul><li class="wprm-recipe-ingredient">1 cup rice</li></ul>
				<ol><li class="wprm-recipe-instruction">Boil.</li></ol></div></body></html>`,
			pageUrl: URL_,
			now: () => NOW,
		});
		expect(result.status).toBe("extracted");
		if (result.status === "extracted") {
			expect(result.candidate.extractionMethod).toBe("dom-heuristic");
			expect(result.candidate.ingredientDisagreements).toEqual([]);
		}
	});

	it("does not guess a pairing on a two-recipe page when the structured recipes have no titles", async () => {
		const ld = (ingredient: string) =>
			`{"@type":"Recipe","recipeIngredient":["${ingredient}"],"recipeInstructions":["Cook."]}`;
		const result = await extractRecipeFromPage({
			html: `<html><body>
				<script type="application/ld+json">[${ld("2 cups stock")},${ld("3 cups flour")}]</script>
				<h1>Soup</h1><h2>Ingredients</h2><ul><li>9 cups stock</li></ul><h2>Directions</h2><ol><li>Cook.</li></ol>
				<h1>Bread</h1><h2>Ingredients</h2><ul><li>9 cups flour</li></ul><h2>Directions</h2><ol><li>Cook.</li></ol>
			</body></html>`,
			pageUrl: URL_,
			now: () => NOW,
		});
		expect(result.status).toBe("needs-selection");
		if (result.status === "needs-selection") {
			expect(result.candidates.map((item) => item.ingredientDisagreements)).toEqual([[], []]);
		}
	});

	it("pairs each recipe on a two-recipe page with the visible recipe of the same title", async () => {
		const ld = (name: string, ingredient: string) =>
			`{"@type":"Recipe","name":"${name}","recipeIngredient":["${ingredient}"],"recipeInstructions":["Cook."]}`;
		const result = await extractRecipeFromPage({
			html: `<html><body>
				<script type="application/ld+json">[${ld("Soup", "2 cups stock")},${ld("Bread", "3 cups flour")}]</script>
				<h1>Soup</h1><h2>Ingredients</h2><ul><li>2 cups stock</li></ul><h2>Directions</h2><ol><li>Cook.</li></ol>
				<h1>Bread</h1><h2>Ingredients</h2><ul><li>4 cups flour</li></ul><h2>Directions</h2><ol><li>Cook.</li></ol>
			</body></html>`,
			pageUrl: URL_,
			now: () => NOW,
		});
		expect(result.status).toBe("needs-selection");
		if (result.status !== "needs-selection") {
			return;
		}
		expect(result.candidates.map((item) => item.ingredientDisagreements)).toEqual([
			[],
			[{ index: 0, structured: "3 cups flour", visible: "4 cups flour" }],
		]);
	});
});

describe("applying the reviewer's picks", () => {
	async function allrecipesDraft() {
		const result = await extractRecipeFromPage({
			html: loadFixture("real-difference-extra-lines.html"),
			pageUrl: URL_,
			now: () => NOW,
		});
		if (result.status !== "extracted") {
			throw new Error("fixture did not extract");
		}
		return result.candidate;
	}

	it("changes nothing without a pick", async () => {
		const candidate = await allrecipesDraft();
		const applied = applyIngredientChoices(candidate.draft, candidate.ingredientDisagreements, new Map());
		expect(applied.frontmatter.ingredients.map((item) => item.raw)).toEqual([
			"1 egg",
			"pinch of nutmeg",
			"1 cup milk",
		]);
	});

	it("takes the visible text, and adds a visible-only line, only where picked", async () => {
		const candidate = await allrecipesDraft();
		const [structuredOnly, visibleOnly] = candidate.ingredientDisagreements;
		const applied = applyIngredientChoices(
			candidate.draft,
			candidate.ingredientDisagreements,
			new Map([[visibleOnly!, "visible" as const], [structuredOnly!, "structured" as const]]),
		);
		expect(applied.frontmatter.ingredients.map((item) => item.raw)).toEqual([
			"1 egg",
			"pinch of nutmeg",
			"1 cup milk",
			"1 teaspoon vanilla",
		]);
	});

	it("removes a structured-only line the reviewer sets to visible, alongside a replacement and an addition", async () => {
		const candidate = await allrecipesDraft();
		const [structuredOnly, visibleOnly] = candidate.ingredientDisagreements;
		const replacement: IngredientDisagreement = {
			index: 2,
			structured: "1 cup milk",
			visible: "2 cups milk",
		};
		const applied = applyIngredientChoices(
			candidate.draft,
			[structuredOnly!, visibleOnly!, replacement],
			new Map([
				[structuredOnly!, "visible" as const],
				[visibleOnly!, "visible" as const],
				[replacement, "visible" as const],
			]),
		);
		expect(applied.frontmatter.ingredients.map((item) => item.raw)).toEqual([
			"1 egg",
			"2 cups milk",
			"1 teaspoon vanilla",
		]);
	});
});
