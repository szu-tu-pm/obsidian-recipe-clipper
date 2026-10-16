import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { startImportSession } from "../../src/domain/extraction/importSession";
import { extractRecipeFromPage } from "../../src/domain/extraction/urlClipper";
import type { UrlExtractionResult } from "../../src/domain/extraction/types";
import { DEFAULT_SETTINGS } from "../../src/pluginSettings";
import { CollectionView } from "../../src/ui/CollectionView";
import { WrapperProvider } from "../../src/wrapper/WrapperContext";
import { createMockPluginServices, seedRecipe, type MockRecipeStore } from "../helpers/mockPluginServices";

afterEach(() => {
	cleanup();
});

const NOW = "2026-10-16T16:30:00.000Z";

function renderCollection(
	store: MockRecipeStore,
	importPage: (
		url: string,
		signal: AbortSignal,
	) => Promise<UrlExtractionResult>,
) {
	render(
		<WrapperProvider services={createMockPluginServices(store)}>
			<CollectionView importPage={async (url, _services, signal) => importPage(url, signal)} />
		</WrapperProvider>,
	);
}

function start(url = "https://example.com/chili"): void {
	fireEvent.click(screen.getByRole("button", { name: "Import URL" }));
	fireEvent.change(screen.getByLabelText("Recipe URL"), { target: { value: url } });
	fireEvent.click(screen.getByRole("button", { name: "Start import" }));
}

function hangUntilAbort(signal: AbortSignal): Promise<UrlExtractionResult> {
	return new Promise((_resolve, reject) => {
		signal.addEventListener("abort", () => {
			reject(new DOMException("The operation was aborted.", "AbortError"));
		});
	});
}

describe("async import session", () => {
	it("keeps the collection usable and cancels the in-flight fetch", async () => {
		const recipe = seedRecipe("Weeknight Chili");
		const store: MockRecipeStore = { recipes: [recipe], settings: { ...DEFAULT_SETTINGS } };
		const signals: AbortSignal[] = [];
		renderCollection(store, async (_url, signal) => {
			signals.push(signal);
			return hangUntilAbort(signal);
		});

		start();
		expect(await screen.findByText("Fetching the page…")).toBeTruthy();
		expect(screen.queryByRole("heading", { name: "Import URL" })).toBeNull();

		fireEvent.change(screen.getByLabelText("Search recipes by title"), {
			target: { value: "Weeknight" },
		});
		expect(screen.getByDisplayValue("Weeknight")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Edit" }));
		expect(await screen.findByRole("heading", { name: "Edit recipe" })).toBeTruthy();
		expect(store.recipes).toHaveLength(1);

		fireEvent.click(screen.getByRole("button", { name: "Cancel import" }));
		expect(await screen.findByText("Import cancelled.")).toBeTruthy();
		expect(signals[0]?.aborted).toBe(true);
		expect(screen.queryByRole("heading", { name: "Review import" })).toBeNull();
		expect(store.recipes).toHaveLength(1);
	});

	it("opens review after a successful extraction and does not write the vault", async () => {
		const store: MockRecipeStore = { recipes: [], settings: { ...DEFAULT_SETTINGS } };
		const result = await extractRecipeFromPage({
			html: `<html><body><script type="application/ld+json">
				{"@type":"Recipe","name":"Chili","recipeIngredient":["1 cup stock"],
				"recipeInstructions":["Simmer."]}
			</script></body></html>`,
			pageUrl: "https://example.com/chili",
			now: () => NOW,
		});
		renderCollection(store, async () => result);
		start();
		expect(await screen.findByRole("heading", { name: "Review import" })).toBeTruthy();
		expect(screen.getByText("Nothing is written to the vault until you save this review.")).toBeTruthy();
		expect(store.recipes).toHaveLength(0);
	});

	it("explains a retrieval failure and offers manual entry with the URL kept", async () => {
		const store: MockRecipeStore = { recipes: [], settings: { ...DEFAULT_SETTINGS } };
		renderCollection(store, async () => {
			throw new Error("The site did not respond.");
		});
		start("example.com/members");
		expect(await screen.findByRole("heading", { name: "Manual entry" })).toBeTruthy();
		expect(screen.getByText(/did not succeed \(inaccessible\)/i)).toBeTruthy();
		expect(screen.getByText(/The site did not respond/)).toBeTruthy();
		expect(screen.getByText("https://example.com/members")).toBeTruthy();
		expect(store.recipes).toHaveLength(0);
		fireEvent.click(screen.getByRole("button", { name: "Save manual entry" }));
		await waitFor(() => expect(store.recipes).toHaveLength(1));
		expect(store.recipes[0]?.frontmatter.extractionMethod).toBe("manual");
		expect(store.recipes[0]?.frontmatter.sourceUrl).toBe("https://example.com/members");
		expect(store.recipes[0]?.frontmatter.ingredients).toEqual([]);
	});

	it("aborts the signal passed into extraction when cancel arrives during reading", async () => {
		let seen: AbortSignal | null = null;
		const session = startImportSession({
			url: "https://example.com/chili",
			run: async (report, signal) => {
				seen = signal;
				report("extracting");
				return hangUntilAbort(signal);
			},
		});
		await waitFor(() => expect(session.snapshot().phase).toBe("extracting"));
		session.cancel();
		await session.done;
		expect(seen?.aborted).toBe(true);
		expect(session.snapshot().phase).toBe("cancelled");
	});
});
