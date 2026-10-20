import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { extractRecipeFromPage } from "../../src/domain/extraction/urlClipper";
import type { UrlExtractionResult } from "../../src/domain/extraction/types";
import { DEFAULT_SETTINGS } from "../../src/pluginSettings";
import { ImportReviewModal } from "../../src/ui/components/ImportReviewModal";
import { createMockPluginServices, type MockRecipeStore } from "../helpers/mockPluginServices";

afterEach(() => {
	cleanup();
});

const STRUCTURED = "1 10 ounce can cream of chicken";
const VISIBLE = "1 (10 ounce) can condensed cream of chicken soup";

async function review(file: string) {
	const html = readFileSync(`tests/fixtures/ingredient-disagreement/${file}`, "utf8");
	const result: UrlExtractionResult = await extractRecipeFromPage({
		html,
		pageUrl: "https://example.com/recipe",
		now: () => "2026-10-20T12:00:00.000Z",
	});
	if (result.status !== "extracted") {
		throw new Error("fixture did not extract");
	}
	const store: MockRecipeStore = { recipes: [], settings: { ...DEFAULT_SETTINGS } };
	render(
		<ImportReviewModal
			result={result}
			services={createMockPluginServices(store)}
			downloadImage={async () => null}
			onClose={() => undefined}
		/>,
	);
	return store;
}

describe("import review of ingredients that disagree with the page", () => {
	it("flags the cream of chicken line and shows both texts", async () => {
		await review("allrecipes-cream-of-chicken.html");
		const group = screen.getByRole("group", { name: /differ from the visible page/i });
		expect(within(group).getByText(STRUCTURED)).toBeTruthy();
		expect(within(group).getByText(VISIBLE)).toBeTruthy();
		expect(screen.getAllByText("Differs from the page")).toHaveLength(1);
	});

	it("keeps the structured text on save unless the reviewer picks the visible one", async () => {
		const store = await review("allrecipes-cream-of-chicken.html");
		fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
		await waitFor(() => expect(store.recipes).toHaveLength(1));
		expect(store.recipes[0]?.frontmatter.ingredients[0]?.raw).toBe(STRUCTURED);
	});

	it("saves the visible text when the reviewer picks it", async () => {
		const store = await review("allrecipes-cream-of-chicken.html");
		fireEvent.click(screen.getByRole("radio", { name: new RegExp(`Visible on page:.*${"condensed"}`) }));
		fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
		await waitFor(() => expect(store.recipes).toHaveLength(1));
		const raws = store.recipes[0]?.frontmatter.ingredients.map((item) => item.raw);
		expect(raws?.[0]).toBe(VISIBLE);
		expect(raws).toHaveLength(6);
	});

	it("shows no flags and no choices when the lists agree", async () => {
		await review("agree-heading-list.html");
		expect(screen.queryByText("Differs from the page")).toBeNull();
		expect(screen.queryByRole("group", { name: /differ from the visible page/i })).toBeNull();
	});

	it("drops a structured-only ingredient when the reviewer picks Not on the visible page", async () => {
		const store = await review("real-difference-extra-lines.html");
		fireEvent.click(screen.getByRole("radio", { name: /Not on the visible page/ }));
		fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
		await waitFor(() => expect(store.recipes).toHaveLength(1));
		expect(store.recipes[0]?.frontmatter.ingredients.map((item) => item.raw)).toEqual([
			"1 egg",
			"1 cup milk",
		]);
	});
});
