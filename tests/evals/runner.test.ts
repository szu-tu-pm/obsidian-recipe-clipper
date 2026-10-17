import { describe, expect, it } from "vitest";
import { aggregateIngredients } from "../../src/domain/aggregation/aggregator";
import { parseIngredientLine } from "../../src/domain/aggregation/stage1LexicalParser";
import pairs from "./fixtures/aggregation/pairs.json";
import {
	EXIT_GATES,
	MINIMUM_DENOMINATORS,
	metric,
	renderMarkdown,
	runEvaluation,
	type AggregationCorpus,
	type AggregationPair,
} from "./runner";

function aggregatePair(pair: AggregationPair) {
	return aggregateIngredients([
		{ recipeId: "fixture-left", ingredient: parseIngredientLine(pair.left) },
		{ recipeId: "fixture-right", ingredient: parseIngredientLine(pair.right) },
	]);
}

describe("Phase 2 deterministic evaluation gates", () => {
	it("meets every extraction and aggregation exit gate", async () => {
		const report = await runEvaluation();

		expect(report.metrics.schemaValidity.rate).toBe(EXIT_GATES.schemaValidity);
		expect(report.metrics.hallucinatedFields.rate).toBe(EXIT_GATES.hallucinatedFieldRate);
		expect(report.metrics.tier1.ingredientRecall.rate).toBeGreaterThanOrEqual(EXIT_GATES.tier1IngredientRecall);
		expect(report.metrics.tier1.quantityUnitFidelity.rate).toBeGreaterThanOrEqual(EXIT_GATES.tier1QuantityUnitFidelity);
		expect(report.metrics.tier2.ingredientRecall.rate).toBeGreaterThanOrEqual(EXIT_GATES.tier2IngredientRecall);
		expect(report.metrics.tier2.quantityUnitFidelity.rate).toBeGreaterThanOrEqual(EXIT_GATES.tier2QuantityUnitFidelity);
		expect(report.metrics.falseMerges.rate).toBe(EXIT_GATES.falseMergeRate);
		expect(report.metrics.safeMergeRecall.rate).toBeGreaterThanOrEqual(EXIT_GATES.safeMergeRecall);
		expect(report.metrics.tier1.ingredientRecall.total).toBeGreaterThanOrEqual(MINIMUM_DENOMINATORS.tier1Ingredients);
		expect(report.metrics.tier2.ingredientRecall.total).toBeGreaterThanOrEqual(MINIMUM_DENOMINATORS.tier2Ingredients);
		expect(report.metrics.safeMergeRecall.total).toBeGreaterThanOrEqual(MINIMUM_DENOMINATORS.safeMergePairs);
		expect(report.metrics.falseMerges.total).toBeGreaterThanOrEqual(MINIMUM_DENOMINATORS.unsafeMergePairs);
		expect(report.passed).toBe(true);
	});

	it("records reproducibility metadata and separate merge failure lists", async () => {
		const report = await runEvaluation();
		const markdown = renderMarkdown(report);

		expect(report.gitCommit).toMatch(/^(unknown|[0-9a-f]{40})$/);
		expect(report.workingTreeDirty).toBeTypeOf("boolean");
		expect(report.fixtureVersion).toBe("phase2-v2");
		expect(report.fixtureManifestSha256).toMatch(/^[0-9a-f]{64}$/);
		expect(report.rulesVersion).toBe("v1");
		expect(report.ollama).toMatchObject({
			models: ["qwen2.5:7b-instruct"],
			promptVersion: "ollama-recipe-extraction-v1",
		});
		expect(report.ollama?.promptFingerprint).toMatch(/^[0-9a-f]{8}$/);
		expect(report.falseMergeDetails).toEqual([]);
		expect(report.missedSafeMergeDetails).toEqual([]);
		expect(report.wrongQuantityMergeDetails).toEqual([]);
		expect(report.incorrectSafeMergeDetails).toEqual([]);
		expect(report.unsafeMergeRuleMismatchDetails).toEqual([]);
		expect(report.extractionMethodMismatchDetails).toEqual([]);
		expect(report.missingExpectedScalarDetails).toEqual([]);
		expect(markdown).toContain("### False merges");
		expect(markdown).toContain("### Missed safe merges");
		expect(markdown).toContain("### Wrong-quantity safe merges");
		expect(markdown).toContain("Instruction fidelity");
	});

	it("rejects a simulated 10x kg conversion-factor mutation", async () => {
		const report = await runEvaluation({
			aggregatePair: (pair) => {
				const ingredients = [parseIngredientLine(pair.left), parseIngredientLine(pair.right)];
				const kgQuantity = ingredients.reduce(
					(sum, ingredient) => sum + (ingredient.unit === "kg" ? ingredient.quantity ?? 0 : 0),
					0,
				);
				const kgQuantityMax = ingredients.reduce(
					(sum, ingredient) => sum + (ingredient.unit === "kg" ? ingredient.quantityMax ?? ingredient.quantity ?? 0 : 0),
					0,
				);
				return aggregatePair(pair).map((row) => kgQuantity > 0
					? {
						...row,
						// A factor of 10,000 instead of 1,000 adds 9,000 g per kg.
						quantity: row.quantity == null ? null : row.quantity + kgQuantity * 9000,
						quantityMax: row.quantityMax == null ? null : row.quantityMax + kgQuantityMax * 9000,
					}
					: row);
			},
		});

		expect(report.wrongQuantityMergeDetails.map((item) => item.id)).toContain("metric-flour");
		expect(report.metrics.safeMergeRecall.rate).toBeLessThan(EXIT_GATES.safeMergeRecall);
		expect(report.gates.safeMergeRecall.passed).toBe(false);
		expect(report.passed).toBe(false);
	});

	it("fails percentage gates when a corpus denominator is too small", async () => {
		const fullCorpus = pairs as AggregationCorpus;
		const report = await runEvaluation({
			aggregationCorpus: {
				safeMerges: fullCorpus.safeMerges.slice(0, 1),
				unsafeMerges: fullCorpus.unsafeMerges.slice(0, 1),
			},
		});

		expect(metric(0, 0).rate).toBe(0);
		expect(report.corpusMinimums.safeMergePairs.passed).toBe(false);
		expect(report.corpusMinimums.unsafeMergePairs.passed).toBe(false);
		expect(report.gates.safeMergeRecall.passed).toBe(false);
		expect(report.gates.falseMergeRate.passed).toBe(false);
		expect(report.passed).toBe(false);
	});

	it("reports extraction-method mismatches and missing expected scalars", async () => {
		const report = await runEvaluation({
			transformCandidates: (fixtureId, candidates) => fixtureId === "tier1-basic-jsonld"
				? candidates.map((candidate, index) => index === 0
					? { ...candidate, extractionMethod: "ollama", servings: null }
					: candidate)
				: candidates,
		});

		expect(report.extractionMethodMismatchDetails[0]).toContain("expected json-ld, observed ollama");
		expect(report.missingExpectedScalarDetails).toContain("tier1-basic-jsonld recipe 1: missing servingsRaw");
	});
});
