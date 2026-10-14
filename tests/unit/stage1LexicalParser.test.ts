import { describe, expect, it } from "vitest";
import { parseIngredientLine } from "../../src/domain/aggregation/stage1LexicalParser";

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
});
