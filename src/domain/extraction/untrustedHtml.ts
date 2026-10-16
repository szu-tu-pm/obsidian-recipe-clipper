import { cleanText } from "./text";

export interface ParsedHtml {
	document: Document;
	jsonLdBlocks: string[];
	hasVideoEmbed: boolean;
}

/**
 * Parse webpage HTML as data. JSON-LD blocks are copied out as text, then
 * scripts, frames, and event-handler attributes are removed. Nothing is evaluated.
 */
export function parseUntrustedHtml(html: string): ParsedHtml {
	if (typeof DOMParser === "undefined") {
		throw new Error("DOMParser is not available in this runtime.");
	}
	const document = new DOMParser().parseFromString(html, "text/html");
	const hasVideoEmbed = Boolean(
		document.querySelector(
			"video, iframe[src*='youtube'], iframe[src*='youtu.be'], iframe[src*='vimeo'], iframe[src*='tiktok']",
		),
	);
	const jsonLdBlocks: string[] = [];
	for (const script of [...document.querySelectorAll("script")]) {
		const type = (script.getAttribute("type") || "").toLowerCase();
		if (type.includes("ld+json")) {
			const text = script.textContent ?? "";
			if (text.length > 0 && text.length <= 500_000) {
				jsonLdBlocks.push(text);
			}
		}
		script.remove();
	}
	for (const frame of [...document.querySelectorAll("iframe, object, embed, frame")]) {
		frame.remove();
	}
	for (const element of [...document.querySelectorAll("*")]) {
		for (const attr of [...element.attributes]) {
			const name = attr.name.toLowerCase();
			if (name.startsWith("on") || name === "srcdoc") {
				element.removeAttribute(attr.name);
				continue;
			}
			if (
				(name === "href" || name === "src" || name === "xlink:href") &&
				/^\s*javascript:/i.test(attr.value)
			) {
				element.removeAttribute(attr.name);
			}
		}
	}
	return { document, jsonLdBlocks, hasVideoEmbed };
}

export function pageText(document: Document): string {
	const title = cleanText(document.title || "");
	const article = document.querySelector("article");
	const articleText = cleanText(article?.textContent ?? "");
	const bodyText = cleanText(document.body?.textContent ?? "");
	const mainText = articleText.length >= 200 ? articleText : bodyText;
	return [title, mainText].filter(Boolean).join("\n").slice(0, 20_000);
}

export function elementText(element: Element | null | undefined): string {
	return cleanText(element?.textContent ?? "");
}

export function isInSiteChrome(element: Element): boolean {
	return Boolean(element.closest("nav, header, footer, aside"));
}
