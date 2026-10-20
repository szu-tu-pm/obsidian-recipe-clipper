import { describe, expect, it } from "vitest";
import { aggregateIngredients } from "../../src/domain/aggregation/aggregator";
import { parseIngredientLine } from "../../src/domain/aggregation/stage1LexicalParser";
import type { RecipeIngredient } from "../../src/domain/schema/recipeSchema";
import fixturesJson from "../fixtures/ingredient-parser/p2-12-regressions.json";

type Category = "package-size" | "brackets" | "hyphenated-measure" | "trailing-note";
type Fixture = {
	id: string;
	category: Category;
	raw: string;
	expected: {
		quantity?: number | null;
		unit?: string | null;
		name: string;
		qualifier?: string;
		preparation?: string;
	};
};
type Parser = (raw: string) => RecipeIngredient;

const fixtures = fixturesJson as Fixture[];
const categories: Category[] = ["package-size", "brackets", "hyphenated-measure", "trailing-note"];

function matches(fixture: Fixture, parsed: RecipeIngredient): boolean {
	const { expected } = fixture;
	return parsed.name === expected.name
		&& (expected.quantity === undefined || parsed.quantity === expected.quantity)
		&& (expected.unit === undefined || parsed.unit === expected.unit)
		&& (expected.preparation === undefined || parsed.preparation === expected.preparation)
		&& (expected.qualifier === undefined || parsed.qualifiers.includes(expected.qualifier));
}

function measureCategory(category: Category, parser: Parser) {
	const categoryFixtures = fixtures.filter((fixture) => fixture.category === category);
	const matched = categoryFixtures.filter((fixture) => matches(fixture, parser(fixture.raw))).length;
	return {
		matched,
		total: categoryFixtures.length,
		rate: categoryFixtures.length === 0 ? 0 : matched / categoryFixtures.length,
	};
}

describe("P2-12 ingredient parser regression fixtures", () => {
	it.each(categories)("parses every varied %s fixture", (category) => {
		const measurement = measureCategory(category, parseIngredientLine);
		expect(measurement.total).toBeGreaterThanOrEqual(3);
		expect(measurement.matched).toBe(measurement.total);
		expect(measurement.rate).toBe(1);
	});

	it("removes every bracket from all ten stray-bracket ingredient names", () => {
		const bracketFixtures = fixtures.filter((fixture) => fixture.category === "brackets");
		expect(bracketFixtures).toHaveLength(10);
		for (const fixture of bracketFixtures) {
			const parsed = parseIngredientLine(fixture.raw);
			expect(parsed.name, fixture.id).toBe(fixture.expected.name);
			expect(parsed.name, fixture.id).not.toMatch(/[()[\]{}]/);
		}
	});

	it("keeps typed compound units in recipe data and aggregates two 10-ounce cans to about 567 g", () => {
		const first = parseIngredientLine("1 10 ounce can cream of chicken soup");
		const second = parseIngredientLine("1 (10 ounce) can cream of chicken soup");
		expect(first).toMatchObject({ quantity: 1, unit: "10 ounce can", name: "cream of chicken soup" });
		expect(second).toMatchObject({ quantity: 1, unit: "10 ounce can", name: "cream of chicken soup" });
		const [aggregated] = aggregateIngredients([
			{ recipeId: "recipe-1", ingredient: first },
			{ recipeId: "recipe-2", ingredient: second },
		]);
		expect(aggregated.unit).toBe("g");
		expect(aggregated.quantity).toBeCloseTo(566.9904625, 7);
	});

	it("aggregates decimal-ounce and metric package sizes without changing their saved units", () => {
		const tomatoes = parseIngredientLine("2 14.5-ounce cans diced tomatoes");
		const chickpeas = parseIngredientLine("3 400 g cans chickpeas");
		expect(tomatoes.unit).toBe("14.5-ounce cans");
		expect(chickpeas.unit).toBe("400 g cans");
		expect(aggregateIngredients([{ recipeId: "tomatoes", ingredient: tomatoes }])[0]).toMatchObject({
			quantity: 822.136170625,
			unit: "g",
		});
		expect(aggregateIngredients([{ recipeId: "chickpeas", ingredient: chickpeas }])[0]).toMatchObject({
			quantity: 1200,
			unit: "g",
		});
	});

	it.each([
		["package-size", (raw: string) => ({ ...parseIngredientLine(raw), unit: "ounce" })],
		["brackets", (raw: string) => {
			const parsed = parseIngredientLine(raw);
			return { ...parsed, name: `${parsed.name} )` };
		}],
		["hyphenated-measure", (raw: string) => ({ ...parseIngredientLine(raw), quantity: 2, unit: null, name: `-inch piece of ${parseIngredientLine(raw).name}` })],
		["trailing-note", (raw: string) => ({ ...parseIngredientLine(raw), name: raw })],
	] as const)("detects the named legacy %s mutation through the category measurement", (category, mutation) => {
		const baseline = measureCategory(category, parseIngredientLine);
		const mutated = measureCategory(category, mutation);
		expect(baseline.rate).toBe(1);
		expect(mutated.matched).toBeLessThan(baseline.matched);
		expect(mutated.rate).toBeLessThan(baseline.rate);
	});
});
