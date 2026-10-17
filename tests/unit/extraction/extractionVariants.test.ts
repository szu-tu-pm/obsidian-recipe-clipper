import { describe, expect, it } from "vitest";
import { extractAttribution, formatSourceAttribution } from "../../../src/domain/extraction/attributionExtractor";
import { extractDomHeuristicRecipes } from "../../../src/domain/extraction/domHeuristicExtractor";
import {
	extractJsonLdRecipes,
	extractMicrodataRecipes,
	extractRdfaRecipes,
	extractStructuredRecipes,
} from "../../../src/domain/extraction/jsonLdExtractor";
import {
	buildOllamaChatBody,
	extractWithOllama,
	groundOllamaExtraction,
	isLocalOllamaEndpoint,
	resolveOllamaModel,
} from "../../../src/domain/extraction/ollamaExtractor";
import {
	absoluteHttpUrl,
	durationIsGrounded,
	normalizeRecipeSourceUrl,
	parseDurationMinutes,
	parseServings,
	sourceIncludes,
	uniqueStrings,
} from "../../../src/domain/extraction/text";
import {
	extractRecipeFromPage,
	findDuplicateSourceUrls,
	selectExtractionCandidate,
} from "../../../src/domain/extraction/urlClipper";
import type { UrlExtractionSelection } from "../../../src/domain/extraction/types";

function documentFor(html: string): Document {
	return new DOMParser().parseFromString(html, "text/html");
}

function response(body: unknown, status = 200): Response {
	return new Response(typeof body === "string" ? body : JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function ollamaOptions(fetchImpl: typeof fetch) {
	return {
		endpoint: "http://localhost:11434/",
		model: "full",
		lightweightModel: "small",
		useLightweight: true,
		healthCheckMs: 20,
		timeoutMs: 20,
		fetchImpl,
	};
}

describe("extraction variants", () => {
	it("handles URL, duration, serving, and grounding edge cases", () => {
		expect(uniqueStrings(["a", "", "a", "b"])).toEqual(["a", "b"]);
		expect(sourceIncludes("Alpha beta", "a")).toBe(false);
		expect(sourceIncludes("Alpha beta", " beta ")).toBe(true);
		expect(absoluteHttpUrl("mailto:test@example.com", "https://example.com")).toBeNull();
		expect(absoluteHttpUrl("http://[", "https://example.com")).toBeNull();
		expect(parseServings(null)).toBeNull();
		expect(parseServings("   ")).toBeNull();
		expect(parseServings("four servings")).toEqual({ raw: "four servings", amount: null });
		expect(parseServings("0 servings")).toEqual({ raw: "0 servings", amount: null });
		expect(parseServings("4–6 servings")).toEqual({ raw: "4–6 servings", amount: null });
		expect(parseDurationMinutes(2.6)).toBe(3);
		expect(parseDurationMinutes(null)).toBeNull();
		expect(parseDurationMinutes(" ")).toBeNull();
		expect(parseDurationMinutes("PT45S")).toBeNull();
		expect(parseDurationMinutes("P1DT2H3M30S")).toBe(1564);
		expect(parseDurationMinutes("1.5 hours 12 minutes")).toBe(102);
		expect(parseDurationMinutes("8 days")).toBeNull();
		expect(durationIsGrounded(15, "Cook 15 mins")).toBe(true);
		expect(durationIsGrounded(120, "Cook 2 hours")).toBe(true);
		expect(durationIsGrounded(90, "Cook 1 hour and 30 minutes")).toBe(true);
		expect(durationIsGrounded(10, "Cook briefly")).toBe(false);
		expect(normalizeRecipeSourceUrl("ftp://example.com/a")).toBeNull();
		expect(normalizeRecipeSourceUrl("not a url")).toBeNull();
		expect(
			normalizeRecipeSourceUrl("https://WWW.Example.com/a/?utm_source=x&fbclid=y&gclid=z&mc_cid=1&mc_eid=2&b=2&a=1#top"),
		).toBe("https://example.com/a?a=1&b=2");
	});

	it("extracts uncommon JSON-LD shapes, images, and source URL forms", () => {
		const block = `<!-- {"mainEntity":{"@type":["Thing","https://schema.org/Recipe"],"name":{"name":"Nested Name"},"author":[{"name":"Ada"},7],"publisher":{"name":"Archive"},"yield":[4],"mainEntityOfPage":{"@id":"/canonical"},"image":["/one.jpg",{"contentUrl":"/two.jpg","caption":"Two"},{"src":"javascript:bad"},7],"recipeIngredient":{"itemListElement":[{"name":"1 cup oats"},null]},"recipeInstructions":"1. Mix.\\n2) Bake.","cookingMethod":[" Bake ",7]}} -->`;
		const [recipe] = extractJsonLdRecipes(["bad json", block, block], "https://example.com/page");
		expect(recipe.title).toBe("Nested Name");
		expect(recipe.author).toBe("Ada, 7");
		expect(recipe.servingsRaw).toBe("4");
		expect(recipe.sourceUrl).toBe("https://example.com/canonical");
		expect(recipe.ingredientsRaw).toEqual(["1 cup oats"]);
		expect(recipe.instructions).toEqual(["Mix.", "Bake."]);
		expect(recipe.images).toEqual([
			{ sourceUrl: "https://example.com/one.jpg", alt: "" },
			{ sourceUrl: "https://example.com/two.jpg", alt: "Two" },
		]);
		expect(extractJsonLdRecipes([JSON.stringify({ "@type": "Recipe", name: "Only title" })], "https://example.com")).toEqual([]);
	});

	it("covers nested microdata and RDFa structured fallbacks", () => {
		const microdata = documentFor(`<main itemscope itemtype="https://schema.org/Recipe">
			<meta itemprop="name" content="Micro Pie"><a itemprop="url" href="/pie">link</a>
			<span itemprop="author" itemscope><span itemprop="name">A Cook</span></span>
			<span itemprop="publisher" itemscope><span itemprop="name">Archive</span></span>
			<figure itemprop="image" itemscope><img src="/pie.jpg"></figure>
			<div itemprop="recipeInstructions" itemscope><span itemprop="text">Bake it.</span></div>
			<img itemprop="image" src="/other.jpg"><time itemprop="prepTime" datetime="PT4M"></time>
			<span itemprop="recipeIngredient">1 cup flour</span>
			<div itemscope itemtype="https://schema.org/Recipe"><span itemprop="name">Nested ignored</span></div>
		</main>`);
		const [micro] = extractMicrodataRecipes(microdata, "https://example.com/start");
		expect(micro).toMatchObject({ title: "Micro Pie", author: "A Cook", siteName: "Archive", prepTimeMinutes: 4 });
		expect(micro.images).toHaveLength(2);
		expect(extractStructuredRecipes([], microdata, "https://example.com")[0].extractionMethod).toBe("microdata");

		const rdfa = documentFor(`<main typeof="Recipe"><h1 property="name">RDFa Soup</h1><span property="recipeIngredient">1 cup water</span><div><span property="recipeInstructions" content="Boil."></span></div><aside typeof="Thing"><span property="recipeIngredient">ignore</span></aside></main>`);
		const [recipe] = extractRdfaRecipes(rdfa, "https://example.com/soup");
		expect(recipe.title).toBe("RDFa Soup");
		expect(recipe.instructions).toEqual(["Boil."]);
		expect(extractStructuredRecipes([], rdfa, "https://example.com")).toHaveLength(1);
	});

	it("extracts Tasty and Mediavine cards including time and image variants", () => {
		const document = documentFor(`<body>
			<article class="tasty-recipes"><h2 class="tasty-recipes-title">Tasty</h2><div class="tasty-recipes-ingredients"><li>1 cup rice</li></div><div class="tasty-recipes-instructions"><li>Cook.</li></div><span class="tasty-recipes-prep-time"><time datetime="PT7M"></time></span><div class="tasty-recipes-image"><img><img src="javascript:bad"><img src="/ok.jpg" alt="Rice"></div></article>
			<article class="mv-create-card"><h2 class="mv-create-title">MV</h2><div class="mv-create-ingredients"><li>2 cups water</li></div><div class="mv-create-instructions"><li>Boil.</li></div><span class="mv-create-time-cook"><span class="minutes">12</span></span></article>
			<article class="wprm-recipe"></article>
		</body>`);
		const recipes = extractDomHeuristicRecipes(document, "https://example.com/base");
		expect(recipes.map((item) => item.title)).toEqual(["Tasty", "MV"]);
		expect(recipes[0].prepTimeMinutes).toBe(7);
		expect(recipes[0].images).toEqual([{ sourceUrl: "https://example.com/ok.jpg", alt: "Rice" }]);
		expect(recipes[1].cookTimeMinutes).toBe(12);
	});

	it("handles noisy heading recipes and Open Graph image fallbacks", () => {
		const document = documentFor(`<head><meta property="og:image" content="/food.jpg"></head><body>
			<header><h2>Ingredients</h2><li>navigation</li></header><h1>Heading Dish</h1>
			<div>not a heading</div><p>${"x".repeat(49)}</p><strong><em>Ingredients</em></strong>
			<p>Ingredients</p><ul><li>1 cup peas</li><li>1 cup peas</li><li><span></span></li><li><ul><li>nested ignored</li></ul></li></ul>
			<b>Directions</b><ol><li>Cook peas.</li><li>Cook peas.</li></ol>
		</body>`);
		const [recipe] = extractDomHeuristicRecipes(document, "https://example.com/base");
		expect(recipe.ingredientsRaw).toEqual(["1 cup peas", "nested ignored"]);
		expect(recipe.instructions).toEqual(["Cook peas."]);
		expect(recipe.images).toEqual([{ sourceUrl: "https://example.com/food.jpg", alt: "" }]);
		expect(extractDomHeuristicRecipes(documentFor(`<head><meta property="og:image" content="javascript:bad"></head><body><h2>Ingredients</h2><li>1 cup rice</li></body>`), "https://example.com")[0].images).toEqual([]);
	});

	it("handles additional structured metadata scalar and element variants", () => {
		const direct = extractJsonLdRecipes([
			JSON.stringify([
				{ "@type": "Recipe", name: 42, "@id": "/id", recipeIngredient: ["1 cup rice"], recipeInstructions: [{ name: "Cook." }], image: { url: "/one.jpg", name: "One" }, recipeYield: "" },
				{ "@type": "Recipe", name: "Second", mainEntityOfPage: "/main", recipeIngredient: ["2 cups water"], recipeInstructions: ["Boil."] },
			]),
		], "https://example.com/start");
		expect(direct.map((item) => item.sourceUrl)).toEqual(["https://example.com/id", "https://example.com/main"]);
		expect(direct[0].title).toBe("42");
		expect(direct[0].images[0].alt).toBe("One");

		const micro = documentFor(`<div itemscope itemtype="Recipe">
			<div itemscope><span>ignored scope</span></div><span itemprop="name"></span>
			<link itemprop="url" href="/linked"><img itemprop="image" src="/image.jpg"><span itemprop="recipeIngredient">1 cup rice</span>
			<div itemprop="recipeInstructions">Cook.</div><span itemprop="cookingMethod">Boil</span>
			<div itemprop="author" itemscope><span property="name">Property Cook</span></div>
		</div><div itemscope itemtype="Thing"></div>`);
		const [recipe] = extractMicrodataRecipes(micro, "https://example.com");
		expect(recipe.author).toBe("Property Cook");
		expect(recipe.sourceUrl).toBe("https://example.com/linked");
		expect(recipe.cookingMethods).toEqual(["Boil"]);
	});

	it("formats attribution and ignores chrome bylines", () => {
		const document = documentFor(`<head><link rel="canonical" href="/food"><meta name="application-name" content="Archive"></head><body><header><span rel="author">Wrong</span></header><main><span class="byline">Right Cook</span></main></body>`);
		const attribution = extractAttribution(document, "https://example.com/page", null, null);
		expect(attribution).toEqual({ sourceUrl: "https://example.com/food", author: "Right Cook", siteName: "Archive" });
		expect(formatSourceAttribution(attribution)).toBe("> Source: [Archive](https://example.com/food) by Right Cook");
		expect(formatSourceAttribution({ sourceUrl: null, siteName: null, author: null })).toBeNull();
		expect(formatSourceAttribution({ sourceUrl: null, siteName: "Site", author: null })).toBe("> Source: [Site]() by Unknown");
		const long = documentFor(`<body><span class="byline">${"x".repeat(81)}</span></body>`);
		expect(extractAttribution(long, "not-a-url", null, { author: "Model Cook", siteName: "Model Site" })).toEqual({
			sourceUrl: null,
			author: "Model Cook",
			siteName: "Model Site",
		});
	});

	it("validates Ollama endpoint/model helpers and grounding", () => {
		expect(isLocalOllamaEndpoint("not a url")).toBe(false);
		expect(isLocalOllamaEndpoint("https://localhost:11434")).toBe(false);
		expect(isLocalOllamaEndpoint("http://[::1]:11434")).toBe(true);
		expect(resolveOllamaModel(ollamaOptions(fetch))).toBe("small");
		expect(buildOllamaChatBody("m", "https://example.com", "text").options.temperature).toBe(0);
		expect(groundOllamaExtraction({ title: "Missing", ingredientsRaw: ["invented"], instructions: [] }, "source")).toBeNull();
	});

	it("covers URL clipper duplicate, fallback, and tier-selection branches", async () => {
		expect(findDuplicateSourceUrls(null, [])).toEqual([]);
		expect(findDuplicateSourceUrls("bad", [])).toEqual([]);
		expect(findDuplicateSourceUrls("https://example.com/a", [
			{ id: "skip", sourceUrl: "https://example.com/a" },
			{ id: "empty", sourceUrl: null },
			{ id: "other", sourceUrl: "https://example.com/b" },
		], "skip")).toEqual([]);
		const emptySelection: UrlExtractionSelection = {
			status: "needs-selection",
			succeeded: false,
			candidates: [],
			duplicates: [],
			warnings: [],
		};
		expect(selectExtractionCandidate(emptySelection, 3)).toBe(emptySelection);

		const paywalled = await extractRecipeFromPage({ html: "<title>Paid</title>", pageUrl: "https://example.com", httpStatus: 402 });
		expect(paywalled.status === "manual-fallback" && paywalled.reason).toBe("paywalled");
		const serverError = await extractRecipeFromPage({ html: "<title>Down</title>", pageUrl: "https://example.com", httpStatus: 503 });
		expect(serverError.status === "manual-fallback" && serverError.reason).toBe("inaccessible");
		const marker = await extractRecipeFromPage({ html: "<body><div data-paywall>Members only content with enough filler words here.</div></body>", pageUrl: "https://example.com" });
		expect(marker.status === "manual-fallback" && marker.reason).toBe("paywalled");
		const unparsed = await extractRecipeFromPage({ html: `<body><p>${"ordinary article text ".repeat(5)}</p></body>`, pageUrl: "https://example.com" });
		expect(unparsed.status === "manual-fallback" && unparsed.reason).toBe("unparsed");

		const partialStructuredCompleteDom = await extractRecipeFromPage({
			pageUrl: "https://example.com/card",
			html: `<head><script type="application/ld+json">{"@type":"Recipe","name":"Metadata","author":"Structured Cook","recipeIngredient":["1 cup rice"]}</script></head><body><article class="wprm-recipe"><h2 class="wprm-recipe-name">Card</h2><li class="wprm-recipe-ingredient">1 cup rice</li><li class="wprm-recipe-instruction">Cook.</li></article></body>`,
		});
		expect(partialStructuredCompleteDom.status).toBe("extracted");
		if (partialStructuredCompleteDom.status === "extracted") {
			expect(partialStructuredCompleteDom.candidate.extractionMethod).toBe("dom-heuristic");
			expect(partialStructuredCompleteDom.candidate.attribution.author).toBe("Structured Cook");
		}

		const missingSelection = await extractRecipeFromPage({
			pageUrl: "https://example.com/multi",
			selectionIndex: 99,
			html: `<script type="application/ld+json">[{"@type":"Recipe","name":"A","recipeIngredient":["1 cup a"],"recipeInstructions":["A."]},{"@type":"Recipe","name":"B","recipeIngredient":["1 cup b"],"recipeInstructions":["B."]}]</script>`,
		});
		expect(missingSelection.status).toBe("needs-selection");
	});

	it("reports deterministic Ollama transport and response failures", async () => {
		const aborted = new AbortController();
		aborted.abort();
		expect((await extractWithOllama("text", "https://example.com", { ...ollamaOptions(fetch), signal: aborted.signal })).cancelled).toBe(true);
		expect((await extractWithOllama("text", "https://example.com", { ...ollamaOptions(fetch), endpoint: "https://remote.example" })).warnings[0]).toMatch(/not local/);

		const cases: Array<[typeof fetch, RegExp]> = [
			[(async () => response({}, 503)) as typeof fetch, /not reachable/],
			[(async (input) => String(input).endsWith("tags") ? response({}) : response({}, 500)) as typeof fetch, /rejected/],
			[(async (input) => String(input).endsWith("tags") ? response({}) : response({ message: {} })) as typeof fetch, /empty/],
			[(async (input) => String(input).endsWith("tags") ? response({}) : response({ message: { content: "not-json" } })) as typeof fetch, /schema validation/],
			[(async (input) => String(input).endsWith("tags") ? response({}) : response({ message: { content: "{}" } })) as typeof fetch, /schema validation/],
			[(async (input) => String(input).endsWith("tags") ? response({}) : response({ message: { content: JSON.stringify({ title: "No", ingredientsRaw: ["invented"], instructions: [] }) } })) as typeof fetch, /not grounded/],
			[(async () => { throw new Error("offline"); }) as typeof fetch, /could not be reached/],
			[(async () => { throw new DOMException("late", "AbortError"); }) as typeof fetch, /timed out/],
		];
		for (const [fetchImpl, warning] of cases) {
			const result = await extractWithOllama("source text", "https://example.com", ollamaOptions(fetchImpl));
			expect(result.fields).toBeNull();
			expect(result.warnings[0]).toMatch(warning);
		}
		const parent = new AbortController();
		const abortingFetch = (async () => {
			parent.abort();
			throw new Error("stopped");
		}) as typeof fetch;
		const cancelled = await extractWithOllama("source", "https://example.com", {
			...ollamaOptions(abortingFetch),
			signal: parent.signal,
		});
		expect(cancelled.cancelled).toBe(true);
	});
});
