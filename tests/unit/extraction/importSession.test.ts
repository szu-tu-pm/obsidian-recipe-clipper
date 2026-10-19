import { describe, expect, it } from "vitest";
import { startImportSession } from "../../../src/domain/extraction/importSession";
import type { UrlExtractionResult } from "../../../src/domain/extraction/types";

const URL_UNDER_TEST = "https://example.com/recipe";
const NOW = () => "2025-01-01T00:00:00.000Z";

describe("import session edge paths", () => {
	it("ignores progress reported after the user cancelled", async () => {
		let reportLate: (() => void) | undefined;
		const session = startImportSession({
			url: URL_UNDER_TEST,
			now: NOW,
			run: (report, signal) =>
				new Promise((_resolve, reject) => {
					reportLate = () => report("extracting");
					signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
				}),
		});
		await Promise.resolve();
		session.cancel();
		reportLate?.();
		const final = await session.done;
		expect(final.phase).toBe("cancelled");
		expect(session.snapshot().phase).toBe("cancelled");
	});

	it("treats a fallback that says cancelled as a cancellation, not a failure", async () => {
		const result = {
			status: "manual-fallback",
			reason: "cancelled",
		} as unknown as UrlExtractionResult;
		const session = startImportSession({ url: URL_UNDER_TEST, now: NOW, run: async () => result });
		expect((await session.done).phase).toBe("cancelled");
	});

	it("keeps the URL for manual entry when the run throws something that is not an Error", async () => {
		const session = startImportSession({
			url: URL_UNDER_TEST,
			now: NOW,
			run: () => Promise.reject("boom"),
		});
		const final = await session.done;
		expect(final.phase).toBe("failed");
		expect(final.message).toContain("The page could not be retrieved (The page could not be retrieved.)");
		expect(final.url).toBe(URL_UNDER_TEST);
	});

	it("recognises an abort that arrives as a plain Error named AbortError", async () => {
		const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
		const session = startImportSession({
			url: URL_UNDER_TEST,
			now: NOW,
			run: () => Promise.reject(abort),
		});
		expect((await session.done).phase).toBe("cancelled");
	});
});
