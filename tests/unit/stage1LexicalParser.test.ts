import { describe, expect, it } from "vitest";
import { aggregateIngredients } from "../../src/domain/aggregation/aggregator";
import { recipeIngredientSchema } from "../../src/domain/schema/recipeSchema";
import {
	inferUnitSystem,
	normalizeVulgarFractions,
	normalizeUnit,
	parseIngredientLine,
} from "../../src/domain/aggregation/stage1LexicalParser";

describe("stage1LexicalParser", () => {
	it("preserves verbatim raw text", () => {
		const raw = "  ½ cup sugar, sifted  ";
		const parsed = parseIngredientLine(raw);
		expect(parsed.raw).toBe(raw);
	});

	it("parses unicode vulgar fractions", () => {
		const parsed = parseIngredientLine("½ cup sugar");
		expect(parsed.quantity).toBe(0.5);
		expect(parsed.quantityMax).toBeNull();
		expect(parsed.unit?.toLowerCase()).toMatch(/cup/);
		expect(parsed.name.toLowerCase()).toContain("sugar");
		expect(parsed.parseConfidence).toBe("exact");
	});

	it("parses mixed numbers", () => {
		const parsed = parseIngredientLine("1 1/2 cups flour");
		expect(parsed.quantity).toBe(1.5);
		expect(parsed.parseConfidence).toBe("exact");
		expect(parsed.name.toLowerCase()).toContain("flour");
	});

	it("parses ranges without collapsing to a single invented amount", () => {
		const parsed = parseIngredientLine("2-3 cloves garlic");
		expect(parsed.quantity).toBe(2);
		expect(parsed.quantityMax).toBe(3);
		expect(parsed.parseConfidence).toBe("range");
		expect(parsed.raw).toBe("2-3 cloves garlic");
	});

	it("marks to-taste lines as non_numeric and does not invent a quantity", () => {
		const parsed = parseIngredientLine("salt to taste");
		expect(parsed.parseConfidence).toBe("non_numeric");
		expect(parsed.quantity).toBeNull();
		expect(parsed.quantityMax).toBeNull();
		expect(parsed.raw).toBe("salt to taste");
	});

	it("marks as-needed and a-pinch lines as non_numeric", () => {
		const needed = parseIngredientLine("water as needed");
		const pinch = parseIngredientLine("a pinch of salt");
		expect(needed.parseConfidence).toBe("non_numeric");
		expect(needed.quantity).toBeNull();
		expect(pinch.parseConfidence).toBe("non_numeric");
		expect(pinch.quantity).toBeNull();
	});

	it("keeps parenthetical dual units as qualifiers instead of converting them", () => {
		const parsed = parseIngredientLine("2 pounds (900g) potatoes");
		expect(parsed.quantity).toBe(2);
		expect(parsed.parseConfidence).toBe("exact");
		expect(parsed.qualifiers.some((item) => /900g/i.test(item))).toBe(true);
		expect(parsed.raw).toBe("2 pounds (900g) potatoes");
	});

	it("classifies malformed strings as ambiguous and keeps the raw text", () => {
		const parsed = parseIngredientLine("??? leftover bits");
		expect(parsed.parseConfidence).toBe("ambiguous");
		expect(parsed.raw).toBe("??? leftover bits");
		expect(parsed.quantity).toBeNull();
	});

	it("flags optional ingredients without dropping the name", () => {
		const parsed = parseIngredientLine("1 tsp vanilla, optional");
		expect(parsed.optional).toBe(true);
		expect(parsed.name.toLowerCase()).toContain("vanilla");
		expect(parsed.parseConfidence).toBe("exact");
	});

	it("treats empty lines as ambiguous", () => {
		const parsed = parseIngredientLine("   ");
		expect(parsed.parseConfidence).toBe("ambiguous");
		expect(parsed.raw).toBe("   ");
		expect(parsed.quantity).toBeNull();
	});

	it("keeps non_numeric when a qualifier is present even if the line also has digits", () => {
		const parsed = parseIngredientLine("salt to taste, leftover from step 2");
		expect(parsed.parseConfidence).toBe("non_numeric");
		expect(parsed.quantity).toBeNull();
		expect(parsed.raw).toBe("salt to taste, leftover from step 2");
	});

	it("normalizes unit aliases used for unitSystem classification", () => {
		expect(normalizeUnit("fl. oz.")).toBe("fl oz");
		expect(normalizeUnit("T")).toBe("tbsp");
		expect(normalizeUnit("T.")).toBe("tbsp");
		expect(normalizeUnit("t.")).toBe("tsp");
		expect(normalizeUnit("c")).toBe("cup");
		expect(normalizeUnit("milligrams")).toBe("milligrams");
		expect(inferUnitSystem("fl. oz.")).toBe("imperial");
		expect(inferUnitSystem("T")).toBe("imperial");
		expect(inferUnitSystem("T.")).toBe("imperial");
		expect(inferUnitSystem("c")).toBe("imperial");
		expect(inferUnitSystem("milligrams")).toBe("metric");
	});
});

describe("stage1LexicalParser Unicode mixed fractions", () => {
	const fractions = [
		["¼", 1 / 4], ["½", 1 / 2], ["¾", 3 / 4], ["⅓", 1 / 3],
		["⅔", 2 / 3], ["⅕", 1 / 5], ["⅖", 2 / 5], ["⅗", 3 / 5],
		["⅘", 4 / 5], ["⅙", 1 / 6], ["⅚", 5 / 6], ["⅐", 1 / 7],
		["⅛", 1 / 8], ["⅜", 3 / 8], ["⅝", 5 / 8], ["⅞", 7 / 8],
		["⅑", 1 / 9], ["⅒", 1 / 10],
	] as const;

	it.each(fractions)("parses attached, spaced, and standalone %s quantities", (symbol, fraction) => {
		for (const [raw, expected] of [
			[`1${symbol} cups flour`, 1 + fraction],
			[`1 ${symbol} cups flour`, 1 + fraction],
			[`${symbol} cup flour`, fraction],
		] as const) {
			const parsed = parseIngredientLine(raw);
			expect(parsed.quantity, raw).toBe(expected);
			expect(parsed.quantityMax, raw).toBeNull();
			expect(parsed.unit, raw).toBe(raw.includes("cups") ? "cups" : "cup");
			expect(parsed.name, raw).toBe("flour");
			expect(parsed.raw, raw).toBe(raw);
		}
	});

	it.each([
		["1½–2 cups flour", 1.5, 2, "cups", "flour"],
		["1½ to 2 cups flour", 1.5, 2, "cups", "flour"],
		["1⅓-2⅔ cups stock", 1 + 1 / 3, 2 + 2 / 3, "cups", "stock"],
	] as const)("parses Unicode fractions inside range %s", (raw, min, max, unit, name) => {
		const parsed = parseIngredientLine(raw);
		expect(parsed.quantity).toBe(min);
		expect(parsed.quantityMax).toBe(max);
		expect(parsed.unit).toBe(unit);
		expect(parsed.name).toBe(name);
		expect(parsed.raw).toBe(raw);
	});

	it("inserts a separator only when a whole number is attached", () => {
		expect(normalizeVulgarFractions("1¼ cup")).toBe("1 1/4 cup");
		expect(normalizeVulgarFractions("1 ¼ cup")).toBe("1 1/4 cup");
		expect(normalizeVulgarFractions("¼ cup")).toBe("1/4 cup");
	});
});

describe("stage1LexicalParser exact thirds", () => {
	it.each([
		["⅓ cup sugar", 1 / 3],
		["⅔ cup sugar", 2 / 3],
		["1/3 cup sugar", 1 / 3],
		["2/3 cup sugar", 2 / 3],
		["1⅓ cups sugar", 1 + 1 / 3],
	] as const)("does not round %s", (raw, expected) => {
		const parsed = parseIngredientLine(raw);
		expect(parsed.quantity).toBe(expected);
		expect(parsed.unit).toBe(raw.includes("cups") ? "cups" : "cup");
		expect(parsed.name).toBe("sugar");
		expect(parsed.raw).toBe(raw);
	});

	function aggregate(lines: string[]) {
		return aggregateIngredients(lines.map((raw, index) => ({
			recipeId: `recipe-${index}`,
			ingredient: parseIngredientLine(raw),
		})))[0];
	}

	it("aggregates three one-thirds to exactly one cup", () => {
		const total = aggregate(["⅓ cup sugar", "⅓ cup sugar", "⅓ cup sugar"]);
		expect(total.quantity).toBe(48);
		expect((total.quantity ?? 0) / 48).toBe(1);
		expect(total.unit).toBe("tsp");
	});

	it("aggregates two-thirds plus one-third to exactly one cup", () => {
		const total = aggregate(["⅔ cup sugar", "⅓ cup sugar"]);
		expect(total.quantity).toBe(48);
		expect((total.quantity ?? 0) / 48).toBe(1);
		expect(total.unit).toBe("tsp");
	});
});

describe("stage1LexicalParser fluid ounces", () => {
	it.each([
		"2 fl oz cider vinegar",
		"2 fl. oz. cider vinegar",
		"2 fl.oz cider vinegar",
		"2 fluid ounce cider vinegar",
		"2 fluid ounces cider vinegar",
		"2 Fl Oz cider vinegar",
	])("captures the typed fluid-ounce unit in %s", (raw) => {
		const expectedUnit = raw.slice(2, raw.indexOf(" cider"));
		const parsed = parseIngredientLine(raw);
		expect(parsed.quantity).toBe(2);
		expect(parsed.unit).toBe(expectedUnit);
		expect(parsed.name).toBe("cider vinegar");
		expect(parsed.raw).toBe(raw);
		expect(parsed.unitSystem).toBe("imperial");
	});

	it.each([
		["2 oz cider vinegar", "oz"],
		["2 ounces cider vinegar", "ounces"],
	] as const)("keeps weight ounces unchanged in %s", (raw, unit) => {
		const parsed = parseIngredientLine(raw);
		expect(parsed.quantity).toBe(2);
		expect(parsed.unit).toBe(unit);
		expect(parsed.name).toBe("cider vinegar");
	});
});

describe("stage1LexicalParser count units", () => {
	it.each([
		"1 sprig rosemary", "2 sprigs rosemary",
		"1 head radicchio", "2 heads radicchio",
		"1 handful lettuce", "2 handfuls lettuce",
		"1 wedge lime", "2 wedges lime",
		"1 scoop yogurt", "2 scoops yogurt",
	])("captures a positional count unit in %s", (raw) => {
		const [, quantity, unit, name] = raw.match(/^(\d+)\s+(\S+)\s+(.+)$/) ?? [];
		const parsed = parseIngredientLine(raw);
		expect(parsed.quantity).toBe(Number(quantity));
		expect(parsed.unit).toBe(unit);
		expect(parsed.name).toBe(name);
		expect(parsed.raw).toBe(raw);
	});

	it.each([
		"1 cup scoop-shaped pasta",
		"2 lettuce heads",
		"1 cup wedge salad mix",
	])("does not remove a count-unit word from an ingredient name in %s", (raw) => {
		const parsed = parseIngredientLine(raw);
		expect(parsed.name).toContain(raw.replace(/^\d+\s+cup\s+|^\d+\s+/, ""));
	});

	it("documents that a recognized word directly after the quantity is a unit", () => {
		expect(parseIngredientLine("1 wedge salad")).toMatchObject({ unit: "wedge", name: "salad" });
		expect(parseIngredientLine("2 head cheese")).toMatchObject({ unit: "head", name: "cheese" });
	});
});

describe("stage1LexicalParser bare custom units", () => {
	it.each([
		["10 sprigs", 10, null, "sprigs"],
		["1 head", 1, null, "head"],
		["2 handfuls", 2, null, "handfuls"],
		["1 wedge", 1, null, "wedge"],
		["3 scoops", 3, null, "scoops"],
		["2 fl oz", 2, null, "fl oz"],
		["2 fl. oz.", 2, null, "fl. oz."],
		["8 fluid ounces", 8, null, "fluid ounces"],
		["2-3 sprigs", 2, 3, "sprigs"],
	] as const)("preserves the quantity and a valid name in %s", (raw, quantity, quantityMax, name) => {
		const parsed = parseIngredientLine(raw);
		expect(parsed.quantity).toBe(quantity);
		expect(parsed.quantityMax).toBe(quantityMax);
		expect(parsed.unit).toBeNull();
		expect(parsed.name).toBe(name);
		expect(parsed.name).not.toBe("");
		expect(parsed.raw).toBe(raw);
		expect(recipeIngredientSchema.safeParse(parsed).success).toBe(true);
	});
});
