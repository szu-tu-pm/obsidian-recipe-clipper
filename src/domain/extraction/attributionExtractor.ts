import type { Attribution, ExtractedFields } from "./types";
import { absoluteHttpUrl, cleanText } from "./text";
import { elementText, isInSiteChrome } from "./untrustedHtml";

const BYLINE_SELECTORS = [
	"[rel='author']",
	".wprm-recipe-author",
	".tasty-recipes-author-name",
	".tasty-recipes-author",
	".mv-create-author",
	".byline a",
	".byline",
	"[itemprop='author']",
];

function metaContent(document: Document, selector: string): string | null {
	const value = document.querySelector(selector)?.getAttribute("content");
	return value ? cleanText(value) || null : null;
}

function firstHttp(values: Array<string | null | undefined>, base: string): string | null {
	for (const value of values) {
		if (!value) {
			continue;
		}
		const url = absoluteHttpUrl(value, base);
		if (url) {
			return url;
		}
	}
	return null;
}

function byline(document: Document): string | null {
	for (const selector of BYLINE_SELECTORS) {
		for (const element of [...document.querySelectorAll(selector)]) {
			if (isInSiteChrome(element)) {
				continue;
			}
			const text = elementText(element);
			if (text && text.length <= 80) {
				return text;
			}
		}
	}
	return null;
}

export function extractAttribution(
	document: Document,
	pageUrl: string,
	structured: ExtractedFields | null,
	ollama: { author: string | null; siteName: string | null } | null,
): Attribution {
	const sourceUrl = firstHttp(
		[
			structured?.sourceUrl,
			metaContent(document, "meta[property='og:url']"),
			document.querySelector("link[rel='canonical']")?.getAttribute("href"),
			pageUrl,
		],
		pageUrl,
	);
	const author =
		structured?.author ||
		metaContent(document, "meta[name='author']") ||
		metaContent(document, "meta[property='article:author']") ||
		byline(document) ||
		ollama?.author ||
		null;
	const siteName =
		structured?.siteName ||
		metaContent(document, "meta[property='og:site_name']") ||
		metaContent(document, "meta[name='application-name']") ||
		ollama?.siteName ||
		null;
	return { sourceUrl, author, siteName };
}

export function formatSourceAttribution(attribution: Attribution): string | null {
	if (!attribution.sourceUrl && !attribution.siteName && !attribution.author) {
		return null;
	}
	const site = attribution.siteName || "Source";
	const url = attribution.sourceUrl || "";
	const author = attribution.author || "Unknown";
	return `> Source: [${site}](${url}) by ${author}`;
}
