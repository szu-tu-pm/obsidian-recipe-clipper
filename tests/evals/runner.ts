import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { JSDOM } from "jsdom";
import {
	aggregateIngredients,
	RULES_VERSION,
	type AggregatedIngredient,
} from "../../src/domain/aggregation/aggregator";
import { parseIngredientLine } from "../../src/domain/aggregation/stage1LexicalParser";
import { recipeFrontmatterSchema } from "../../src/domain/schema/recipeSchema";
import { OLLAMA_RECIPE_EXTRACTION_PROMPT } from "../../src/domain/extraction/ollamaExtractor";
import { extractRecipeFromPage } from "../../src/domain/extraction/urlClipper";
import type { ExtractionCandidate } from "../../src/domain/extraction/types";
import type { ExtractionMethod } from "../../src/domain/schema/recipeSchema";
import type { RecipeIngredient } from "../../src/domain/schema/recipeSchema";

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

export const MINIMUM_DENOMINATORS = {
	tier1Ingredients: 50,
	tier2Ingredients: 50,
	safeMergePairs: 50,
	unsafeMergePairs: 50,
} as const;

export const INGREDIENT_CATEGORIES = [
	"mixed-fraction",
	"unicode-fraction",
	"range",
	"dual-unit",
	"abbrev-period",
	"fl-oz",
	"unknown-unit",
	"non-numeric",
	"comma-prep",
	"simple",
] as const;

export type IngredientCategory = (typeof INGREDIENT_CATEGORIES)[number];

interface ExpectedIngredient {
	raw: string;
	quantity: number | null;
	quantityMax?: number | null;
	unit: string | null;
	category: IngredientCategory;
}

interface ExpectedRecipe {
	title: string;
	extractionMethod: Exclude<ExtractionMethod, "manual">;
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

export interface FixtureManifest {
	version: string;
	promptVersion: string;
	fixtures: ExtractionFixture[];
}

export interface AggregationPair {
	id: string;
	left: string;
	right: string;
}

export interface SafeAggregationPair extends AggregationPair {
	expectedQuantity: number;
	expectedQuantityMax: number | null;
	expectedUnit: string;
	expectedMergeRuleId: string;
}

export interface UnsafeAggregationPair extends AggregationPair {
	category: string;
	expectedMergeRuleId: string;
}

export interface AggregationCorpus {
	safeMerges: SafeAggregationPair[];
	unsafeMerges: UnsafeAggregationPair[];
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
	quantityUnitFidelityByCategory: Record<IngredientCategory, CountMetric>;
	instructionFidelity: CountMetric;
	extractionMethodFidelity: CountMetric;
	expectedScalarFidelity: CountMetric;
}

interface MergeFailure extends AggregationPair {
	expectedMergeRuleId: string;
	actualRules: string[];
}

interface WrongQuantityMerge extends SafeAggregationPair {
	actualQuantity: number | null;
	actualQuantityMax: number | null;
}

interface SafeMergeMismatch extends SafeAggregationPair {
	actualUnit: string | null;
	actualMergeRuleId: string;
}

interface CorpusMinimum {
	actual: number;
	minimum: number;
	passed: boolean;
}

export interface EvaluationReport {
	reportVersion: 2;
	gitCommit: string;
	workingTreeDirty: boolean | null;
	fixtureVersion: string;
	fixtureManifestSha256: string;
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
	missingExpectedScalarDetails: string[];
	extractionMethodMismatchDetails: string[];
	falseMergeDetails: MergeFailure[];
	missedSafeMergeDetails: MergeFailure[];
	wrongQuantityMergeDetails: WrongQuantityMerge[];
	incorrectSafeMergeDetails: SafeMergeMismatch[];
	unsafeMergeRuleMismatchDetails: MergeFailure[];
	corpusMinimums: Record<keyof typeof MINIMUM_DENOMINATORS, CorpusMinimum>;
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
	quantityUnitByCategory: Record<IngredientCategory, { matched: number; total: number }>;
	instructionsMatched: number;
	instructionsTotal: number;
	methodsMatched: number;
	methodsTotal: number;
	expectedScalarsMatched: number;
	expectedScalarsTotal: number;
}

export interface EvaluationOptions {
	aggregationCorpus?: AggregationCorpus;
	aggregatePair?: (pair: AggregationPair) => AggregatedIngredient[];
	transformCandidates?: (fixtureId: string, candidates: ExtractionCandidate[]) => ExtractionCandidate[];
	parseIngredient?: (raw: string) => RecipeIngredient;
	git?: {
		cwd?: string;
		execFile?: (file: string, args: string[], options: { cwd: string; encoding: "utf8" }) => string;
	};
}

function emptyCategoryCounts(): Record<IngredientCategory, { matched: number; total: number }> {
	return Object.fromEntries(
		INGREDIENT_CATEGORIES.map((category) => [category, { matched: 0, total: 0 }]),
	) as Record<IngredientCategory, { matched: number; total: number }>;
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

function normalized(value: string): string {
	return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizedUnit(value: string): string {
	return value.toLowerCase().replace(/\.$/, "");
}

function sameNumber(actual: number | null, expected: number | null): boolean {
	return actual === expected || (actual != null && expected != null && Math.abs(actual - expected) < 1e-9);
}

export function metric(matched: number, total: number): CountMetric {
	return { matched, total, rate: total === 0 ? 0 : matched / total };
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
	missingExpectedScalars: string[],
	extractionMethodMismatches: string[],
): { schemaValid: boolean; outputFields: number } {
	tier.recipes++;
	tier.ingredientsTotal += expected.ingredients.length;
	tier.quantityUnitTotal += expected.ingredients.length;
	for (const ingredient of expected.ingredients) {
		tier.quantityUnitByCategory[ingredient.category].total++;
	}
	tier.instructionsTotal += expected.instructions.length;
	tier.methodsTotal++;
	if (!actual) {
		extractionMethodMismatches.push(`${fixtureId} recipe ${recipeIndex + 1}: no candidate was extracted`);
		for (const [name, value] of expectedScalarEntries(expected)) {
			if (populatedScalar(value)) {
				tier.expectedScalarsTotal++;
				missingExpectedScalars.push(`${fixtureId} recipe ${recipeIndex + 1}: missing ${name}`);
			}
		}
		return { schemaValid: false, outputFields: 0 };
	}
	if (actual.extractionMethod === expected.extractionMethod) {
		tier.methodsMatched++;
	} else {
		extractionMethodMismatches.push(
			`${fixtureId} recipe ${recipeIndex + 1}: expected ${expected.extractionMethod}, observed ${actual.extractionMethod}`,
		);
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
				normalizedUnit(found.unit ?? "") === normalizedUnit(ingredient.unit ?? "")
			) {
				tier.quantityUnitMatched++;
				tier.quantityUnitByCategory[ingredient.category].matched++;
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
		if (populatedScalar(expectedValue)) {
			tier.expectedScalarsTotal++;
			if (actualValue === expectedValue) {
				tier.expectedScalarsMatched++;
			} else if (!populatedScalar(actualValue)) {
				missingExpectedScalars.push(`${fixtureId} recipe ${recipeIndex + 1}: missing ${name}`);
			}
		}
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

function expectedScalarEntries(expected: ExpectedRecipe): Array<[string, unknown]> {
	return [
		["title", expected.title],
		["servingsRaw", expected.servingsRaw],
		["prepTimeMinutes", expected.prepTimeMinutes],
		["cookTimeMinutes", expected.cookTimeMinutes],
		["totalTimeMinutes", expected.totalTimeMinutes],
		["author", expected.author],
		["siteName", expected.siteName],
	];
}

function finalizedTier(value: MutableTier): TierMetrics {
	return {
		fixtures: value.fixtures,
		recipes: value.recipes,
		ingredientRecall: metric(value.ingredientsMatched, value.ingredientsTotal),
		quantityUnitFidelity: metric(value.quantityUnitMatched, value.quantityUnitTotal),
		quantityUnitFidelityByCategory: Object.fromEntries(
			INGREDIENT_CATEGORIES.map((category) => {
				const counts = value.quantityUnitByCategory[category];
				return [category, metric(counts.matched, counts.total)];
			}),
		) as Record<IngredientCategory, CountMetric>,
		instructionFidelity: metric(value.instructionsMatched, value.instructionsTotal),
		extractionMethodFidelity: metric(value.methodsMatched, value.methodsTotal),
		expectedScalarFidelity: metric(value.expectedScalarsMatched, value.expectedScalarsTotal),
	};
}

function evaluatePair(pair: AggregationPair) {
	return aggregateIngredients([
		{ recipeId: "fixture-left", ingredient: parseIngredientLine(pair.left) },
		{ recipeId: "fixture-right", ingredient: parseIngredientLine(pair.right) },
	]);
}

function gitCommit(git: EvaluationOptions["git"]): string {
	try {
		const exec = git?.execFile ?? (execFileSync as unknown as NonNullable<EvaluationOptions["git"]>["execFile"]);
		return exec("git", ["rev-parse", "HEAD"], {
			cwd: git?.cwd ?? PROJECT_ROOT,
			encoding: "utf8",
		}).trim();
	} catch {
		return "unknown";
	}
}

function workingTreeDirty(git: EvaluationOptions["git"]): boolean | null {
	try {
		const exec = git?.execFile ?? (execFileSync as unknown as NonNullable<EvaluationOptions["git"]>["execFile"]);
		return exec("git", ["status", "--porcelain"], {
			cwd: git?.cwd ?? PROJECT_ROOT,
			encoding: "utf8",
		}).trim().length > 0;
	} catch {
		return null;
	}
}

function withInjectedParser(
	candidates: ExtractionCandidate[],
	parser: EvaluationOptions["parseIngredient"],
): ExtractionCandidate[] {
	if (!parser) {
		return candidates;
	}
	return candidates.map((candidate) => {
		const ingredients = candidate.ingredientsRaw.map(parser);
		return {
			...candidate,
			ingredients,
			draft: {
				...candidate.draft,
				frontmatter: { ...candidate.draft.frontmatter, ingredients },
			},
		};
	});
}

function matchCandidates(
	expectedRecipes: ExpectedRecipe[],
	candidates: ExtractionCandidate[],
): Array<ExtractionCandidate | undefined> {
	const remaining = new Set(candidates.map((_, index) => index));
	return expectedRecipes.map((expected) => {
		let bestIndex: number | undefined;
		let bestScore = 0;
		const expectedIngredients = new Set(expected.ingredients.map((item) => normalized(item.raw)));
		for (const index of remaining) {
			const candidate = candidates[index];
			const titleScore = normalized(candidate.title) === normalized(expected.title) ? 1000 : 0;
			const ingredientScore = candidate.ingredients.reduce(
				(score, item) => score + Number(expectedIngredients.has(normalized(item.raw))),
				0,
			);
			const score = titleScore + ingredientScore;
			if (score > bestScore) {
				bestScore = score;
				bestIndex = index;
			}
		}
		if (bestIndex === undefined) {
			return undefined;
		}
		remaining.delete(bestIndex);
		return candidates[bestIndex];
	});
}

export async function runEvaluation(options: EvaluationOptions = {}): Promise<EvaluationReport> {
	ensureDomParser();
	const manifestPath = resolve(FIXTURE_ROOT, "manifest.json");
	const manifestText = readFileSync(manifestPath, "utf8").replace(/\r\n/g, "\n");
	const manifest = JSON.parse(manifestText) as FixtureManifest;
	const aggregation = options.aggregationCorpus ?? readJson<AggregationCorpus>(resolve(FIXTURE_ROOT, "aggregation/pairs.json"));
	const pairEvaluator = options.aggregatePair ?? evaluatePair;
	const mutable: Record<1 | 2, MutableTier> = {
		1: { fixtures: 0, recipes: 0, ingredientsMatched: 0, ingredientsTotal: 0, quantityUnitMatched: 0, quantityUnitTotal: 0, quantityUnitByCategory: emptyCategoryCounts(), instructionsMatched: 0, instructionsTotal: 0, methodsMatched: 0, methodsTotal: 0, expectedScalarsMatched: 0, expectedScalarsTotal: 0 },
		2: { fixtures: 0, recipes: 0, ingredientsMatched: 0, ingredientsTotal: 0, quantityUnitMatched: 0, quantityUnitTotal: 0, quantityUnitByCategory: emptyCategoryCounts(), instructionsMatched: 0, instructionsTotal: 0, methodsMatched: 0, methodsTotal: 0, expectedScalarsMatched: 0, expectedScalarsTotal: 0 },
	};
	const hallucinations: string[] = [];
	const quantityUnitMismatches: string[] = [];
	const missingExpectedScalars: string[] = [];
	const extractionMethodMismatches: string[] = [];
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
		const extractedCandidates = withInjectedParser(extractionCandidates(result), options.parseIngredient);
		const candidates = options.transformCandidates
			? options.transformCandidates(fixture.id, extractedCandidates)
			: extractedCandidates;
		const matchedCandidates = matchCandidates(fixture.expected, candidates);
		for (let index = 0; index < fixture.expected.length; index++) {
			const evaluated = evaluateRecipe(
				fixture.id,
				index,
				matchedCandidates[index],
				fixture.expected[index],
				mutable[fixture.tier],
				hallucinations,
				quantityUnitMismatches,
				missingExpectedScalars,
				extractionMethodMismatches,
			);
			schemaTotal++;
			schemaValid += Number(evaluated.schemaValid);
			outputFields += evaluated.outputFields;
		}
		const matched = new Set(matchedCandidates.filter((candidate) => candidate != null));
		for (let index = 0; index < candidates.length; index++) {
			if (matched.has(candidates[index])) {
				continue;
			}
			hallucinations.push(`${fixture.id}: unexpected recipe candidate ${index + 1}`);
			outputFields++;
		}
	}

	const falseMergeDetails: MergeFailure[] = [];
	const unsafeMergeRuleMismatchDetails: MergeFailure[] = [];
	for (const pair of aggregation.unsafeMerges) {
		const result = pairEvaluator(pair);
		const actualRules = [...new Set(result.map((row) => row.mergeRuleId))];
		if (result.some((row) => row.sourceRefs.length > 1)) {
			falseMergeDetails.push({ ...pair, actualRules });
		}
		if (actualRules.some((rule) => rule !== pair.expectedMergeRuleId)) {
			unsafeMergeRuleMismatchDetails.push({ ...pair, actualRules });
		}
	}
	const missedSafeMergeDetails: MergeFailure[] = [];
	const wrongQuantityMergeDetails: WrongQuantityMerge[] = [];
	const incorrectSafeMergeDetails: SafeMergeMismatch[] = [];
	let correctSafeMerges = 0;
	for (const pair of aggregation.safeMerges) {
		const result = pairEvaluator(pair);
		const merged = result.find((row) => row.sourceRefs.length === 2);
		if (!merged) {
			missedSafeMergeDetails.push({ ...pair, actualRules: [...new Set(result.map((row) => row.mergeRuleId))] });
			continue;
		}
		const quantityMatches = sameNumber(merged.quantity, pair.expectedQuantity) &&
			sameNumber(merged.quantityMax, pair.expectedQuantityMax);
		if (!quantityMatches) {
			wrongQuantityMergeDetails.push({
				...pair,
				actualQuantity: merged.quantity,
				actualQuantityMax: merged.quantityMax,
			});
		}
		const semanticsMatch = merged.unit === pair.expectedUnit &&
			merged.mergeRuleId === pair.expectedMergeRuleId;
		if (!semanticsMatch) {
			incorrectSafeMergeDetails.push({
				...pair,
				actualUnit: merged.unit,
				actualMergeRuleId: merged.mergeRuleId,
			});
		}
		if (quantityMatches && semanticsMatch) {
			correctSafeMerges++;
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
		safeMergeRecall: metric(correctSafeMerges, aggregation.safeMerges.length),
	};
	const corpusMinimums: EvaluationReport["corpusMinimums"] = {
		tier1Ingredients: minimum(mutable[1].ingredientsTotal, MINIMUM_DENOMINATORS.tier1Ingredients),
		tier2Ingredients: minimum(mutable[2].ingredientsTotal, MINIMUM_DENOMINATORS.tier2Ingredients),
		safeMergePairs: minimum(aggregation.safeMerges.length, MINIMUM_DENOMINATORS.safeMergePairs),
		unsafeMergePairs: minimum(aggregation.unsafeMerges.length, MINIMUM_DENOMINATORS.unsafeMergePairs),
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
			let denominatorPassed = true;
			if (name.startsWith("tier1")) denominatorPassed = corpusMinimums.tier1Ingredients.passed;
			if (name.startsWith("tier2")) denominatorPassed = corpusMinimums.tier2Ingredients.passed;
			if (name === "falseMergeRate") denominatorPassed = corpusMinimums.unsafeMergePairs.passed;
			if (name === "safeMergeRecall") denominatorPassed = corpusMinimums.safeMergePairs.passed;
			const thresholdPassed = zeroIsBest.has(name) ? actual <= threshold : actual >= threshold;
			return [name, { threshold, actual, passed: thresholdPassed && denominatorPassed }];
		}),
	) as EvaluationReport["gates"];
	return {
		reportVersion: 2,
		gitCommit: gitCommit(options.git),
		workingTreeDirty: workingTreeDirty(options.git),
		fixtureVersion: manifest.version,
		fixtureManifestSha256: createHash("sha256").update(manifestText).digest("hex"),
		rulesVersion: RULES_VERSION,
		ollama: models.size > 0
			? { models: [...models].sort(), promptVersion: manifest.promptVersion, promptFingerprint: promptFingerprint() }
			: null,
		metrics,
		hallucinatedFieldDetails: hallucinations,
		quantityUnitMismatchDetails: quantityUnitMismatches,
		missingExpectedScalarDetails: missingExpectedScalars,
		extractionMethodMismatchDetails: extractionMethodMismatches,
		falseMergeDetails,
		missedSafeMergeDetails,
		wrongQuantityMergeDetails,
		incorrectSafeMergeDetails,
		unsafeMergeRuleMismatchDetails,
		corpusMinimums,
		gates,
		passed: Object.values(gates).every((gate) => gate.passed) &&
			Object.values(corpusMinimums).every((floor) => floor.passed) &&
			unsafeMergeRuleMismatchDetails.length === 0 &&
			wrongQuantityMergeDetails.length === 0 &&
			incorrectSafeMergeDetails.length === 0,
	};
}

function minimum(actual: number, minimumValue: number): CorpusMinimum {
	return { actual, minimum: minimumValue, passed: actual >= minimumValue };
}

function percent(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}

function detailList(items: MergeFailure[]): string {
	if (items.length === 0) {
		return "- None.\n";
	}
	return items
		.map((item) => `- **${item.id}**: \`${item.left}\` + \`${item.right}\`; expected \`${item.expectedMergeRuleId}\`, observed ${item.actualRules.map((rule) => `\`${rule}\``).join(", ")}.`)
		.join("\n") + "\n";
}

function textDetails(items: string[]): string {
	return items.length === 0 ? "- None." : items.map((item) => `- ${item}`).join("\n");
}

export function renderMarkdown(report: EvaluationReport): string {
	const rows = (Object.entries(report.gates) as Array<[string, EvaluationReport["gates"][keyof typeof EXIT_GATES]]>)
		.map(([name, gate]) => `| ${name} | ${percent(gate.actual)} | ${percent(gate.threshold)} | ${gate.passed ? "PASS" : "FAIL"} |`)
		.join("\n");
	const tierRows = ([1, 2] as const).map((tier) => {
		const value = tier === 1 ? report.metrics.tier1 : report.metrics.tier2;
		return `| Tier ${tier} | ${value.fixtures} | ${value.recipes} | ${percent(value.ingredientRecall.rate)} (${value.ingredientRecall.matched}/${value.ingredientRecall.total}) | ${percent(value.quantityUnitFidelity.rate)} (${value.quantityUnitFidelity.matched}/${value.quantityUnitFidelity.total}) | ${percent(value.instructionFidelity.rate)} (${value.instructionFidelity.matched}/${value.instructionFidelity.total}) |`;
	}).join("\n");
	const categoryRows = INGREDIENT_CATEGORIES.map((category) => {
		const tier1 = report.metrics.tier1.quantityUnitFidelityByCategory[category];
		const tier2 = report.metrics.tier2.quantityUnitFidelityByCategory[category];
		return `| ${category} | ${percent(tier1.rate)} (${tier1.matched}/${tier1.total}) | ${percent(tier2.rate)} (${tier2.matched}/${tier2.total}) |`;
	}).join("\n");
	const floors = Object.entries(report.corpusMinimums)
		.map(([name, floor]) => `| ${name} | ${floor.actual} | ${floor.minimum} | ${floor.passed ? "PASS" : "FAIL"} |`)
		.join("\n");
	const wrongQuantities = report.wrongQuantityMergeDetails.length === 0
		? "- None."
		: report.wrongQuantityMergeDetails.map((item) =>
			`- **${item.id}**: expected quantity ${item.expectedQuantity}, quantityMax ${item.expectedQuantityMax}; observed ${item.actualQuantity}, quantityMax ${item.actualQuantityMax}.`,
		).join("\n");
	const incorrectSafe = report.incorrectSafeMergeDetails.length === 0
		? "- None."
		: report.incorrectSafeMergeDetails.map((item) =>
			`- **${item.id}**: expected unit \`${item.expectedUnit}\` and rule \`${item.expectedMergeRuleId}\`; observed unit \`${item.actualUnit}\` and rule \`${item.actualMergeRuleId}\`.`,
		).join("\n");
	return `# Phase 2 Baseline Evaluation Report

Overall result: **${report.passed ? "PASS" : "FAIL"}**

## Reproducibility metadata

- Git commit: \`${report.gitCommit}\`
- Working tree dirty: \`${report.workingTreeDirty ?? "unknown"}\`
- Fixture corpus: \`${report.fixtureVersion}\`
- Fixture manifest SHA-256: \`${report.fixtureManifestSha256}\`
- Aggregation rules: \`${report.rulesVersion}\`
- Ollama model(s): ${report.ollama ? report.ollama.models.map((model) => `\`${model}\``).join(", ") : "not used"}
- Ollama prompt version: ${report.ollama ? `\`${report.ollama.promptVersion}\` (fingerprint \`${report.ollama.promptFingerprint}\`)` : "not used"}
- Evaluation mode: deterministic local fixtures; Ollama responses are recorded and network access is not used

## Exit gates

| Gate | Actual | Threshold | Result |
| --- | ---: | ---: | :---: |
${rows}

## Corpus denominator floors

| Corpus | Actual | Minimum | Result |
| --- | ---: | ---: | :---: |
${floors}

## Extraction fidelity

| Corpus | Fixtures | Recipes | Ingredient recall | Quantity/unit fidelity | Instruction fidelity |
| --- | ---: | ---: | ---: | ---: | ---: |
${tierRows}

### Quantity/unit fidelity by ingredient category

| Category | Tier 1 | Tier 2 |
| --- | ---: | ---: |
${categoryRows}

Schema validity: ${percent(report.metrics.schemaValidity.rate)} (${report.metrics.schemaValidity.matched}/${report.metrics.schemaValidity.total}).

Extraction-method fidelity: Tier 1 ${percent(report.metrics.tier1.extractionMethodFidelity.rate)} (${report.metrics.tier1.extractionMethodFidelity.matched}/${report.metrics.tier1.extractionMethodFidelity.total}); Tier 2 ${percent(report.metrics.tier2.extractionMethodFidelity.rate)} (${report.metrics.tier2.extractionMethodFidelity.matched}/${report.metrics.tier2.extractionMethodFidelity.total}).

Expected-scalar fidelity: Tier 1 ${percent(report.metrics.tier1.expectedScalarFidelity.rate)} (${report.metrics.tier1.expectedScalarFidelity.matched}/${report.metrics.tier1.expectedScalarFidelity.total}); Tier 2 ${percent(report.metrics.tier2.expectedScalarFidelity.rate)} (${report.metrics.tier2.expectedScalarFidelity.matched}/${report.metrics.tier2.expectedScalarFidelity.total}).

### Quantity/unit mismatches

${textDetails(report.quantityUnitMismatchDetails)}

### Missing expected scalar fields

${textDetails(report.missingExpectedScalarDetails)}

### Extraction-method mismatches

${textDetails(report.extractionMethodMismatchDetails)}

Hallucinated fields: ${report.metrics.hallucinatedFields.matched} across ${report.metrics.hallucinatedFields.total} evaluated output fields (${percent(report.metrics.hallucinatedFields.rate)}).

### Hallucinated field details

${textDetails(report.hallucinatedFieldDetails)}

## Aggregation compatibility

False merges: ${report.falseMergeDetails.length}/${report.metrics.falseMerges.total} (${percent(report.metrics.falseMerges.rate)}).

Safe-merge recall: ${report.metrics.safeMergeRecall.matched}/${report.metrics.safeMergeRecall.total} (${percent(report.metrics.safeMergeRecall.rate)}).

### False merges

${detailList(report.falseMergeDetails)}
### Missed safe merges

${detailList(report.missedSafeMergeDetails)}
### Wrong-quantity safe merges

${wrongQuantities}

### Incorrect-unit or rule safe merges

${incorrectSafe}

### Unsafe-pair rule mismatches

${detailList(report.unsafeMergeRuleMismatchDetails)}
## Known gaps

${textDetails(report.quantityUnitMismatchDetails)}

## Method

Candidates are paired to hand-written ground truth by title and ingredient overlap rather than array position. Recall uses normalized exact matching against hand-written ingredient lines and instruction steps. Quantity/unit fidelity requires the matched ingredient's parsed quantity, upper range bound, and typed unit to equal ground truth. Unit comparison is case-insensitive. Trailing periods are ignored. Schema validity is established with the production Zod schema. Hallucinations are unexpected populated recipe fields, ingredients, instructions, cooking methods, or extra recipe candidates; missing expected scalar fields are reported separately. A safe aggregation pair is correct only when the canonical quantity, upper range bound, canonical unit, and merge rule all match hand-written ground truth. No LLM judge is used.

The commit recorded is the parent of the commit that adds this report.
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

if (
	process.argv
		.slice(1)
		.some((argument) => argument.replace(/\\/g, "/").endsWith("tests/evals/runner.ts"))
) {
	void main();
}
