import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseIngredientLine } from "../../src/domain/aggregation/stage1LexicalParser";
import { HELD_OUT_ROOT, runHeldOutEvaluation } from "./heldOut";
import { EXIT_GATES, INGREDIENT_CATEGORIES, type IngredientCategory, runEvaluation } from "./runner";

const PROJECT_ROOT = process.cwd();

describe("held-out evaluation", () => {
	it("meets the confirmed gates on a corpus that does not reuse the tuning fixtures", async () => {
		const report = await runHeldOutEvaluation();
		const tuning = JSON.parse(readFileSync(resolve(PROJECT_ROOT, "tests/evals/fixtures/manifest.json"), "utf8")) as Manifest;
		const heldOut = JSON.parse(readFileSync(resolve(HELD_OUT_ROOT, "manifest.json"), "utf8")) as Manifest;
		const tuningPairs = JSON.parse(readFileSync(resolve(PROJECT_ROOT, "tests/evals/fixtures/aggregation/pairs.json"), "utf8")) as Pairs;
		const heldOutPairs = JSON.parse(readFileSync(resolve(HELD_OUT_ROOT, "aggregation/pairs.json"), "utf8")) as Pairs;

		expect(report.passed).toBe(true);
		expect(report.fixtureVersion).toBe("held-out-v1");
		for (const gate of Object.keys(EXIT_GATES) as Array<keyof typeof EXIT_GATES>) {
			expect(report.gates[gate].passed, gate).toBe(true);
		}
		expect(disjoint(rawLines(tuning), rawLines(heldOut))).toBe(true);
		expect(disjoint(tuning.fixtures.map((fixture) => fixture.id), heldOut.fixtures.map((fixture) => fixture.id))).toBe(true);
		expect(disjoint(pairIds(tuningPairs), pairIds(heldOutPairs))).toBe(true);
		expect(disjoint(pairLines(tuningPairs), pairLines(heldOutPairs))).toBe(true);
		for (const tier of [1, 2] as const) {
			const metrics = tier === 1 ? report.metrics.tier1 : report.metrics.tier2;
			for (const category of INGREDIENT_CATEGORIES) {
				expect(metrics.quantityUnitFidelityByCategory[category].total, `tier ${tier} ${category}`).toBeGreaterThanOrEqual(6);
			}
			const simple = metrics.quantityUnitFidelityByCategory.simple.total;
			expect(simple / metrics.quantityUnitFidelity.total).toBeLessThanOrEqual(0.25);
		}
	});

	it("drops below the quantity gates when fluid-ounce units are discarded", async () => {
		const report = await runEvaluation({
			fixtureRoot: HELD_OUT_ROOT,
			parseIngredient: (raw) => {
				const parsed = parseIngredientLine(raw);
				if (/\bfl(?:\.\s*|\s+)oz\b/i.test(raw) || /[½¼¾⅓⅛]/.test(raw)) {
					return { ...parsed, unit: null };
				}
				return parsed;
			},
		});

		expect(report.gates.tier1QuantityUnitFidelity.passed).toBe(false);
		expect(report.gates.tier2QuantityUnitFidelity.passed).toBe(false);
		expect(report.passed).toBe(false);
	});

	it("publishes a report whose measurements match a fresh run", async () => {
		const report = await runHeldOutEvaluation();
		const saved = JSON.parse(readFileSync(resolve(PROJECT_ROOT, "docs/eval-reports/held-out-v1-report.json"), "utf8")) as {
			passed: boolean;
			fixtureVersion: string;
			fixtureManifestSha256: string;
			metrics: unknown;
			gates: unknown;
		};
		const markdown = readFileSync(resolve(PROJECT_ROOT, "docs/eval-reports/held-out-v1-report.md"), "utf8");

		expect(saved.passed).toBe(true);
		expect(saved.fixtureVersion).toBe(report.fixtureVersion);
		expect(saved.fixtureManifestSha256).toBe(report.fixtureManifestSha256);
		expect(saved.metrics).toEqual(report.metrics);
		expect(saved.gates).toEqual(report.gates);
		expect(markdown).toContain("# Held-Out v1 Evaluation Report");
		expect(markdown).toContain("Overall result: **PASS**");
		expect(markdown).toContain("## Coverage");
	});
});

interface Manifest {
	fixtures: Array<{ id: string; expected: Array<{ ingredients: Array<{ raw: string; category: IngredientCategory }> }> }>;
}

interface Pairs {
	safeMerges: Array<{ id: string; left: string; right: string }>;
	unsafeMerges: Array<{ id: string; left: string; right: string }>;
}

function rawLines(manifest: Manifest): string[] {
	return manifest.fixtures.flatMap((fixture) => fixture.expected.flatMap((recipe) => recipe.ingredients.map((item) => item.raw)));
}

function pairIds(pairs: Pairs): string[] {
	return [...pairs.safeMerges, ...pairs.unsafeMerges].map((pair) => pair.id);
}

function pairLines(pairs: Pairs): string[] {
	return [...pairs.safeMerges, ...pairs.unsafeMerges].flatMap((pair) => [pair.left, pair.right]);
}

function disjoint(left: string[], right: string[]): boolean {
	const known = new Set(left);
	return right.every((item) => !known.has(item));
}
