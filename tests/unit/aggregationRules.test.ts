import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	aggregateIngredients,
	sharedRulesVersion,
	type AggregatedIngredient,
} from "../../src/domain/aggregation/aggregator";
import { resolveIngredientIdentity } from "../../src/domain/aggregation/identityNormalizer";
import { collectPhrases, containsPhrase, normalizePhrase, removePhrase } from "../../src/domain/aggregation/rulesText";
import { parseIngredientLine } from "../../src/domain/aggregation/stage1LexicalParser";
import { canonicalizeMeasure, lookupUnit } from "../../src/domain/aggregation/unitNormalizer";
import type { RecipeIngredient } from "../../src/domain/schema/recipeSchema";

function withIngredient(ingredient: RecipeIngredient, overrides: Partial<RecipeIngredient>): RecipeIngredient {
	return { ...ingredient, ...overrides };
}

function fromLines(lines: Array<[string, string]>) {
	return lines.map(([recipeId, line]) => ({
		recipeId,
		ingredient: parseIngredientLine(line),
	}));
}

function pair(left: string, right: string): AggregatedIngredient[] {
	return aggregateIngredients(fromLines([
		["rec_a", left],
		["rec_b", right],
	]));
}

const SAFE_MERGES = [
	["1 cup scallions", "2 tbsp green onions"],
	["8 oz butter", "1/2 lb butter"],
	["1 onion, diced", "2 onions, minced"],
	["2 cloves garlic", "3 cloves garlic"],
	["500 g flour", "0.5 kg flour"],
	["1 tsp salt", "2 tsp salt"],
	["1 cup cilantro", "1/2 cup fresh coriander leaves"],
	["1 cup flour", "2 tbsp flour"],
	["1 cup fresh cilantro", "1 cup cilantro"],
	["1 tsp paprika", "2 tsp paprika"],
] as const;

const FALSE_MERGES = [
	["1 cup fresh cilantro", "1 cup dried cilantro"],
	["1 tbsp salted butter", "1 tbsp unsalted butter"],
	["1 cup all-purpose flour", "120 g all-purpose flour"],
	["1 cup water", "240 ml water"],
	["1 lb boneless chicken thighs", "1 lb bone-in chicken thighs"],
	["1 tsp whole coriander", "1 tsp ground coriander"],
	["8 oz raw shrimp", "8 oz cooked shrimp"],
	["2 cloves garlic", "1 bunch garlic"],
	["1 cup cilantro", "1 cup dried cilantro"],
	["1 tbsp butter", "1 tbsp salted butter"],
	["8 oz shrimp", "8 oz raw shrimp"],
	["1 tsp thyme", "1 tsp fresh thyme"],
] as const;

describe("aggregation rules", () => {
	it("keeps every false-merge fixture apart", () => {
		const merged = FALSE_MERGES.filter(([left, right]) => {
			const result = pair(left, right);
			return result.length === 1 || result.some((row) => row.sourceRefs.length > 1);
		});
		expect(merged).toEqual([]);
		for (const [left, right] of FALSE_MERGES) {
			const result = pair(left, right);
			expect(result).toHaveLength(2);
			expect(result.every((row) => row.mergeRuleId === "v1.keep-separate")).toBe(true);
			expect(result.every((row) => row.rulesVersion === "v1" && row.mergeReason.length > 0)).toBe(true);
		}
	});

	it("meets the safe-merge recall gate", () => {
		const merged = SAFE_MERGES.filter(([left, right]) => pair(left, right).length === 1);
		expect(merged.length / SAFE_MERGES.length).toBeGreaterThanOrEqual(0.92);
	});

	it("sums aliases in the canonical unit and records both sources", () => {
		const [result] = pair("1 cup scallions", "2 tbsp green onions");
		expect(result.canonicalId).toBe("green-onion");
		expect(result.name).toBe("green onion");
		expect(result.quantity).toBe(54);
		expect(result.quantityMax).toBeNull();
		expect(result.unit).toBe("tsp");
		expect(result.dimension).toBe("us_volume");
		expect(result.mergeRuleId).toBe("v1.merge-alias");
		expect(result.rulesVersion).toBe("v1");
		expect(result.sourceRefs.map((ref) => ref.recipeId).sort()).toEqual(["rec_a", "rec_b"]);

		const [sameRecipe] = aggregateIngredients(fromLines([
			["rec_a", "1 tsp salt"],
			["rec_a", "2 tsp salt"],
		]));
		expect(sameRecipe.sourceRefs.map((ref) => ref.recipeId)).toEqual(["rec_a", "rec_a"]);
	});

	it("sums mass without treating cups as grams", () => {
		const [butter] = pair("8 oz butter", "1/2 lb butter");
		expect(butter.quantity).toBeCloseTo(453.59237, 5);
		expect(butter.unit).toBe("g");
		expect(butter.dimension).toBe("mass");

		const flour = pair("1 cup all-purpose flour", "120 g all-purpose flour");
		expect(flour.map((row) => row.dimension).sort()).toEqual(["mass", "us_volume"]);
		expect(flour.every((row) => row.mergeReason.includes("Cross-dimension"))).toBe(true);
	});

	it("sums counts and keeps incompatible count units apart", () => {
		const [onions] = pair("1 onion, diced", "2 onions, minced");
		expect(onions.quantity).toBe(3);
		expect(onions.unit).toBe("piece");
		expect(onions.preparation).toBe("diced, minced");

		const [garlic] = pair("2 cloves garlic", "3 cloves garlic");
		expect(garlic.quantity).toBe(5);
		expect(garlic.unit).toBe("clove");

		const mixed = pair("2 cloves garlic", "1 bunch garlic");
		expect(mixed.map((row) => row.unit).sort()).toEqual(["bunch", "clove"]);
		expect(mixed.every((row) => row.mergeReason.includes("not interchangeable"))).toBe(true);
	});

	it("does not treat a missing qualifier as a match and does not merge across locale", () => {
		const herbs = pair("1 cup fresh cilantro", "1 cup dried cilantro");
		expect(herbs).toHaveLength(2);
		expect(herbs.every((row) => row.mergeReason.includes("qualifier"))).toBe(true);

		const water = pair("1 cup water", "240 ml water");
		expect(water.map((row) => row.unit).sort()).toEqual(["ml", "tsp"]);
		expect(resolveIngredientIdentity(parseIngredientLine("1 cup fresh coriander leaves")).canonicalId).toBe("cilantro");
		expect(resolveIngredientIdentity(parseIngredientLine("1 tsp whole coriander")).canonicalId).toBe("coriander-seed");
	});

	it("keeps identical unknown names together and different names apart", () => {
		const [paprika] = pair("1 tsp paprika", "2 tsp paprika");
		expect(paprika.quantity).toBe(3);
		expect(paprika.mergeRuleId).toBe("v1.merge-same-dimension");
		expect(paprika.canonicalId).toBe("name:paprika");

		const smoked = pair("1 tsp paprika", "1 tsp smoked paprika");
		expect(smoked).toHaveLength(2);
		expect(smoked.every((row) => row.sourceRefs.length === 1)).toBe(true);
	});

	it("refuses non-numeric quantities, unknown units, and empty input", () => {
		expect(aggregateIngredients([])).toEqual([]);
		const taste = pair("salt to taste", "salt to taste");
		expect(taste).toHaveLength(2);
		expect(taste.every((row) => row.mergeReason.includes("Non-numeric"))).toBe(true);

		const pinch = pair("1 pinch salt", "1 pinch salt");
		expect(pinch).toHaveLength(2);
		expect(pinch.every((row) => row.mergeReason.includes("Unsupported unit"))).toBe(true);

		const [only] = aggregateIngredients(fromLines([["rec_a", "1 tsp salt"]]));
		expect(only.mergeRuleId).toBe("v1.no-merge");
		expect(only.rulesVersion).toBe("v1");
	});

	it("sums ranges by keeping the upper bound", () => {
		const [salt] = pair("1-2 tsp salt", "1 tsp salt");
		expect(salt.quantity).toBe(2);
		expect(salt.quantityMax).toBe(3);
		expect(salt.unit).toBe("tsp");
	});

	it("canonicalizes within one dimension and refuses an unknown unit", () => {
		expect(canonicalizeMeasure("T", 1, null)).toEqual({
			dimension: "us_volume",
			unit: "tsp",
			quantity: 3,
			quantityMax: null,
		});
		expect(canonicalizeMeasure("fl. oz.", 2, 4)?.quantity).toBe(12);
		expect(canonicalizeMeasure("fl. oz.", 2, 4)?.quantityMax).toBe(24);
		expect(canonicalizeMeasure(null, 2, null)?.unit).toBe("piece");
		expect(canonicalizeMeasure("splash", 1, null)).toBeNull();
		expect(canonicalizeMeasure("cup", null, null)).toBeNull();
		expect(canonicalizeMeasure("cup", 0, null)).toBeNull();
		expect(canonicalizeMeasure("cup", Number.NaN, null)).toBeNull();
		expect(canonicalizeMeasure("cup", 1, Number.NaN)?.quantityMax).toBeNull();
		expect(lookupUnit(null)).toBeNull();
		expect(lookupUnit(".")).toBeNull();
		expect(lookupUnit("cup")?.dimension).toBe("us_volume");
	});

	it("rejects mixed rule versions and ignores empty phrases", () => {
		expect(sharedRulesVersion("v1", "v1")).toBe("v1");
		expect(() => sharedRulesVersion("v1", "v2")).toThrow(/share one version/);
		expect(() => sharedRulesVersion()).toThrow(/share one version/);
		expect(containsPhrase("unsalted butter", "salted")).toBe(false);
		expect(containsPhrase("fresh cilantro", "")).toBe(false);
		expect(removePhrase("onion diced", "")).toBe("onion diced");
		expect(normalizePhrase("Bone-in")).toBe("bone in");
		expect(collectPhrases(["", "  ", "Bone-in", "fresh"])).toEqual(["bone in", "fresh"]);

		const blank = parseIngredientLine("1 tsp salt");
		const unnamed = resolveIngredientIdentity(withIngredient(blank, { name: "", raw: "", preparation: null }));
		expect(unnamed.canonicalId).toBe("name:unknown");
		const freshOnly = resolveIngredientIdentity(withIngredient(blank, { name: "fresh", raw: "fresh", preparation: null }));
		expect(freshOnly.canonicalId).toBe("name:fresh");
		expect(freshOnly.blockingKey).toContain("freshness=fresh");
		const bothStates = resolveIngredientIdentity(parseIngredientLine("1 tsp fresh dried thyme"));
		expect(bothStates.blockingKey).toBe("freshness=dried;freshness=fresh");
	});

	it("aggregates 15 recipes in under 50ms", () => {
		const lines = [
			"1 tsp salt",
			"2 tbsp flour",
			"1 cup water",
			"8 oz butter",
			"2 cloves garlic",
			"1 onion, diced",
			"1 cup scallions",
			"120 g flour",
			"1 tsp whole coriander",
			"1 cup fresh cilantro",
			"1 lb boneless chicken thighs",
			"8 oz raw shrimp",
			"1 bunch parsley",
			"240 ml water",
		];
		const sources = [];
		for (let recipe = 0; recipe < 15; recipe++) {
			for (const line of lines) {
				sources.push({
					recipeId: `rec_${recipe}`,
					ingredient: parseIngredientLine(line),
				});
			}
		}
		expect(sources).toHaveLength(210);
		aggregateIngredients(sources);
		const started = performance.now();
		const result = aggregateIngredients(sources);
		expect(performance.now() - started).toBeLessThan(50);
		expect(result.length).toBeGreaterThan(0);
		expect(result.every((row) => row.rulesVersion === "v1")).toBe(true);
	});

	it("does not call a model or the network", () => {
		for (const file of ["aggregator.ts", "unitNormalizer.ts", "identityNormalizer.ts"]) {
			const source = readFileSync(new URL(`../../src/domain/aggregation/${file}`, import.meta.url), "utf8");
			expect(source).not.toMatch(/\bfetch\s*\(/);
			expect(source).not.toMatch(/ollama/i);
		}
	});
});
