import { JSDOM } from "jsdom";
import { extractRecipeFromPage } from "../../src/domain/extraction/urlClipper";

async function main(): Promise<void> {
	const urls = process.argv.slice(2);
	if (urls.length === 0) {
		throw new Error("Usage: npm run eval:live -- <https://recipe-url> [...]");
	}
	globalThis.DOMParser = new JSDOM("").window.DOMParser;
	let failed = false;
	for (const pageUrl of urls) {
		const response = await fetch(pageUrl, { redirect: "follow" });
		const html = await response.text();
		const result = await extractRecipeFromPage({
			html,
			pageUrl: response.url || pageUrl,
			httpStatus: response.status,
			ollama: null,
		});
		const candidates = result.status === "manual-fallback" ? 0 : result.candidates.length;
		process.stdout.write(`${pageUrl}\t${result.status}\t${candidates} candidate(s)\n`);
		failed ||= result.status === "manual-fallback";
	}
	if (failed) {
		process.exitCode = 1;
	}
}

void main();
