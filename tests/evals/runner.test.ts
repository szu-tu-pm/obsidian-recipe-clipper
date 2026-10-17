import { describe, expect, it } from "vitest";
import { EXIT_GATES, renderMarkdown, runEvaluation } from "./runner";

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
		expect(report.passed).toBe(true);
	});

	it("records reproducibility metadata and separate merge failure lists", async () => {
		const report = await runEvaluation();
		const markdown = renderMarkdown(report);

		expect(report.gitCommit).toMatch(/^[0-9a-f]{40}$/);
		expect(report.fixtureVersion).toBe("phase2-v1");
		expect(report.rulesVersion).toBe("v1");
		expect(report.ollama).toMatchObject({
			models: ["qwen2.5:7b-instruct"],
			promptVersion: "ollama-recipe-extraction-v1",
		});
		expect(report.ollama?.promptFingerprint).toMatch(/^[0-9a-f]{8}$/);
		expect(report.falseMergeDetails).toEqual([]);
		expect(report.missedSafeMergeDetails).toEqual([]);
		expect(markdown).toContain("### False merges");
		expect(markdown).toContain("### Missed safe merges");
		expect(markdown).toContain("Instruction fidelity");
	});
});
