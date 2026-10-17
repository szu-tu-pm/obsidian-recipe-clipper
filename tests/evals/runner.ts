import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { JSDOM } from "jsdom";
import { aggregateIngredients, RULES_VERSION } from "../../src/domain/aggregation/aggregator";
import { parseIngredientLine } from "../../src/domain/aggregation/stage1LexicalParser";
import { recipeFrontmatterSchema } from "../../src/domain/schema/recipeSchema";
import { OLLAMA_RECIPE_EXTRACTION_PROMPT } from "../../src/domain/extraction/ollamaExtractor";
import { extractRecipeFromPage } from "../../src/domain/extraction/urlClipper";
import type { ExtractionCandidate } from "../../src/domain/extraction/types";

const PROJECT_ROOT = process.cwd();
const FIXTURE_ROOT = resolve(PROJECT_ROOT, "tests/evals/fixtures");
const DEFAULT_REPORT_ROOT = resolve(PROJECT_ROOT, "docs/eval-reports");
const FIXED_NOW = "2025-01-01T00:00:00.000Z";

export const EXIT_GATES = {
	schemaValidity: 1,
	hallucinatedFieldRate: 0,
	tier1IngredientRecall: 0.98,
	tier1QuantityUnitFidelity: 0.96,
	tier2IngredientRecall: 0.9,
	tier2QuantityUnitFidelity: 0.88,
	falseMergeRate: 0,
	safeMergeRecall: 0.92,
} as const;

interface ExpectedIngredient {
	raw: string;
	quantity: number | null;
	quantityMax?: number | null;
	unit: string | null;
}

interface ExpectedRecipe {
	title: string;
	ingredients: ExpectedIngredient[];
	instructions: string[];
	servingsRaw: string | null;
	prepTimeMinutes: number | null;
	cookTimeMinutes: number | null;
	totalTimeMinutes: number | null;
	cookingMethods: string[];
	author: string | null;
	siteName: string | null;
}

interface ExtractionFixture {
	id: string;
	tier: 1 | 2;
	file: string;
	pageUrl: string;
	ollama?: { model: string; responseFile: string };
	expected: ExpectedRecipe[];
}

interface FixtureManifest {
	version: string;
	promptVersion: string;
	fixtures: ExtractionFixture[];
}

interface AggregationPair {
	id: string;
	left: string;
	right: string;
	rule: string;
}

interface AggregationCorpus {
	safeMerges: AggregationPair[];
	unsafeMerges: AggregationPair[];
}

interface CountMetric {
	matched: number;
	total: number;
	rate: number;
}

interface TierMetrics {
	fixtures: number;
	recipes: number;
	ingredientRecall: CountMetric;
	quantityUnitFidelity: CountMetric;
	instructionFidelity: CountMetric;
}

interface MergeFailure extends AggregationPair {
	actualRules: string[];
}

export interface EvaluationReport {
	reportVersion: 1;
	gitCommit: string;
	fixtureVersion: string;
	rulesVersion: string;
	ollama: { models: string[]; promptVersion: string; promptFingerprint: string } | null;
	metrics: {
		tier1: TierMetrics;
		tier2: TierMetrics;
		schemaValidity: CountMetric;
		hallucinatedFields: CountMetric;
		falseMerges: CountMetric;
		safeMergeRecall: CountMetric;
	};
	hallucinatedFieldDetails: string[];
	quantityUnitMismatchDetails: string[];
	falseMergeDetails: MergeFailure[];
	missedSafeMergeDetails: MergeFailure[];
	gates: Record<keyof typeof EXIT_GATES, { threshold: number; actual: number; passed: boolean }>;
	passed: boolean;
}

interface MutableTier {
	fixtures: number;
	recipes: number;
	ingredientsMatched: number;
	ingredientsTotal: number;
	quantityUnitMatched: number;
	quantityUnitTotal: number;
	instructionsMatched: number;
	instructionsTotal: number;
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

function normalized(value: string): string {
	return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function sameNumber(actual: number | null, expected: number | null): boolean {
	return actual === expected || (actual != null && expected != null && Math.abs(actual - expected) < 1e-9);
}

function metric(matched: number, total: number): CountMetric {
	return { matched, total, rate: total === 0 ? 1 : matched / total };
}

function promptFingerprint(): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < OLLAMA_RECIPE_EXTRACTION_PROMPT.length; index++) {
		hash ^= OLLAMA_RECIPE_EXTRACTION_PROMPT.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

function ensureDomParser(): void {
	if (typeof globalThis.DOMParser === "undefined") {
		globalThis.DOMParser = new JSDOM("").window.DOMParser;
	}
}

function recordedOllamaFetch(response: unknown): typeof fetch {
	return (async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.endsWith("/api/tags")) {
			return new Response(JSON.stringify({ models: [] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		if (url.endsWith("/api/chat")) {
			return new Response(JSON.stringify({ message: { content: JSON.stringify(response) } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}
		return new Response("not found", { status: 404 });
	}) as typeof fetch;
}

function extractionCandidates(result: Awaited<ReturnType<typeof extractRecipeFromPage>>): ExtractionCandidate[] {
	if (result.status === "extracted") {
		return result.candidates;
	}
	if (result.status === "needs-selection") {
		return result.candidates;
	}
	return [];
}

function populatedScalar(value: unknown): boolean {
	return value !== null && value !== undefined && value !== "";
}

function evaluateRecipe(
	fixtureId: string,
	recipeIndex: number,
	actual: ExtractionCandidate | undefined,
	expected: ExpectedRecipe,
	tier: MutableTier,
	hallucinations: string[],
	quantityUnitMismatches: string[],
): { schemaValid: boolean; outputFields: number } {
	tier.recipes++;
	tier.ingredientsTotal += expected.ingredients.length;
	tier.quantityUnitTotal += expected.ingredients.length;
	tier.instructionsTotal += expected.instructions.length;
	if (!actual) {
		return { schemaValid: false, outputFields: 0 };
	}

	const actualIngredientMap = new Map(actual.ingredients.map((item) => [normalized(item.raw), item]));
	const expectedIngredientKeys = new Set(expected.ingredients.map((item) => normalized(item.raw)));
	for (const ingredient of expected.ingredients) {
		const found = actualIngredientMap.get(normalized(ingredient.raw));
		if (found) {
			tier.ingredientsMatched++;
			const quantityMax = ingredient.quantityMax ?? null;
			if (
				sameNumber(found.quantity, ingredient.quantity) &&
				sameNumber(found.quantityMax, quantityMax) &&
				normalized(found.unit ?? "") === normalized(ingredient.unit ?? "")
			) {
				tier.quantityUnitMatched++;
			} else {
				quantityUnitMismatches.push(
					`${fixtureId} recipe ${recipeIndex + 1}: '${ingredient.raw}' expected quantity=${ingredient.quantity}, quantityMax=${quantityMax}, unit=${ingredient.unit}; observed quantity=${found.quantity}, quantityMax=${found.quantityMax}, unit=${found.unit}`,
				);
			}
		}
	}
	for (const ingredient of actual.ingredients) {
		if (!expectedIngredientKeys.has(normalized(ingredient.raw))) {
			hallucinations.push(`${fixtureId} recipe ${recipeIndex + 1}: ingredient '${ingredient.raw}'`);
		}
	}

	const expectedInstructions = new Set(expected.instructions.map(normalized));
	const actualInstructions = new Set(actual.instructions.map(normalized));
	for (const instruction of expectedInstructions) {
		if (actualInstructions.has(instruction)) {
			tier.instructionsMatched++;
		}
	}
	for (const instruction of actual.instructions) {
		if (!expectedInstructions.has(normalized(instruction))) {
			hallucinations.push(`${fixtureId} recipe ${recipeIndex + 1}: instruction '${instruction}'`);
		}
	}

	const scalarChecks: Array<[string, unknown, unknown]> = [
		["title", actual.title, expected.title],
		["servingsRaw", actual.servings?.raw ?? null, expected.servingsRaw],
		["prepTimeMinutes", actual.prepTimeMinutes, expected.prepTimeMinutes],
		["cookTimeMinutes", actual.cookTimeMinutes, expected.cookTimeMinutes],
		["totalTimeMinutes", actual.totalTimeMinutes, expected.totalTimeMinutes],
		["author", actual.attribution.author, expected.author],
		["siteName", actual.attribution.siteName, expected.siteName],
	];
	for (const [name, actualValue, expectedValue] of scalarChecks) {
		if (populatedScalar(actualValue) && actualValue !== expectedValue) {
			hallucinations.push(`${fixtureId} recipe ${recipeIndex + 1}: ${name}=${JSON.stringify(actualValue)}`);
		}
	}
	const expectedMethods = new Set(expected.cookingMethods.map(normalized));
	for (const method of actual.cookingMethods) {
		if (!expectedMethods.has(normalized(method))) {
			hallucinations.push(`${fixtureId} recipe ${recipeIndex + 1}: cookingMethod '${method}'`);
		}
	}
	const outputFields =
		actual.ingredients.length +
		actual.instructions.length +
		actual.cookingMethods.length +
		scalarChecks.filter(([, value]) => populatedScalar(value)).length;
	return {
		schemaValid: recipeFrontmatterSchema.safeParse(actual.draft.frontmatter).success,
		outputFields,
	};
}

function finalizedTier(value: MutableTier): TierMetrics {
	return {
		fixtures: value.fixtures,
		recipes: value.recipes,
		ingredientRecall: metric(value.ingredientsMatched, value.ingredientsTotal),
		quantityUnitFidelity: metric(value.quantityUnitMatched, value.quantityUnitTotal),
		instructionFidelity: metric(value.instructionsMatched, value.instructionsTotal),
	};
}

function evaluatePair(pair: AggregationPair) {
	return aggregateIngredients([
		{ recipeId: "fixture-left", ingredient: parseIngredientLine(pair.left) },
		{ recipeId: "fixture-right", ingredient: parseIngredientLine(pair.right) },
	]);
}

function gitCommit(): string {
	try {
		return execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: PROJECT_ROOT,
			encoding: "utf8",
		}).trim();
	} catch {
		return "unknown";
	}
}

export async function runEvaluation(): Promise<EvaluationReport> {
	ensureDomParser();
	const manifest = readJson<FixtureManifest>(resolve(FIXTURE_ROOT, "manifest.json"));
	const aggregation = readJson<AggregationCorpus>(resolve(FIXTURE_ROOT, "aggregation/pairs.json"));
	const mutable: Record<1 | 2, MutableTier> = {
		1: { fixtures: 0, recipes: 0, ingredientsMatched: 0, ingredientsTotal: 0, quantityUnitMatched: 0, quantityUnitTotal: 0, instructionsMatched: 0, instructionsTotal: 0 },
		2: { fixtures: 0, recipes: 0, ingredientsMatched: 0, ingredientsTotal: 0, quantityUnitMatched: 0, quantityUnitTotal: 0, instructionsMatched: 0, instructionsTotal: 0 },
	};
	const hallucinations: string[] = [];
	const quantityUnitMismatches: string[] = [];
	let schemaValid = 0;
	let schemaTotal = 0;
	let outputFields = 0;
	const models = new Set<string>();

	for (const fixture of manifest.fixtures) {
		mutable[fixture.tier].fixtures++;
		const html = readFileSync(resolve(FIXTURE_ROOT, fixture.file), "utf8");
		const recorded = fixture.ollama
			? readJson<unknown>(resolve(FIXTURE_ROOT, fixture.ollama.responseFile))
			: null;
		if (fixture.ollama) {
			models.add(fixture.ollama.model);
		}
		const result = await extractRecipeFromPage({
			html,
			pageUrl: fixture.pageUrl,
			now: () => FIXED_NOW,
			ollama: fixture.ollama
				? {
					endpoint: "http://127.0.0.1:11434",
					model: fixture.ollama.model,
					healthCheckMs: 100,
					timeoutMs: 100,
					fetchImpl: recordedOllamaFetch(recorded),
				}
				: null,
		});
		const candidates = extractionCandidates(result);
		for (let index = 0; index < fixture.expected.length; index++) {
			const evaluated = evaluateRecipe(
				fixture.id,
				index,
				candidates[index],
				fixture.expected[index],
				mutable[fixture.tier],
				hallucinations,
				quantityUnitMismatches,
			);
			schemaTotal++;
			schemaValid += Number(evaluated.schemaValid);
			outputFields += evaluated.outputFields;
		}
		for (let index = fixture.expected.length; index < candidates.length; index++) {
			hallucinations.push(`${fixture.id}: unexpected recipe candidate ${index + 1}`);
			outputFields++;
		}
	}

	const falseMergeDetails: MergeFailure[] = [];
	for (const pair of aggregation.unsafeMerges) {
		const result = evaluatePair(pair);
		if (result.some((row) => row.sourceRefs.length > 1)) {
			falseMergeDetails.push({ ...pair, actualRules: [...new Set(result.map((row) => row.mergeRuleId))] });
		}
	}
	const missedSafeMergeDetails: MergeFailure[] = [];
	for (const pair of aggregation.safeMerges) {
		const result = evaluatePair(pair);
		if (!result.some((row) => row.sourceRefs.length === 2)) {
			missedSafeMergeDetails.push({ ...pair, actualRules: [...new Set(result.map((row) => row.mergeRuleId))] });
		}
	}

	const tier1 = finalizedTier(mutable[1]);
	const tier2 = finalizedTier(mutable[2]);
	const metrics = {
		tier1,
		tier2,
		schemaValidity: metric(schemaValid, schemaTotal),
		hallucinatedFields: metric(hallucinations.length, outputFields),
		falseMerges: metric(falseMergeDetails.length, aggregation.unsafeMerges.length),
		safeMergeRecall: metric(aggregation.safeMerges.length - missedSafeMergeDetails.length, aggregation.safeMerges.length),
	};
	const actuals: Record<keyof typeof EXIT_GATES, number> = {
		schemaValidity: metrics.schemaValidity.rate,
		hallucinatedFieldRate: metrics.hallucinatedFields.rate,
		tier1IngredientRecall: tier1.ingredientRecall.rate,
		tier1QuantityUnitFidelity: tier1.quantityUnitFidelity.rate,
		tier2IngredientRecall: tier2.ingredientRecall.rate,
		tier2QuantityUnitFidelity: tier2.quantityUnitFidelity.rate,
		falseMergeRate: metrics.falseMerges.rate,
		safeMergeRecall: metrics.safeMergeRecall.rate,
	};
	const zeroIsBest = new Set<keyof typeof EXIT_GATES>(["hallucinatedFieldRate", "falseMergeRate"]);
	const gates = Object.fromEntries(
		(Object.keys(EXIT_GATES) as Array<keyof typeof EXIT_GATES>).map((name) => {
			const threshold = EXIT_GATES[name];
			const actual = actuals[name];
			return [name, { threshold, actual, passed: zeroIsBest.has(name) ? actual <= threshold : actual >= threshold }];
		}),
	) as EvaluationReport["gates"];
	return {
		reportVersion: 1,
		gitCommit: gitCommit(),
		fixtureVersion: manifest.version,
		rulesVersion: RULES_VERSION,
		ollama: models.size > 0
			? { models: [...models].sort(), promptVersion: manifest.promptVersion, promptFingerprint: promptFingerprint() }
			: null,
		metrics,
		hallucinatedFieldDetails: hallucinations,
		quantityUnitMismatchDetails: quantityUnitMismatches,
		falseMergeDetails,
		missedSafeMergeDetails,
		gates,
		passed: Object.values(gates).every((gate) => gate.passed),
	};
}

function percent(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}

function detailList(items: MergeFailure[]): string {
	if (items.length === 0) {
		return "- None.\n";
	}
	return items
		.map((item) => `- **${item.id}**: \`${item.left}\` + \`${item.right}\`; expected \`${item.rule}\`, observed ${item.actualRules.map((rule) => `\`${rule}\``).join(", ")}.`)
		.join("\n") + "\n";
}

export function renderMarkdown(report: EvaluationReport): string {
	const rows = (Object.entries(report.gates) as Array<[string, EvaluationReport["gates"][keyof typeof EXIT_GATES]]>)
		.map(([name, gate]) => `| ${name} | ${percent(gate.actual)} | ${percent(gate.threshold)} | ${gate.passed ? "PASS" : "FAIL"} |`)
		.join("\n");
	const tierRows = ([1, 2] as const).map((tier) => {
		const value = tier === 1 ? report.metrics.tier1 : report.metrics.tier2;
		return `| Tier ${tier} | ${value.fixtures} | ${value.recipes} | ${percent(value.ingredientRecall.rate)} (${value.ingredientRecall.matched}/${value.ingredientRecall.total}) | ${percent(value.quantityUnitFidelity.rate)} (${value.quantityUnitFidelity.matched}/${value.quantityUnitFidelity.total}) | ${percent(value.instructionFidelity.rate)} (${value.instructionFidelity.matched}/${value.instructionFidelity.total}) |`;
	}).join("\n");
	const hallucinations = report.hallucinatedFieldDetails.length === 0
		? "- None."
		: report.hallucinatedFieldDetails.map((item) => `- ${item}`).join("\n");
	const fidelityMismatches = report.quantityUnitMismatchDetails.length === 0
		? "- None."
		: report.quantityUnitMismatchDetails.map((item) => `- ${item}`).join("\n");
	return `# Phase 2 Baseline Evaluation Report

Overall result: **${report.passed ? "PASS" : "FAIL"}**

## Reproducibility metadata

- Git commit: \`${report.gitCommit}\`
- Fixture corpus: \`${report.fixtureVersion}\`
- Aggregation rules: \`${report.rulesVersion}\`
- Ollama model(s): ${report.ollama ? report.ollama.models.map((model) => `\`${model}\``).join(", ") : "not used"}
- Ollama prompt version: ${report.ollama ? `\`${report.ollama.promptVersion}\` (fingerprint \`${report.ollama.promptFingerprint}\`)` : "not used"}
- Evaluation mode: deterministic local fixtures; Ollama responses are recorded and network access is not used

## Exit gates

| Gate | Actual | Threshold | Result |
| --- | ---: | ---: | :---: |
${rows}

## Extraction fidelity

| Corpus | Fixtures | Recipes | Ingredient recall | Quantity/unit fidelity | Instruction fidelity |
| --- | ---: | ---: | ---: | ---: | ---: |
${tierRows}

Schema validity: ${percent(report.metrics.schemaValidity.rate)} (${report.metrics.schemaValidity.matched}/${report.metrics.schemaValidity.total}).

### Quantity/unit mismatches

${fidelityMismatches}

Hallucinated fields: ${report.metrics.hallucinatedFields.matched} across ${report.metrics.hallucinatedFields.total} evaluated output fields (${percent(report.metrics.hallucinatedFields.rate)}).

### Hallucinated field details

${hallucinations}

## Aggregation compatibility

False merges: ${report.falseMergeDetails.length}/${report.metrics.falseMerges.total} (${percent(report.metrics.falseMerges.rate)}).

Safe-merge recall: ${report.metrics.safeMergeRecall.matched}/${report.metrics.safeMergeRecall.total} (${percent(report.metrics.safeMergeRecall.rate)}).

### False merges

${detailList(report.falseMergeDetails)}
### Missed safe merges

${detailList(report.missedSafeMergeDetails)}
## Method

Recall uses normalized exact matching against hand-written ingredient lines and instruction steps. Quantity/unit fidelity requires the matched ingredient's parsed quantity, upper range bound, and typed unit to equal ground truth. Schema validity is established with the production Zod schema. Hallucinations are unexpected populated recipe fields, ingredients, instructions, cooking methods, or extra recipe candidates. Aggregation is evaluated by executing the production deterministic rules over labeled safe and unsafe pairs; no LLM judge is used.
`;
}

export function writeReports(report: EvaluationReport, reportRoot = DEFAULT_REPORT_ROOT): void {
	mkdirSync(reportRoot, { recursive: true });
	writeFileSync(resolve(reportRoot, "phase2-baseline-report.json"), `${JSON.stringify(report, null, 2)}\n`);
	writeFileSync(resolve(reportRoot, "phase2-baseline-report.md"), renderMarkdown(report));
}

async function main(): Promise<void> {
	const report = await runEvaluation();
	writeReports(report);
	process.stdout.write(`${renderMarkdown(report)}\n`);
	if (!report.passed) {
		process.exitCode = 1;
	}
}

if (process.argv.slice(1).some((argument) => argument.endsWith("tests/evals/runner.ts"))) {
	void main();
}
