import { afterEach, describe, expect, it, vi } from "vitest";
import { parseUntrustedHtml } from "../../../src/domain/extraction/untrustedHtml";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("parseUntrustedHtml edge paths", () => {
	it("refuses to parse when the runtime has no DOMParser", () => {
		vi.stubGlobal("DOMParser", undefined);
		expect(() => parseUntrustedHtml("<p>hi</p>")).toThrow("DOMParser is not available");
	});

	it("keeps only non-empty JSON-LD blocks under the size cap and removes every script", () => {
		const oversized = `{"x":"${"a".repeat(500_001)}"}`;
		const html = [
			'<script type="application/ld+json">{"@type":"Recipe"}</script>',
			'<script type="application/ld+json"></script>',
			`<script type="application/ld+json">${oversized}</script>`,
			"<script>alert(1)</script>",
			"<p>body</p>",
		].join("");
		const parsed = parseUntrustedHtml(html);
		expect(parsed.jsonLdBlocks).toEqual(['{"@type":"Recipe"}']);
		expect(parsed.document.querySelectorAll("script")).toHaveLength(0);
	});
});
