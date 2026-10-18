// @vitest-environment jsdom

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { cpus, platform, release } from "node:os";
import { join } from "node:path";
import { tmpdir } from "node:os";
import builtins from "builtin-modules";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { MetadataCache, TFile, Vault } from "obsidian";
import { aggregateIngredients, RULES_VERSION, type AggregateSource } from "../../src/domain/aggregation/aggregator";
import { parseIngredientLine } from "../../src/domain/aggregation/stage1LexicalParser";
import { extractRecipeFromPage } from "../../src/domain/extraction/urlClipper";
import type { UrlExtractionResult } from "../../src/domain/extraction/types";
import { MAX_HTML_CHARS } from "../../src/domain/extraction/untrustedHtml";
import { serializeRecipeFile } from "../../src/domain/schema/recipeMarkdown";
import {
	recipeFrontmatterSchema,
	type RecipeDocument,
} from "../../src/domain/schema/recipeSchema";
import { createShoppingListFromRecipes } from "../../src/domain/schema/shoppingListSchema";
import { InMemoryVault, jsonYamlCodec } from "../../src/domain/vault/inMemoryVault";
import { RecipeIndexer, type RecipeIndexEntry } from "../../src/domain/vault/recipeIndexer";
import { ShoppingListRepository } from "../../src/domain/vault/shoppingListRepository";
import type { FrontmatterCachePort } from "../../src/domain/vault/vaultPort";
import { filterRecipes, type RatingFilter } from "../../src/ui/filterRecipes";

const SEED = 0x5eedc0de;
const NOW = "2026-10-17T12:00:00.000Z";
const RECIPES_FOLDER = "Recipes";
const ATTACHMENTS_FOLDER = "Recipes/_attachments";
const LISTS_FOLDER = "Shopping Lists";
const MALFORMED_COUNT = 3;
const ATTACHMENT_MARKDOWN_COUNT = 3;
const BUNDLE_BUDGET_BYTES = 500 * 1024;
const HEAVY_RUNS = 5;

type VaultSize = 500 | 2500;

interface Distribution {
	n: number;
	median: number;
	p95: number;
	max: number;
}

interface GateResult {
	name: string;
	statistic: "median" | "p95" | "max" | "value";
	value: number;
	budgetMs: number;
	pass: boolean;
}

interface ReportRow extends Distribution {
	name: string;
	unit: "ms" | "KiB";
	budget: number | null;
	gatedStatistic: GateResult["statistic"] | "informational";
	gatedValue: number | null;
	pass: boolean | null;
}

interface SyntheticVault {
	size: VaultSize;
	listCount: number;
	vault: InMemoryVault;
	metadataVault: Vault;
	metadataCache: MetadataCache;
	recipes: RecipeDocument[];
	frontmatterByPath: Map<string, Record<string, unknown> | null>;
	markdownFiles: TFile[];
	commonMatchCount: number;
	rareMatchCount: number;
}

interface ExtractionCase {
	name: string;
	html: string;
	expectedStatus: UrlExtractionResult["status"];
	expectedIngredientCount: number;
}

type CreateObsidianFrontmatterCache = (
	vault: Vault,
	metadataCache: MetadataCache,
	attachmentsFolder: string,
) => FrontmatterCachePort;

async function loadEsbuild() {
	// jsdom installs a TextEncoder from another realm, which violates esbuild's Uint8Array check.
	globalThis.TextEncoder = class TextEncoder {
		encode(input = ""): Uint8Array {
			return new Uint8Array(Buffer.from(input));
		}
	} as typeof globalThis.TextEncoder;
	return import("esbuild");
}

class Mulberry32 {
	constructor(private state: number) {}

	next(): number {
		let value = (this.state += 0x6d2b79f5);
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	}

	int(maxExclusive: number): number {
		return Math.floor(this.next() * maxExclusive);
	}
}

function deterministicId(prefix: "rec" | "ing" | "list" | "sli", value: number): string {
	const reversedDecimal = [...String(value).padStart(12, "0")].reverse().join("");
	return `${prefix}_${reversedDecimal}${"0".repeat(14)}`;
}

function titleFor(index: number): string {
	if (index % 10 === 0) {
		return `Pantry Benchmark Bowl ${String(index).padStart(4, "0")}`;
	}
	if (index % 137 === 0) {
		return `SaffronQuasar Special ${String(index).padStart(4, "0")}`;
	}
	if (index % 11 === 0) {
		return `A deliberately long recipe title for weeknight cooking with seasonal vegetables number ${index}`;
	}
	if (index % 7 === 0) {
		return `Crème brûlée 東京 ${index}`;
	}
	return `Seeded Supper ${String(index).padStart(4, "0")}`;
}

const INGREDIENT_POOL = [
	"1 cup all-purpose flour",
	"120 g all-purpose flour",
	"2 tbsp olive oil",
	"30 ml olive oil",
	"½ tsp kosher salt",
	"salt to taste",
	"1-2 cups chicken broth",
	"3 cloves garlic, minced",
	"2 (14 oz) cans tomatoes, drained",
	"250 ml whole milk",
	"1 1/2 cups brown sugar",
	"¾ lb boneless chicken thighs, diced",
	"2 kg russet potatoes, peeled",
	"1 bunch scallions, thinly sliced",
	"pepper as needed",
	"4 large eggs, beaten",
	"8 oz cheddar cheese, grated",
	"1 tsp smoked paprika",
	"2 tablespoons soy sauce",
	"a pinch saffron",
	"5–7 carrots, chopped",
	"1 stick unsalted butter, softened",
	"400 g chickpeas, rinsed",
	"¼ cup lemon juice",
	"6 count tortillas, warmed",
] as const;

function ingredientCountFor(index: number, random: Mulberry32): number {
	if (index < 15) {
		return index < 10 ? 13 : 14;
	}
	return 5 + random.int(21);
}

function makeRecipe(index: number, random: Mulberry32): RecipeDocument {
	const count = ingredientCountFor(index, random);
	const ingredients = Array.from({ length: count }, (_, ingredientIndex) => ({
		...parseIngredientLine(INGREDIENT_POOL[(index + ingredientIndex) % INGREDIENT_POOL.length]),
		id: deterministicId("ing", index * 100 + ingredientIndex + 1),
	}));
	const imageCount = index % 6;
	const frontmatter = recipeFrontmatterSchema.parse({
		schemaVersion: 2,
		type: "recipe",
		id: deterministicId("rec", index + 1),
		title: titleFor(index),
		sourceUrl: index % 3 === 0 ? null : `https://recipes.example.test/${index}`,
		author: index % 4 === 0 ? null : `Cook ${index % 17}`,
		siteName: index % 3 === 0 ? null : "Synthetic Kitchen",
		importedAt: NOW,
		updatedAt: NOW,
		extractionMethod: index % 2 === 0 ? "json-ld" : "manual",
		servings: { raw: String(2 + (index % 7)), amount: 2 + (index % 7) },
		prepTimeMinutes: index % 45,
		cookTimeMinutes: 10 + (index % 90),
		totalTimeMinutes: 10 + (index % 90) + (index % 45),
		cookingMethods: index % 2 === 0 ? ["stovetop"] : ["oven"],
		rating: ([1, 2, 3, 4, 5, null] as const)[index % 6],
		images: Array.from({ length: imageCount }, (_, imageIndex) => ({
			path: `${ATTACHMENTS_FOLDER}/recipe-${index}-${imageIndex}.webp`,
			alt: `Synthetic image ${imageIndex}`,
			sourceUrl: null,
			isPrimary: imageIndex === 0,
		})),
		ingredients,
	});
	return {
		frontmatter,
		instructions: ["Prepare the ingredients.", "Cook until done."],
		notes: `Seed ${SEED}; recipe ${index}.`,
		path: `${RECIPES_FOLDER}/recipe-${String(index).padStart(4, "0")}.md`,
		editedExternally: false,
	};
}

async function buildSyntheticVault(size: VaultSize, listCount: number): Promise<SyntheticVault> {
	const random = new Mulberry32(SEED);
	const vault = new InMemoryVault();
	const recipes: RecipeDocument[] = [];
	const frontmatterByPath = new Map<string, Record<string, unknown> | null>();
	const markdownFiles: TFile[] = [];

	const addMetadataFile = (path: string, frontmatter: Record<string, unknown> | null): void => {
		const file = { path } as TFile;
		markdownFiles.push(file);
		frontmatterByPath.set(path, frontmatter);
	};

	for (let index = 0; index < size; index++) {
		const recipe = makeRecipe(index, random);
		const path = recipe.path as string;
		await vault.write(path, serializeRecipeFile(recipe, jsonYamlCodec));
		recipes.push(recipe);
		addMetadataFile(path, recipe.frontmatter as unknown as Record<string, unknown>);
	}

	for (let index = 0; index < MALFORMED_COUNT; index++) {
		const path = `${RECIPES_FOLDER}/malformed-${index}.md`;
		const malformed = { schemaVersion: 999, type: "recipe", title: "Malformed" };
		await vault.write(path, `---\n${JSON.stringify(malformed)}\n---\nInvalid recipe\n`);
		addMetadataFile(path, malformed);
	}
	for (let index = 0; index < ATTACHMENT_MARKDOWN_COUNT; index++) {
		const path = `${ATTACHMENTS_FOLDER}/excluded-${index}.md`;
		await vault.write(path, serializeRecipeFile(recipes[index], jsonYamlCodec));
		addMetadataFile(path, recipes[index].frontmatter as unknown as Record<string, unknown>);
	}

	const lists = new ShoppingListRepository(vault, jsonYamlCodec, LISTS_FOLDER);
	for (let listIndex = 0; listIndex < listCount; listIndex++) {
		const subsetSize = 2 + random.int(4);
		const selected: RecipeDocument[] = [];
		const used = new Set<number>();
		while (selected.length < subsetSize) {
			const recipeIndex = random.int(size);
			if (!used.has(recipeIndex)) {
				used.add(recipeIndex);
				selected.push(recipes[recipeIndex]);
			}
		}
		const generated = createShoppingListFromRecipes(
			selected,
			new Date(Date.parse(NOW) + listIndex * 1000),
		);
		generated.frontmatter.id = deterministicId("list", size * 1000 + listIndex + 1);
		generated.frontmatter.items = generated.frontmatter.items.map((item, itemIndex) => ({
			...item,
			id: deterministicId("sli", size * 1_000_000 + listIndex * 1000 + itemIndex + 1),
		}));
		const saved = await lists.save(generated);
		if (saved.path) {
			addMetadataFile(saved.path, saved.frontmatter as unknown as Record<string, unknown>);
		}
	}

	const metadataVault = {
		getMarkdownFiles: () => markdownFiles,
	} as unknown as Vault;
	const metadataCache = {
		getFileCache: (file: TFile) => {
			const frontmatter = frontmatterByPath.get(file.path);
			return frontmatter === undefined ? null : ({ frontmatter } as ReturnType<MetadataCache["getFileCache"]>);
		},
	} as unknown as MetadataCache;

	return {
		size,
		listCount,
		vault,
		metadataVault,
		metadataCache,
		recipes,
		frontmatterByPath,
		markdownFiles,
		commonMatchCount: Math.floor((size - 1) / 10) + 1,
		rareMatchCount: Math.floor((size - 1) / 137) - Math.floor((size - 1) / 1370),
	};
}

function percentile(sorted: number[], fraction: number): number {
	return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function distribution(samples: number[]): Distribution {
	if (samples.length === 0) {
		throw new Error("A benchmark must contain at least one sample.");
	}
	const sorted = [...samples].sort((a, b) => a - b);
	return {
		n: sorted.length,
		median: percentile(sorted, 0.5),
		p95: percentile(sorted, 0.95),
		max: sorted[sorted.length - 1],
	};
}

async function measure<T>(runs: number, work: () => T | Promise<T>): Promise<{ stats: Distribution; last: T }> {
	await work();
	const samples: number[] = [];
	let last!: T;
	for (let index = 0; index < runs; index++) {
		const started = performance.now();
		last = await work();
		samples.push(performance.now() - started);
	}
	return { stats: distribution(samples), last };
}

function busyWait(milliseconds: number): void {
	const until = performance.now() + milliseconds;
	while (performance.now() < until) {
		// Deliberately deterministic regression wrapper used only by mutation probes.
	}
}

export function evaluateGate(input: Omit<GateResult, "pass">): GateResult {
	return { ...input, pass: input.value < input.budgetMs };
}

function addReportRow(
	name: string,
	stats: Distribution,
	gate?: GateResult,
	unit: ReportRow["unit"] = "ms",
): void {
	reportRows.push({
		name,
		...stats,
		unit,
		budget: gate?.budgetMs ?? null,
		gatedStatistic: gate?.statistic ?? "informational",
		gatedValue: gate?.value ?? null,
		pass: gate?.pass ?? null,
	});
}

function assertVaultCoverage(synthetic: SyntheticVault): void {
	expect(synthetic.recipes).toHaveLength(synthetic.size);
	expect(synthetic.listCount).toBe(synthetic.size === 500 ? 50 : 200);
	expect(synthetic.markdownFiles.filter((file) => file.path.startsWith(`${RECIPES_FOLDER}/recipe-`))).toHaveLength(
		synthetic.size,
	);
	expect(synthetic.markdownFiles.filter((file) => file.path.includes("/malformed-"))).toHaveLength(MALFORMED_COUNT);
	expect(synthetic.markdownFiles.filter((file) => file.path.startsWith(`${ATTACHMENTS_FOLDER}/`))).toHaveLength(
		ATTACHMENT_MARKDOWN_COUNT,
	);
	expect(new Set(synthetic.recipes.map((recipe) => recipe.frontmatter.rating))).toEqual(
		new Set([1, 2, 3, 4, 5, null]),
	);
	expect(new Set(synthetic.recipes.map((recipe) => recipe.frontmatter.images.length))).toEqual(
		new Set([0, 1, 2, 3, 4, 5]),
	);
	expect(synthetic.recipes.some((recipe) => recipe.frontmatter.sourceUrl == null)).toBe(true);
	expect(synthetic.recipes.some((recipe) => recipe.frontmatter.sourceUrl != null)).toBe(true);
	expect(synthetic.recipes.some((recipe) => /[^\x00-\x7F]/.test(recipe.frontmatter.title))).toBe(true);
	expect(synthetic.recipes.some((recipe) => recipe.frontmatter.title.length > 70)).toBe(true);
	const counts = synthetic.recipes.map((recipe) => recipe.frontmatter.ingredients.length);
	expect(Math.min(...counts)).toBeGreaterThanOrEqual(5);
	expect(Math.max(...counts)).toBeLessThanOrEqual(25);
	const rawIngredients = new Set(
		synthetic.recipes.slice(0, INGREDIENT_POOL.length).flatMap((recipe) =>
			recipe.frontmatter.ingredients.map((ingredient) => ingredient.raw),
		),
	);
	for (const requiredKind of [
		"120 g all-purpose flour",
		"2 tbsp olive oil",
		"½ tsp kosher salt",
		"1-2 cups chicken broth",
		"salt to taste",
		"3 cloves garlic, minced",
		"2 (14 oz) cans tomatoes, drained",
	]) {
		expect(rawIngredients.has(requiredKind), `missing ingredient corpus kind: ${requiredKind}`).toBe(true);
	}
}

function assertColdCorrectness(
	synthetic: SyntheticVault,
	entries: RecipeIndexEntry[],
	lists: Awaited<ReturnType<ShoppingListRepository["list"]>>,
): void {
	expect(entries).toHaveLength(synthetic.size);
	expect(lists).toHaveLength(synthetic.listCount);
	expect(entries.some((entry) => entry.path.includes("malformed"))).toBe(false);
	expect(entries.some((entry) => entry.path.startsWith(`${ATTACHMENTS_FOLDER}/`))).toBe(false);
}

function extractIngredientCount(result: UrlExtractionResult): number {
	if (result.status === "extracted") {
		return result.candidate.ingredientsRaw.length;
	}
	if (result.status === "needs-selection") {
		return result.candidates.reduce((sum, candidate) => sum + candidate.ingredientsRaw.length, 0);
	}
	return result.draft.frontmatter.ingredients.length;
}

function extractionCases(): ExtractionCase[] {
	const jsonLd = `<html><body><script type="application/ld+json">${JSON.stringify({
		"@type": "Recipe",
		name: "JSON-LD Stew",
		recipeIngredient: ["1 cup beans", "2 tsp cumin", "salt to taste"],
		recipeInstructions: ["Combine.", "Simmer."],
	})}</script></body></html>`;
	const microdata = `<html><body><article itemscope itemtype="https://schema.org/Recipe">
		<h1 itemprop="name">Microdata Cakes</h1><ul><li itemprop="recipeIngredient">1 cup flour</li>
		<li itemprop="recipeIngredient">2 eggs</li></ul><ol><li itemprop="recipeInstructions">Mix.</li></ol>
	</article></body></html>`;
	const dom = `<html><body><article><h1>Heuristic Soup</h1><h2>Ingredients</h2><ul>
		<li>2 cups broth</li><li>1 carrot</li><li>pepper to taste</li><li>1 onion</li></ul>
		<h2>Instructions</h2><ol><li>Simmer everything.</li></ol></article></body></html>`;
	const multi = `<html><body><script type="application/ld+json">${JSON.stringify({
		"@graph": [
			{ "@type": "Recipe", name: "First", recipeIngredient: ["1 cup rice", "1 tsp salt"], recipeInstructions: ["Cook."] },
			{ "@type": "Recipe", name: "Second", recipeIngredient: ["2 cups oats", "1 cup milk"], recipeInstructions: ["Stir."] },
		],
	})}</script></body></html>`;
	const largeCore = `<script type="application/ld+json">${JSON.stringify({
		"@type": "Recipe",
		name: "Large Page Recipe",
		recipeIngredient: ["1 cup lentils", "2 cups water", "1 tsp salt", "1 onion", "2 carrots"],
		recipeInstructions: ["Cook until tender."],
	})}</script>`;
	const boilerplateLength = MAX_HTML_CHARS - largeCore.length - 100;
	const before = "x".repeat(Math.floor(boilerplateLength / 2));
	const after = "y".repeat(boilerplateLength - before.length);
	const large = `<html><body><div>${before}</div>${largeCore}<div>${after}</div></body></html>`;
	expect(large.length).toBeGreaterThan(MAX_HTML_CHARS - 1000);
	expect(large.length).toBeLessThanOrEqual(MAX_HTML_CHARS);
	return [
		{ name: "JSON-LD recipe", html: jsonLd, expectedStatus: "extracted", expectedIngredientCount: 3 },
		{ name: "Microdata recipe", html: microdata, expectedStatus: "extracted", expectedIngredientCount: 2 },
		{ name: "DOM heuristic recipe card", html: dom, expectedStatus: "extracted", expectedIngredientCount: 4 },
		{ name: "Multi-recipe page", html: multi, expectedStatus: "needs-selection", expectedIngredientCount: 4 },
		{ name: "Large near-limit page", html: large, expectedStatus: "extracted", expectedIngredientCount: 5 },
		{
			name: "No recipe / manual fallback",
			html: "<html><head><title>Ordinary article</title></head><body><p>This is ordinary prose without any recipe fields, lists, or structured data.</p></body></html>",
			expectedStatus: "manual-fallback",
			expectedIngredientCount: 0,
		},
	];
}

const reportRows: ReportRow[] = [];
const vaults = new Map<VaultSize, SyntheticVault>();
let createProductionFrontmatterCache: CreateObsidianFrontmatterCache;

async function loadProductionFrontmatterCacheAdapter(): Promise<CreateObsidianFrontmatterCache> {
	const esbuild = await loadEsbuild();
	const directory = await mkdtemp(join(tmpdir(), "recipe-clipper-adapter-"));
	const outfile = join(directory, "obsidianVault.cjs");
	try {
		// The published `obsidian` package is types-only. Bundle the real production adapter with a
		// minimal runtime shell; the benchmarked adapter only invokes the three documented methods.
		await esbuild.build({
			entryPoints: ["src/domain/vault/obsidianVault.ts"],
			bundle: true,
			format: "cjs",
			platform: "node",
			outfile,
			plugins: [
				{
					name: "obsidian-types-only-runtime",
					setup(build) {
						build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "obsidian-shell" }));
						build.onLoad({ filter: /.*/, namespace: "obsidian-shell" }, () => ({
							loader: "js",
							contents: `
								export class TFile { constructor() { this.path = ""; } }
								export class TFolder {}
								export const normalizePath = (path) => path.replace(/\\\\/g, "/").replace(/^\\/+|\\/+$/g, "");
								export const parseYaml = JSON.parse;
								export const stringifyYaml = JSON.stringify;
							`,
						}));
					},
				},
			],
		});
		const requireFromWorkspace = createRequire(join(process.cwd(), "package.json"));
		const loaded = requireFromWorkspace(outfile) as {
			createObsidianFrontmatterCache: CreateObsidianFrontmatterCache;
		};
		return loaded.createObsidianFrontmatterCache;
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

beforeAll(async () => {
	createProductionFrontmatterCache = await loadProductionFrontmatterCacheAdapter();
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date(NOW));
	try {
		vaults.set(500, await buildSyntheticVault(500, 50));
		vaults.set(2500, await buildSyntheticVault(2500, 200));
	} finally {
		vi.useRealTimers();
	}
}, 120_000);

describe("synthetic vault coverage floors", () => {
	it.each([500, 2500] as const)("contains exactly %i recipes and its required list count", (size) => {
		assertVaultCoverage(vaults.get(size) as SyntheticVault);
	});
});

describe("cold-load latency", () => {
	it.each([
		[500, 300],
		[2500, 1200],
	] as const)("rebuilds the metadataCache index and reads lists for %i recipes", async (size, budget) => {
		const synthetic = vaults.get(size) as SyntheticVault;
		const cache = createProductionFrontmatterCache(
			synthetic.metadataVault,
			synthetic.metadataCache,
			ATTACHMENTS_FOLDER,
		);
		const lists = new ShoppingListRepository(synthetic.vault, jsonYamlCodec, LISTS_FOLDER);

		const combined = await measure(HEAVY_RUNS, async () => {
			const indexer = new RecipeIndexer(RECIPES_FOLDER, ATTACHMENTS_FOLDER);
			indexer.rebuildFromCache(cache);
			const loadedLists = await lists.list();
			return { entries: indexer.list(), lists: loadedLists };
		});
		assertColdCorrectness(synthetic, combined.last.entries, combined.last.lists);
		const gate = evaluateGate({
			name: `Cold load (${size} recipes / ${synthetic.listCount} lists)`,
			statistic: "median",
			value: combined.stats.median,
			budgetMs: budget,
		});
		addReportRow(gate.name, combined.stats, gate);
		expect(gate.pass).toBe(true);

		const indexOnly = await measure(HEAVY_RUNS, () => {
			const indexer = new RecipeIndexer(RECIPES_FOLDER, ATTACHMENTS_FOLDER);
			indexer.rebuildFromCache(cache);
			return indexer.list();
		});
		expect(indexOnly.last).toHaveLength(size);
		addReportRow(`metadataCache index only (${size})`, indexOnly.stats);

		const listsOnly = await measure(HEAVY_RUNS, () => lists.list());
		expect(listsOnly.last).toHaveLength(synthetic.listCount);
		addReportRow(`Shopping-list read/parse only (${size})`, listsOnly.stats);

		const coldRead = await measure(HEAVY_RUNS, async () => {
			const indexer = new RecipeIndexer(RECIPES_FOLDER, ATTACHMENTS_FOLDER);
			indexer.rebuildFromCache(synthetic.vault);
			const loadedLists = await lists.list();
			return { entries: indexer.list(), lists: loadedLists };
		});
		assertColdCorrectness(synthetic, coldRead.last.entries, coldRead.last.lists);
		addReportRow(`Cold read including frontmatter parse (${size})`, coldRead.stats);
	}, 120_000);

	it("detects a delayed index rebuild and a no-op indexer", async () => {
		const synthetic = vaults.get(500) as SyntheticVault;
		const cache = createProductionFrontmatterCache(
			synthetic.metadataVault,
			synthetic.metadataCache,
			ATTACHMENTS_FOLDER,
		);
		const delayed = await measure(1, () => {
			const indexer = new RecipeIndexer(RECIPES_FOLDER, ATTACHMENTS_FOLDER);
			indexer.rebuildFromCache(cache);
			busyWait(305);
			return indexer.list();
		});
		const delayedGate = evaluateGate({
			name: "Mutated cold load",
			statistic: "median",
			value: delayed.stats.median,
			budgetMs: 300,
		});
		expect(delayed.stats.median).toBeGreaterThan(300);
		expect(delayedGate.pass).toBe(false);

		expect(() => assertColdCorrectness(synthetic, [], [])).toThrow();
	}, 10_000);
});

describe("collection search latency", () => {
	it.each([500, 2500] as const)("keeps all keystrokes below the p95 gate for %i recipes", async (size) => {
		const synthetic = vaults.get(size) as SyntheticVault;
		const cache = createProductionFrontmatterCache(
			synthetic.metadataVault,
			synthetic.metadataCache,
			ATTACHMENTS_FOLDER,
		);
		const indexer = new RecipeIndexer(RECIPES_FOLDER, ATTACHMENTS_FOLDER);
		indexer.rebuildFromCache(cache);
		const entries = indexer.list();
		const operations: Array<[string, RatingFilter]> = [];
		const queries = ["pantry", "saffronquasar", "zzzznomatch"];
		while (operations.length < 60) {
			for (const query of queries) {
				for (let length = 1; length <= query.length && operations.length < 60; length++) {
					operations.push([query.slice(0, length), "any"]);
				}
			}
			for (const rating of [1, 3, 5, "unrated"] as const) {
				operations.push(["", rating]);
			}
		}
		const samples: number[] = [];
		for (const [query, rating] of operations) {
			const started = performance.now();
			filterRecipes(entries, query, rating);
			samples.push(performance.now() - started);
		}
		const stats = distribution(samples);
		const gate = evaluateGate({
			name: `Search/filter keystrokes (${size})`,
			statistic: "p95",
			value: stats.p95,
			budgetMs: 16,
		});
		addReportRow(gate.name, stats, gate);
		expect(filterRecipes(entries, "pantry", "any")).toHaveLength(synthetic.commonMatchCount);
		expect(filterRecipes(entries, "saffronquasar", "any")).toHaveLength(synthetic.rareMatchCount);
		expect(filterRecipes(entries, "zzzznomatch", "any")).toHaveLength(0);
		expect(filterRecipes(entries, "", 1)).toHaveLength(Math.ceil(size / 6));
		expect(gate.pass).toBe(true);
	});

	it("detects a delayed filter and a filter that ignores its query", async () => {
		const synthetic = vaults.get(500) as SyntheticVault;
		const entries = synthetic.recipes.map((recipe) => ({
			id: recipe.frontmatter.id,
			path: recipe.path as string,
			title: recipe.frontmatter.title,
			rating: recipe.frontmatter.rating,
			sourceUrl: recipe.frontmatter.sourceUrl,
			primaryImagePath: null,
			updatedAt: recipe.frontmatter.updatedAt,
			schemaVersion: 2,
		}));
		const delayed = await measure(5, () => {
			const result = filterRecipes(entries, "pantry", "any");
			busyWait(17);
			return result;
		});
		const gate = evaluateGate({
			name: "Mutated filter",
			statistic: "p95",
			value: delayed.stats.p95,
			budgetMs: 16,
		});
		expect(delayed.stats.p95).toBeGreaterThan(16);
		expect(gate.pass).toBe(false);

		const ignoresQuery = (rows: RecipeIndexEntry[], _query: string) => rows;
		expect(ignoresQuery(entries, "zzzznomatch")).not.toHaveLength(0);
		expect(filterRecipes(entries, "zzzznomatch", "any")).toHaveLength(0);
	});
});

describe("shopping-list aggregation latency", () => {
	it.each([500, 2500] as const)("aggregates 15 recipes and 195-215 ingredients from the %i vault", async (size) => {
		const recipes = (vaults.get(size) as SyntheticVault).recipes.slice(0, 15);
		const sources: AggregateSource[] = recipes.flatMap((recipe) =>
			recipe.frontmatter.ingredients.map((ingredient) => ({ recipeId: recipe.frontmatter.id, ingredient })),
		);
		expect(sources).toHaveLength(200);
		expect(sources.length).toBeGreaterThanOrEqual(195);
		expect(sources.length).toBeLessThanOrEqual(215);
		const measured = await measure(HEAVY_RUNS, () => aggregateIngredients(sources));
		const gate = evaluateGate({
			name: `Aggregation, 15 recipes / ${sources.length} ingredients (${size} vault)`,
			statistic: "median",
			value: measured.stats.median,
			budgetMs: 50,
		});
		addReportRow(gate.name, measured.stats, gate);
		expect(measured.last.length).toBeLessThan(sources.length);
		expect(
			measured.last.some((row) => row.mergeRuleId === "v1.keep-separate" || row.sourceRefs.length === 1),
		).toBe(true);
		const expectedRefs = sources
			.map((source) => `${source.recipeId}:${source.ingredient.id}`)
			.sort();
		const actualRefs = measured.last
			.flatMap((row) => row.sourceRefs.map((ref) => `${ref.recipeId}:${ref.ingredientId}`))
			.sort();
		expect(actualRefs).toEqual(expectedRefs);
		expect(new Set(actualRefs).size).toBe(expectedRefs.length);
		expect(gate.pass).toBe(true);
	});

	it("detects aggregation delayed beyond its budget", async () => {
		const recipes = (vaults.get(500) as SyntheticVault).recipes.slice(0, 15);
		const sources = recipes.flatMap((recipe) =>
			recipe.frontmatter.ingredients.map((ingredient) => ({ recipeId: recipe.frontmatter.id, ingredient })),
		);
		const delayed = await measure(1, () => {
			const result = aggregateIngredients(sources);
			busyWait(52);
			return result;
		});
		const gate = evaluateGate({
			name: "Mutated aggregation",
			statistic: "median",
			value: delayed.stats.median,
			budgetMs: 50,
		});
		expect(delayed.last.length).toBeGreaterThan(0);
		expect(delayed.stats.median).toBeGreaterThan(50);
		expect(gate.pass).toBe(false);
	});
});

describe("deterministic post-fetch extraction latency", () => {
	it("gates every extraction category separately", async () => {
		for (const fixture of extractionCases()) {
			const measured = await measure(HEAVY_RUNS, () =>
				extractRecipeFromPage({
					html: fixture.html,
					pageUrl: `https://recipes.example.test/${encodeURIComponent(fixture.name)}`,
					ollama: null,
					now: () => NOW,
				}),
			);
			expect(measured.last.status).toBe(fixture.expectedStatus);
			expect(extractIngredientCount(measured.last)).toBe(fixture.expectedIngredientCount);
			const gate = evaluateGate({
				name: `Extraction: ${fixture.name}`,
				statistic: "median",
				value: measured.stats.median,
				budgetMs: 1500,
			});
			addReportRow(gate.name, measured.stats, gate);
			expect(gate.pass).toBe(true);
		}
	}, 120_000);

	it("detects extraction delayed beyond its budget", async () => {
		const fixture = extractionCases()[0];
		const delayed = await measure(1, async () => {
			const result = await extractRecipeFromPage({
				html: fixture.html,
				pageUrl: "https://recipes.example.test/mutated",
				ollama: null,
				now: () => NOW,
			});
			busyWait(1505);
			return result;
		});
		const gate = evaluateGate({
			name: "Mutated extraction",
			statistic: "median",
			value: delayed.stats.median,
			budgetMs: 1500,
		});
		expect(delayed.last.status).toBe("extracted");
		expect(delayed.stats.median).toBeGreaterThan(1500);
		expect(gate.pass).toBe(false);
	}, 10_000);
});

describe("production bundle size", () => {
	it("builds current source to a temporary production outfile and stays below 500 KiB", async () => {
		const esbuild = await loadEsbuild();
		const directory = await mkdtemp(join(tmpdir(), "recipe-clipper-bundle-"));
		const outfile = join(directory, "main.js");
		try {
			// This duplicates esbuild.config.mjs production options so the measurement cannot read a stale root main.js.
			await esbuild.build({
				banner: {
					js: "/*\nTHIS IS A GENERATED/BUNDLED FILE BY ESBUILD\nif you want to view the source, please visit the github repository of this plugin\n*/\n",
				},
				entryPoints: ["src/main.ts"],
				bundle: true,
				external: [
					"obsidian",
					"electron",
					"@codemirror/autocomplete",
					"@codemirror/collab",
					"@codemirror/commands",
					"@codemirror/language",
					"@codemirror/lint",
					"@codemirror/search",
					"@codemirror/state",
					"@codemirror/view",
					"@lezer/common",
					"@lezer/highlight",
					"@lezer/lr",
					...builtins,
				],
				format: "cjs",
				jsx: "automatic",
				target: "es2018",
				logLevel: "silent",
				sourcemap: false,
				treeShaking: true,
				minify: true,
				outfile,
			});
			const bytes = (await stat(outfile)).size;
			const contents = await readFile(outfile, "utf8");
			const gate = evaluateGate({
				name: "Uncompressed production main.js",
				statistic: "value",
				value: bytes,
				budgetMs: BUNDLE_BUDGET_BYTES,
			});
			const kib = bytes / 1024;
			addReportRow(
				gate.name,
				{ n: 1, median: kib, p95: kib, max: kib },
				{ ...gate, value: kib, budgetMs: 500 },
				"KiB",
			);
			expect(Buffer.byteLength(contents)).toBe(bytes);
			expect(contents).toContain("THIS IS A GENERATED/BUNDLED FILE BY ESBUILD");
			expect(bytes).toBeGreaterThan(100 * 1024);
			expect(gate.pass).toBe(true);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}, 30_000);

	it("uses a strict boundary for the bundle budget", () => {
		expect(
			evaluateGate({
				name: "One byte under bundle budget",
				statistic: "value",
				value: BUNDLE_BUDGET_BYTES - 1,
				budgetMs: BUNDLE_BUDGET_BYTES,
			}).pass,
		).toBe(true);
		expect(
			evaluateGate({
				name: "Exactly at bundle budget",
				statistic: "value",
				value: BUNDLE_BUDGET_BYTES,
				budgetMs: BUNDLE_BUDGET_BYTES,
			}).pass,
		).toBe(false);
	});
});

function formatNumber(value: number | null): string {
	return value == null ? "—" : value.toFixed(2);
}

function table(rows: ReportRow[]): string {
	const lines = [
		"| Measurement | N | Median | p95 | Max | Budget | Gated statistic | Result |",
		"|---|---:|---:|---:|---:|---:|---|---|",
	];
	for (const row of rows) {
		const suffix = row.unit === "KiB" ? " KiB" : " ms";
		lines.push(
			`| ${row.name} | ${row.n} | ${formatNumber(row.median)}${suffix} | ${formatNumber(row.p95)}${suffix} | ${formatNumber(row.max)}${suffix} | ${row.budget == null ? "—" : `${formatNumber(row.budget)}${suffix}`} | ${row.gatedStatistic}${row.gatedValue == null ? "" : ` = ${formatNumber(row.gatedValue)}${suffix}`} | ${row.pass == null ? "INFO" : row.pass ? "PASS" : "FAIL"} |`,
		);
	}
	return lines.join("\n");
}

function parseStoredRuns(markdown: string): Record<string, ReportRow[]> {
	const match = markdown.match(/<!-- BENCH_DATA (.+) -->/);
	if (!match) {
		return {};
	}
	try {
		return JSON.parse(match[1]) as Record<string, ReportRow[]>;
	} catch {
		return {};
	}
}

async function writeBenchmarkReport(): Promise<void> {
	if (process.env.BENCH_REPORT !== "1") {
		return;
	}
	const reportPath = join(process.cwd(), "docs/eval-reports/performance-benchmark-report.md");
	let stored: Record<string, ReportRow[]> = {};
	try {
		stored = parseStoredRuns(await readFile(reportPath, "utf8"));
	} catch {
		// The first reporting pass creates the report.
	}
	const variant = process.env.BENCH_VARIANT === "coverage" ? "coverage" : "plain";
	stored[variant] = reportRows;
	const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
	const cpu = cpus()[0]?.model ?? "Unknown CPU";
	const nearBudget = Object.entries(stored)
		.flatMap(([run, rows]) =>
			rows
				.filter((row) => row.budget != null && row.gatedValue != null && row.gatedValue * 2 >= row.budget)
				.map((row) => `- ${run}: ${row.name} (${formatNumber(row.gatedValue)} / ${formatNumber(row.budget)} ${row.unit})`),
		);
	const markdown = `# Performance Benchmark Report

> Generated by \`tests/evals/performanceBenchmarks.test.ts\`. Timing values vary by host; the committed report records this machine's runs.

## Run metadata

- Git commit: \`${sha}\`
- Date: ${new Date().toISOString()}
- Node: ${process.version}
- OS: ${platform()} ${release()}
- CPU: ${cpu}
- Aggregation rules: \`${RULES_VERSION}\`
- Generator seed: \`0x${SEED.toString(16)}\`
- Vaults: 500 recipes / 50 shopping lists; 2,500 recipes / 200 shopping lists
- Corpus rejection paths per vault: ${MALFORMED_COUNT} malformed recipe files and ${ATTACHMENT_MARKDOWN_COUNT} attachment-folder Markdown files

## Gate status

All automated budgets below use strict \`<\` comparisons. Cold load, aggregation, and extraction gate the median; search gates p95 across keystrokes; bundle size gates the measured byte count. The cold-read rows include JSON frontmatter parsing through \`InMemoryVault.listMarkdown\`; the production-path cold-load rows use pre-parsed Obsidian metadata cache objects.

### Plain Vitest run

${stored.plain ? table(stored.plain) : "Not measured in this report."}

### Vitest coverage run

${stored.coverage ? table(stored.coverage) : "Not measured in this report."}

## Gates within 2× of budget

${nearBudget.length > 0 ? nearBudget.join("\n") : "None on the recorded runs."}

## Scope-conflict failures

None on the recorded runs. If a production-code budget misses later, this benchmark must report and pin it rather than changing source code in this task.

## What this does not measure

- Node and jsdom are not Electron/Chromium running inside Obsidian.
- This run does not measure React render or paint time.
- Obsidian builds the real metadata cache before \`onLayoutReady\`; the production-path gate measures index consumption of that already-parsed cache, while the cold-read row is a separate worst case.
- Testing inside the Obsidian desktop app is a manual follow-up for a person.
- Lin's Claude/Codex cross-review and Greg Szu-Tu's merge sign-off remain unchecked person/orchestrator gates.

<!-- BENCH_DATA ${JSON.stringify(stored)} -->
`;
	await mkdir(join(process.cwd(), "docs/eval-reports"), { recursive: true });
	await writeFile(reportPath, markdown, "utf8");
}

afterAll(async () => {
	await writeBenchmarkReport();
});
