import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createManualRecipe } from "../../../src/domain/schema/recipeSchema";
import { formatSourceAttribution } from "../../../src/domain/extraction/attributionExtractor";
import {
	OLLAMA_RECIPE_EXTRACTION_PROMPT,
	OLLAMA_RECIPE_JSON_SCHEMA,
} from "../../../src/domain/extraction/ollamaExtractor";
import {
	extractRecipeFromPage,
	findDuplicateSourceUrls,
	selectExtractionCandidate,
} from "../../../src/domain/extraction/urlClipper";
import { normalizeRecipeSourceUrl } from "../../../src/domain/extraction/text";
import { parseUntrustedHtml } from "../../../src/domain/extraction/untrustedHtml";
import { RecipeIndexer } from "../../../src/domain/vault/recipeIndexer";
import type { OllamaExtractOptions } from "../../../src/domain/extraction/ollamaExtractor";

const NOW = "2026-10-16T15:00:00.000Z";

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function ollamaOptions(
	fetchImpl: typeof fetch,
	overrides: Partial<OllamaExtractOptions> = {},
): OllamaExtractOptions {
	return {
		endpoint: "http://127.0.0.1:11434",
		model: "qwen2.5:7b-instruct",
		lightweightModel: "llama3.2:3b-instruct",
		healthCheckMs: 1500,
		timeoutMs: 25000,
		fetchImpl,
		...overrides,
	};
}

describe("extractRecipeFromPage", () => {
	it("extracts a schema.org Recipe from JSON-LD @graph without calling Ollama", async () => {
		const fetchImpl = vi.fn();
		const html = `<!doctype html><html><head>
			<title>Chili</title>
			<meta property="og:site_name" content="Ignored Site">
			<script>globalThis.__pwned = true</script>
			<script type="application/ld+json">
			{
				"@context": "https://schema.org",
				"@graph": [
					{ "@type": "Organization", "name": "Not A Recipe" },
					{
						"@type": "Recipe",
						"name": "Weeknight Chili",
						"author": { "@type": "Person", "name": "Daniel" },
						"publisher": { "@type": "Organization", "name": "Serious Eats" },
						"recipeYield": "4 servings",
						"prepTime": "PT15M",
						"cookTime": "PT1H",
						"totalTime": "PT1H15M",
						"cookingMethod": "Stovetop",
						"image": "https://cdn.example/chili.jpg",
						"url": "https://example.com/chili",
						"recipeIngredient": ["1 lb beef", "½ cup sugar"],
						"recipeInstructions": [
							{ "@type": "HowToStep", "text": "Brown the beef." },
							{ "@type": "HowToSection", "itemListElement": [{ "@type": "HowToStep", "text": "Simmer the chili." }] }
						]
					}
				]
			}
			</script>
			<img src="x" onerror="globalThis.__pwned = true">
		</head><body><p>by Someone Else</p></body></html>`;

		const result = await extractRecipeFromPage({
			html,
			pageUrl: "https://example.com/chili?utm_source=test",
			now: () => NOW,
			ollama: ollamaOptions(fetchImpl),
		});

		expect(fetchImpl).not.toHaveBeenCalled();
		expect(result.status).toBe("extracted");
		if (result.status !== "extracted") {
			return;
		}
		expect(result.succeeded).toBe(true);
		expect(result.candidate.extractionMethod).toBe("json-ld");
		expect(result.candidate.draft.frontmatter.extractionMethod).toBe("json-ld");
		expect(result.candidate.title).toBe("Weeknight Chili");
		expect(result.candidate.ingredientsRaw).toEqual(["1 lb beef", "½ cup sugar"]);
		expect(result.candidate.ingredients[0]?.quantity).toBe(1);
		expect(result.candidate.ingredients[1]?.quantity).toBe(0.5);
		expect(result.candidate.ingredients[1]?.raw).toBe("½ cup sugar");
		expect(result.candidate.instructions).toEqual(["Brown the beef.", "Simmer the chili."]);
		expect(result.candidate.servings).toEqual({ raw: "4 servings", amount: 4 });
		expect(result.candidate.prepTimeMinutes).toBe(15);
		expect(result.candidate.cookTimeMinutes).toBe(60);
		expect(result.candidate.totalTimeMinutes).toBe(75);
		expect(result.candidate.cookingMethods).toEqual(["Stovetop"]);
		expect(result.candidate.draft.frontmatter.author).toBe("Daniel");
		expect(result.candidate.draft.frontmatter.siteName).toBe("Serious Eats");
		expect(result.candidate.draft.frontmatter.sourceUrl).toBe("https://example.com/chili");
		expect(result.candidate.draft.frontmatter.cookTimeMinutes).not.toBeNull();
		expect(result.candidate.draft.notes).toBe("");
		expect(result.candidate.draft.frontmatter.images).toEqual([]);
		expect(result.candidate.candidateImages).toEqual([
			{ sourceUrl: "https://cdn.example/chili.jpg", alt: "" },
		]);
		expect(formatSourceAttribution(result.candidate.attribution)).toBe(
			"> Source: [Serious Eats](https://example.com/chili) by Daniel",
		);
		expect(result.candidate.draft.frontmatter.rating).toBeNull();
		expect((globalThis as { __pwned?: boolean }).__pwned).toBeUndefined();
	});

	it("strips scripts and event handlers before reading the page", async () => {
		const html = `<html><body>
			<script type="application/ld+json">{"@type":"Recipe","name":"Safe","recipeIngredient":["1 cup flour"],"recipeInstructions":["Mix."]}</script>
			<script>globalThis.__pwned = true</script>
			<img src="x" onerror="globalThis.__pwned = true">
			<a href="javascript:alert(1)">nope</a>
		</body></html>`;
		const result = await extractRecipeFromPage({ html, pageUrl: "https://example.com/safe", now: () => NOW });
		expect(result.status).toBe("extracted");
		expect((globalThis as { __pwned?: boolean }).__pwned).toBeUndefined();
		const parsed = parseUntrustedHtml(html);
		expect(parsed.document.querySelector("script")).toBeNull();
		expect(parsed.document.querySelector("img")?.hasAttribute("onerror")).toBe(false);
		expect(parsed.document.querySelector("a")?.hasAttribute("href")).toBe(false);
		expect(parsed.jsonLdBlocks.some((block) => block.includes("1 cup flour"))).toBe(true);
	});

	it("reads microdata and does not invent a missing cook time", async () => {
		const html = `<html><body>
			<div itemscope itemtype="https://schema.org/WebPage">
				<div itemscope itemtype="https://schema.org/Recipe">
					<h1 itemprop="name">Pancakes</h1>
					<span itemprop="author" itemscope itemtype="https://schema.org/Person"><span itemprop="name">Ada</span></span>
					<meta itemprop="recipeYield" content="6">
					<ul>
						<li itemprop="recipeIngredient">1 cup flour</li>
						<li itemprop="recipeIngredient">1 cup milk</li>
					</ul>
					<ol>
						<li itemprop="recipeInstructions">Mix.</li>
						<li itemprop="recipeInstructions">Cook.</li>
					</ol>
				</div>
			</div>
		</body></html>`;
		const result = await extractRecipeFromPage({ html, pageUrl: "https://example.com/pancakes", now: () => NOW });
		expect(result.status).toBe("extracted");
		if (result.status !== "extracted") {
			return;
		}
		expect(result.candidate.extractionMethod).toBe("microdata");
		expect(result.candidate.draft.frontmatter.author).toBe("Ada");
		expect(result.candidate.servings).toEqual({ raw: "6", amount: 6 });
		expect(result.candidate.cookTimeMinutes).toBeNull();
		expect(result.candidate.draft.frontmatter.cookTimeMinutes).toBeNull();
		expect(result.candidate.ingredientsRaw).toEqual(["1 cup flour", "1 cup milk"]);
		expect(result.candidate.instructions).toEqual(["Mix.", "Cook."]);
	});

	it("reads RDFa as microdata because the schema has no rdfa method", async () => {
		const html = `<html><body>
			<div vocab="https://schema.org/" typeof="Recipe">
				<span property="name">Soup</span>
				<span property="author">Lin</span>
				<span property="recipeIngredient">2 cups broth</span>
				<span property="recipeInstructions">Simmer.</span>
			</div>
		</body></html>`;
		const result = await extractRecipeFromPage({ html, pageUrl: "https://example.com/soup", now: () => NOW });
		expect(result.status).toBe("extracted");
		if (result.status !== "extracted") {
			return;
		}
		expect(result.candidate.extractionMethod).toBe("microdata");
		expect(result.candidate.ingredientsRaw).toEqual(["2 cups broth"]);
		expect(result.candidate.draft.frontmatter.author).toBe("Lin");
	});

	it("uses DOM headings when structured data has no ingredients or instructions", async () => {
		const html = `<html><body>
			<script type="application/ld+json">{"@type":"Recipe","name":"Only a title"}</script>
			<nav><h2>Ingredients</h2><ul><li>Shop</li></ul></nav>
			<article>
				<h1>Weeknight Beans</h1>
				<h2>Ingredients</h2>
				<ul><li>2 cans beans</li><li>1 onion</li></ul>
				<h2>Instructions</h2>
				<ol><li>Chop the onion.</li><li>Simmer the beans.</li></ol>
			</article>
		</body></html>`;
		const result = await extractRecipeFromPage({
			html,
			pageUrl: "https://blog.example/beans",
			now: () => NOW,
			ollama: ollamaOptions(vi.fn()),
		});
		expect(result.status).toBe("extracted");
		if (result.status !== "extracted") {
			return;
		}
		expect(result.candidate.extractionMethod).toBe("dom-heuristic");
		expect(result.candidate.ingredientsRaw).toEqual(["2 cans beans", "1 onion"]);
		expect(result.candidate.instructions).toEqual(["Chop the onion.", "Simmer the beans."]);
		expect(result.candidate.ingredientsRaw).not.toContain("Shop");
	});

	it("reads a WP Recipe Maker card", async () => {
		const html = `<html><body>
			<div class="wprm-recipe">
				<h2 class="wprm-recipe-name">Card Title</h2>
				<span class="wprm-recipe-author">Sam</span>
				<span class="wprm-recipe-servings">4 to 6</span>
				<div class="wprm-recipe-prep-time"><span class="wprm-recipe-prep_time-minutes">15</span></div>
				<ul>
					<li class="wprm-recipe-ingredient"><span class="wprm-recipe-ingredient-amount">1</span> <span class="wprm-recipe-ingredient-unit">cup</span> <span class="wprm-recipe-ingredient-name">rice</span></li>
				</ul>
				<ul>
					<li class="wprm-recipe-instruction"><div class="wprm-recipe-instruction-text">Rinse the rice.</div></li>
				</ul>
			</div>
		</body></html>`;
		const result = await extractRecipeFromPage({ html, pageUrl: "https://example.com/rice", now: () => NOW });
		expect(result.status).toBe("extracted");
		if (result.status !== "extracted") {
			return;
		}
		expect(result.candidate.extractionMethod).toBe("dom-heuristic");
		expect(result.candidate.title).toBe("Card Title");
		expect(result.candidate.ingredientsRaw[0]).toMatch(/1 cup rice/);
		expect(result.candidate.servings).toEqual({ raw: "4 to 6", amount: null });
		expect(result.candidate.prepTimeMinutes).toBe(15);
		expect(result.candidate.draft.frontmatter.author).toBe("Sam");
	});

	it("asks for a selection when the page has multiple recipes", async () => {
		const html = `<html><body>
			<script type="application/ld+json">
			{"@graph":[
				{"@type":"Recipe","name":"First","recipeIngredient":["1 cup a"],"recipeInstructions":["Do a."]},
				{"@type":"Recipe","name":"Second","recipeIngredient":["2 cups b"],"recipeInstructions":["Do b."]}
			]}
			</script>
		</body></html>`;
		const pending = await extractRecipeFromPage({ html, pageUrl: "https://example.com/two", now: () => NOW });
		expect(pending.status).toBe("needs-selection");
		expect(pending.succeeded).toBe(false);
		if (pending.status !== "needs-selection") {
			return;
		}
		expect(pending.candidates.map((item) => item.title)).toEqual(["First", "Second"]);
		const selected = selectExtractionCandidate(pending, 1);
		expect(selected.status).toBe("extracted");
		if (selected.status === "extracted") {
			expect(selected.candidate.title).toBe("Second");
		}
		const direct = await extractRecipeFromPage({
			html,
			pageUrl: "https://example.com/two",
			selectionIndex: 1,
			now: () => NOW,
		});
		expect(direct.status).toBe("extracted");
		if (direct.status === "extracted") {
			expect(direct.candidate.ingredientsRaw).toEqual(["2 cups b"]);
		}
	});

	it("keeps the URL and does not claim success for paywalled, video-only, or blocked pages", async () => {
		const paywall = await extractRecipeFromPage({
			html: `<html><head><title>Members</title></head><body><div class="paywall">Subscribe to continue reading</div></body></html>`,
			pageUrl: "https://example.com/members",
			now: () => NOW,
		});
		expect(paywall.status).toBe("manual-fallback");
		expect(paywall.succeeded).toBe(false);
		if (paywall.status === "manual-fallback") {
			expect(paywall.reason).toBe("paywalled");
			expect(paywall.draft.frontmatter.sourceUrl).toBe("https://example.com/members");
			expect(paywall.draft.frontmatter.extractionMethod).toBe("manual");
			expect(paywall.draft.frontmatter.ingredients).toEqual([]);
			expect(paywall.draft.instructions).toEqual([]);
		}

		const video = await extractRecipeFromPage({
			html: `<html><body><iframe src="https://www.youtube.com/embed/abc"></iframe><p>Watch this</p></body></html>`,
			pageUrl: "https://example.com/watch",
			now: () => NOW,
		});
		expect(video.status).toBe("manual-fallback");
		if (video.status === "manual-fallback") {
			expect(video.reason).toBe("video-only");
			expect(video.draft.frontmatter.sourceUrl).toBe("https://example.com/watch");
			expect(video.succeeded).toBe(false);
		}

		const blocked = await extractRecipeFromPage({
			html: `<html><body><script type="application/ld+json">{"@type":"Recipe","name":"Hidden","recipeIngredient":["1 cup flour"],"recipeInstructions":["Mix."]}</script></body></html>`,
			pageUrl: "https://example.com/hidden",
			httpStatus: 403,
			now: () => NOW,
		});
		expect(blocked.status).toBe("manual-fallback");
		if (blocked.status === "manual-fallback") {
			expect(blocked.reason).toBe("inaccessible");
			expect(blocked.draft.frontmatter.ingredients).toEqual([]);
			expect(blocked.draft.frontmatter.sourceUrl).toBe("https://example.com/hidden");
		}
	});

	it("grounds Ollama output in the page and drops invented fields", async () => {
		const html = `<html><head><title>Garlic Noodles</title></head><body><article>
			<p>Garlic Noodles by Lan from Example Kitchen.</p>
			<p>Use 8 oz noodles and 2 cloves garlic. Boil the noodles, then stir in the garlic.</p>
			<p>Prep time 15 minutes. Serves 2. Method: boil.</p>
		</article></body></html>`;
		const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.endsWith("/api/tags")) {
				return jsonResponse({ models: [] });
			}
			const body = JSON.parse(String(init?.body));
			expect(body.options.temperature).toBe(0);
			expect(body.format).toEqual(OLLAMA_RECIPE_JSON_SCHEMA);
			expect(body.model).toBe("qwen2.5:7b-instruct");
			expect(body.messages[0].content).toBe(OLLAMA_RECIPE_EXTRACTION_PROMPT);
			return jsonResponse({
				message: {
					content: JSON.stringify({
						title: "Garlic Noodles",
						ingredientsRaw: ["8 oz noodles", "2 cloves garlic", "99 cups unicorn dust"],
						instructions: ["Boil the noodles, then stir in the garlic.", "Invent a glaze."],
						author: "Lan",
						siteName: "Example Kitchen",
						servingsRaw: "Serves 2",
						prepTimeMinutes: 15,
						cookTimeMinutes: 45,
						cookingMethods: ["boil", "deep-fry"],
						notes: "This note was not requested",
					}),
				},
			});
		});
		const result = await extractRecipeFromPage({
			html,
			pageUrl: "https://example.com/noodles",
			now: () => NOW,
			ollama: ollamaOptions(fetchImpl),
		});
		expect(result.status).toBe("extracted");
		if (result.status !== "extracted") {
			return;
		}
		expect(result.candidate.extractionMethod).toBe("ollama");
		expect(result.candidate.ingredientsRaw).toEqual(["8 oz noodles", "2 cloves garlic"]);
		expect(result.candidate.instructions).toEqual(["Boil the noodles, then stir in the garlic."]);
		expect(result.candidate.draft.frontmatter.author).toBe("Lan");
		expect(result.candidate.draft.frontmatter.siteName).toBe("Example Kitchen");
		expect(result.candidate.servings).toEqual({ raw: "Serves 2", amount: 2 });
		expect(result.candidate.prepTimeMinutes).toBe(15);
		expect(result.candidate.cookTimeMinutes).toBeNull();
		expect(result.candidate.cookingMethods).toEqual(["boil"]);
		expect(result.candidate.draft.notes).toBe("");
		expect(result.candidate.draft.frontmatter.sourceUrl).toBe("https://example.com/noodles");
	});

	it("does not call a non-local model", async () => {
		const fetchImpl = vi.fn();
		const result = await extractRecipeFromPage({
			html: "<html><body><p>No recipe here, just a long enough paragraph about nothing culinary at all.</p></body></html>",
			pageUrl: "https://example.com/plain",
			now: () => NOW,
			ollama: ollamaOptions(fetchImpl, { endpoint: "https://api.openai.com/v1" }),
		});
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(result.status).toBe("manual-fallback");
		expect(result.succeeded).toBe(false);
		expect(result.warnings.some((warning) => /cloud/i.test(warning))).toBe(true);
	});

	it("falls back when Ollama JSON does not match the schema", async () => {
		const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
			if (String(input).endsWith("/api/tags")) {
				return jsonResponse({ models: [] });
			}
			return jsonResponse({ message: { content: "not json" } });
		});
		const result = await extractRecipeFromPage({
			html: "<html><body><p>Still no ingredient list on this page, only a paragraph.</p></body></html>",
			pageUrl: "https://example.com/bad-json",
			now: () => NOW,
			ollama: ollamaOptions(fetchImpl),
		});
		expect(result.status).toBe("manual-fallback");
		expect(result.succeeded).toBe(false);
		expect(result.warnings.some((warning) => /schema/i.test(warning))).toBe(true);
	});

	it("returns a cancelled fallback when the caller aborts", async () => {
		const controller = new AbortController();
		controller.abort();
		const fetchImpl = vi.fn();
		const result = await extractRecipeFromPage({
			html: "<html><body><p>Nothing to extract from this aborted page body.</p></body></html>",
			pageUrl: "https://example.com/cancel",
			signal: controller.signal,
			ollama: ollamaOptions(fetchImpl),
			now: () => NOW,
		});
		expect(result.status).toBe("manual-fallback");
		if (result.status === "manual-fallback") {
			expect(result.reason).toBe("cancelled");
		}
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("flags duplicate source URLs after tracking-parameter normalization", () => {
		expect(normalizeRecipeSourceUrl("https://www.Example.com/recipe/?utm_source=twitter")).toBe(
			"https://example.com/recipe",
		);
		const matches = findDuplicateSourceUrls("https://www.Example.com/recipe/?utm_source=twitter", [
			{ id: "rec_existing", sourceUrl: "https://example.com/recipe/", path: "Recipes/Existing.md" },
			{ id: "rec_other", sourceUrl: "https://example.com/other" },
		]);
		expect(matches).toEqual([
			{
				id: "rec_existing",
				sourceUrl: "https://example.com/recipe/",
				path: "Recipes/Existing.md",
			},
		]);
	});

	it("stores sourceUrl on the vault index for duplicate checks", () => {
		const recipe = createManualRecipe("Chili");
		recipe.frontmatter.sourceUrl = "https://example.com/chili";
		const indexer = new RecipeIndexer("Recipes", "Recipes/_attachments");
		indexer.rebuild([
			{
				path: "Recipes/Chili.md",
				frontmatter: { ...recipe.frontmatter },
			},
		]);
		expect(indexer.getById(recipe.frontmatter.id)?.sourceUrl).toBe("https://example.com/chili");
	});

	it("parses a large page in under 1.5 seconds", async () => {
		const filler = "<p>word</p>".repeat(4000);
		const html = `<html><body>${filler}<article><h1>Big</h1><h2>Ingredients</h2><ul><li>1 cup flour</li></ul><h2>Instructions</h2><ol><li>Mix.</li></ol></article></body></html>`;
		const started = performance.now();
		const result = await extractRecipeFromPage({ html, pageUrl: "https://example.com/big", now: () => NOW });
		expect(performance.now() - started).toBeLessThan(1500);
		expect(result.status).toBe("extracted");
	});
});

describe("ollama prompt document", () => {
	it("keeps the system prompt in docs/prompts/ollama-recipe-extraction.md", () => {
		const doc = readFileSync("docs/prompts/ollama-recipe-extraction.md", "utf8").replace(
			/\r\n/g,
			"\n",
		);
		expect(doc).toContain(OLLAMA_RECIPE_EXTRACTION_PROMPT);
		expect(doc).toContain("additionalProperties");
		expect(doc).toContain("qwen2.5:7b-instruct");
	});
});
