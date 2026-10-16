import type { ExtractedFields } from "./types";
import { hasExtractedContent } from "./types";
import {
	absoluteHttpUrl,
	cleanIngredient,
	cleanInstruction,
	cleanText,
	parseDurationMinutes,
	uniqueStrings,
} from "./text";
import { elementText, isInSiteChrome } from "./untrustedHtml";

interface CardSelectors {
	title: string;
	ingredients: string;
	instructions: string;
	author: string;
	servings: string;
	prep: string;
	cook: string;
	total: string;
	image: string;
}

const WPRM: CardSelectors = {
	title: ".wprm-recipe-name",
	ingredients: "li.wprm-recipe-ingredient",
	instructions: "li.wprm-recipe-instruction",
	author: ".wprm-recipe-author",
	servings: ".wprm-recipe-servings",
	prep: ".wprm-recipe-prep_time, .wprm-recipe-prep-time",
	cook: ".wprm-recipe-cook_time, .wprm-recipe-cook-time",
	total: ".wprm-recipe-total_time, .wprm-recipe-total-time",
	image: ".wprm-recipe-image img, img.wprm-recipe-image",
};

const TASTY: CardSelectors = {
	title: ".tasty-recipes-title",
	ingredients: ".tasty-recipes-ingredients li, .tasty-recipes-ingredients-body li",
	instructions: ".tasty-recipes-instructions li, .tasty-recipes-instructions-body li",
	author: ".tasty-recipes-author-name, .tasty-recipes-author",
	servings: ".tasty-recipes-yield",
	prep: ".tasty-recipes-prep-time",
	cook: ".tasty-recipes-cook-time",
	total: ".tasty-recipes-total-time",
	image: ".tasty-recipes-image img",
};

const MEDIAVINE: CardSelectors = {
	title: ".mv-create-title",
	ingredients: ".mv-create-ingredients li",
	instructions: ".mv-create-instructions li",
	author: ".mv-create-author",
	servings: ".mv-create-servings, .mv-create-yield",
	prep: ".mv-create-time-prep",
	cook: ".mv-create-time-cook",
	total: ".mv-create-time-total",
	image: ".mv-create-image img",
};

function outermost(document: Document, selector: string): Element[] {
	return [...document.querySelectorAll(selector)].filter(
		(element) => !element.parentElement?.closest(selector),
	);
}

function minuteValue(element: Element | null): number | null {
	if (!element) {
		return null;
	}
	const candidates = [element, ...[...element.querySelectorAll("time, [class*='minute']")]];
	for (const candidate of candidates) {
		const datetime = candidate.getAttribute("datetime");
		if (datetime) {
			const fromClock = parseDurationMinutes(datetime);
			if (fromClock != null) {
				return fromClock;
			}
		}
		const text = elementText(candidate);
		const parsed = parseDurationMinutes(text);
		if (parsed != null) {
			return parsed;
		}
		if (/minutes?/i.test(candidate.className) && /^\d+$/.test(text)) {
			return Number(text);
		}
	}
	return null;
}

function cardImages(root: Element, selector: string, pageUrl: string) {
	const images = [];
	for (const image of [...root.querySelectorAll(selector)].slice(0, 5)) {
		const src = image.getAttribute("src");
		if (!src) {
			continue;
		}
		const sourceUrl = absoluteHttpUrl(src, pageUrl);
		if (!sourceUrl) {
			continue;
		}
		images.push({ sourceUrl, alt: image.getAttribute("alt")?.trim() ?? "" });
	}
	return images;
}

function fromCard(root: Element, selectors: CardSelectors, pageUrl: string): ExtractedFields | null {
	const ingredientsRaw = uniqueStrings(
		[...root.querySelectorAll(selectors.ingredients)]
			.filter((element) => !isInSiteChrome(element))
			.map((element) => cleanIngredient(element.textContent ?? ""))
			.filter(Boolean),
	);
	const instructions = uniqueStrings(
		[...root.querySelectorAll(selectors.instructions)]
			.filter((element) => !isInSiteChrome(element))
			.map((element) => cleanInstruction(element.textContent ?? ""))
			.filter(Boolean),
	);
	if (ingredientsRaw.length === 0 && instructions.length === 0) {
		return null;
	}
	const title = elementText(root.querySelector(selectors.title)) || null;
	return {
		title,
		ingredientsRaw,
		instructions,
		servingsRaw: elementText(root.querySelector(selectors.servings)) || null,
		prepTimeMinutes: minuteValue(root.querySelector(selectors.prep)),
		cookTimeMinutes: minuteValue(root.querySelector(selectors.cook)),
		totalTimeMinutes: minuteValue(root.querySelector(selectors.total)),
		cookingMethods: [],
		author: elementText(root.querySelector(selectors.author)) || null,
		siteName: null,
		sourceUrl: null,
		images: cardImages(root, selectors.image, pageUrl),
		extractionMethod: "dom-heuristic",
	};
}

function headingKind(element: Element): "ingredients" | "instructions" | "title" | null {
	if (isInSiteChrome(element)) {
		return null;
	}
	const text = elementText(element);
	if (!text || text.length > 48) {
		return null;
	}
	const tag = element.tagName.toLowerCase();
	if (tag === "h1") {
		return "title";
	}
	const headingLike =
		/^h[2-6]$/.test(tag) ||
		((tag === "p" || tag === "strong" || tag === "b") && element.children.length === 0);
	if (!headingLike) {
		return null;
	}
	if (/^ingredients?\b/i.test(text)) {
		return "ingredients";
	}
	if (/^(instructions?|directions?|method|steps|preparation)\b/i.test(text)) {
		return "instructions";
	}
	return null;
}

interface HeadingRecipe {
	title: string | null;
	ingredientsRaw: string[];
	instructions: string[];
}

function extractHeadingRecipes(document: Document): HeadingRecipe[] {
	const recipes: HeadingRecipe[] = [];
	let current: HeadingRecipe | null = null;
	let mode: "ingredients" | "instructions" | null = null;
	let title: string | null = elementText(document.querySelector("h1")) || null;

	const flush = (): void => {
		if (current && (current.ingredientsRaw.length > 0 || current.instructions.length > 0)) {
			recipes.push(current);
		}
		current = null;
		mode = null;
	};

	const elements = [...document.body.querySelectorAll("h1, h2, h3, h4, h5, h6, p, strong, b, li")];
	for (const element of elements) {
		if (element.tagName.toLowerCase() === "li") {
			if (!current || !mode || isInSiteChrome(element) || element.querySelector("li")) {
				continue;
			}
			const line =
				mode === "ingredients"
					? cleanIngredient(element.textContent ?? "")
					: cleanInstruction(element.textContent ?? "");
			if (!line) {
				continue;
			}
			const bucket = mode === "ingredients" ? current.ingredientsRaw : current.instructions;
			if (!bucket.includes(line)) {
				bucket.push(line);
			}
			continue;
		}
		const kind = headingKind(element);
		if (kind === "title") {
			title = elementText(element) || title;
			continue;
		}
		if (kind === "ingredients") {
			if (current && current.ingredientsRaw.length > 0) {
				flush();
			}
			current ??= { title, ingredientsRaw: [], instructions: [] };
			mode = "ingredients";
			continue;
		}
		if (kind === "instructions") {
			current ??= { title, ingredientsRaw: [], instructions: [] };
			mode = "instructions";
		}
	}
	flush();
	return recipes;
}

function ogImage(document: Document, pageUrl: string) {
	const content = document.querySelector("meta[property='og:image']")?.getAttribute("content");
	if (!content) {
		return [];
	}
	const sourceUrl = absoluteHttpUrl(content, pageUrl);
	return sourceUrl ? [{ sourceUrl, alt: "" }] : [];
}

export function extractDomHeuristicRecipes(document: Document, pageUrl: string): ExtractedFields[] {
	const cards = [
		...outermost(document, ".wprm-recipe").map((element) => fromCard(element, WPRM, pageUrl)),
		...outermost(document, ".tasty-recipes").map((element) => fromCard(element, TASTY, pageUrl)),
		...outermost(document, ".mv-create-card").map((element) => fromCard(element, MEDIAVINE, pageUrl)),
	].filter((recipe): recipe is ExtractedFields => recipe != null);
	if (cards.length > 0) {
		return cards;
	}

	const images = ogImage(document, pageUrl);
	return extractHeadingRecipes(document)
		.filter((recipe) => hasExtractedContent(recipe))
		.map((recipe) => ({
			title: recipe.title,
			ingredientsRaw: recipe.ingredientsRaw,
			instructions: recipe.instructions,
			servingsRaw: null,
			prepTimeMinutes: null,
			cookTimeMinutes: null,
			totalTimeMinutes: null,
			cookingMethods: [],
			author: null,
			siteName: null,
			sourceUrl: null,
			images,
			extractionMethod: "dom-heuristic" as const,
		}));
}
