import { describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
	controller: new AbortController(),
	domCalls: 0,
}));

vi.mock("../../../src/domain/extraction/jsonLdExtractor", async () => {
	const actual = await vi.importActual<
		typeof import("../../../src/domain/extraction/jsonLdExtractor")
	>("../../../src/domain/extraction/jsonLdExtractor");
	return {
		...actual,
		extractStructuredRecipes: (
			...args: Parameters<typeof actual.extractStructuredRecipes>
		) => {
			const recipes = actual.extractStructuredRecipes(...args);
			harness.controller.abort();
			return recipes;
		},
	};
});

vi.mock("../../../src/domain/extraction/domHeuristicExtractor", () => ({
	extractDomHeuristicRecipes: () => {
		harness.domCalls += 1;
		return [];
	},
}));

import { extractRecipeFromPage } from "../../../src/domain/extraction/urlClipper";

describe("abort between extraction tiers", () => {
	it("cancels after Tier 1 and does not run DOM heuristics", async () => {
		harness.controller = new AbortController();
		harness.domCalls = 0;
		const html = `<html><body>
			<script type="application/ld+json">
			{"@type":"Recipe","name":"Chili","recipeIngredient":["1 lb beef"],"recipeInstructions":["Brown the beef."]}
			</script>
			<h2>Ingredients</h2><ul><li>1 lb beef</li></ul>
			<h2>Instructions</h2><ol><li>Brown the beef.</li></ol>
		</body></html>`;

		const result = await extractRecipeFromPage({
			html,
			pageUrl: "https://example.com/chili",
			signal: harness.controller.signal,
			now: () => "2026-10-16T15:00:00.000Z",
		});

		expect(result.status).toBe("manual-fallback");
		if (result.status === "manual-fallback") {
			expect(result.reason).toBe("cancelled");
			expect(result.succeeded).toBe(false);
		}
		expect(harness.domCalls).toBe(0);
	});
});
