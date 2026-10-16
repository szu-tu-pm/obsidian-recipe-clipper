import type { CandidateImage, ExtractedFields } from "./types";
import { hasExtractedContent } from "./types";
import {
	absoluteHttpUrl,
	cleanIngredient,
	cleanInstruction,
	cleanText,
	parseDurationMinutes,
	uniqueStrings,
} from "./text";

type RecipeMethod = "json-ld" | "microdata";

function isRecipeType(type: unknown): boolean {
	const values = Array.isArray(type) ? type : [type];
	return values.some(
		(value) => typeof value === "string" && /(^|[/])Recipe$/i.test(value),
	);
}

function namedValue(value: unknown): string | null {
	if (typeof value === "string") {
		return cleanText(value) || null;
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return String(value);
	}
	if (Array.isArray(value)) {
		const names = uniqueStrings(
			value
				.map((item) => namedValue(item))
				.filter((item): item is string => Boolean(item)),
		);
		return names.length > 0 ? names.join(", ") : null;
	}
	if (value && typeof value === "object") {
		return namedValue((value as Record<string, unknown>).name);
	}
	return null;
}

function readLines(
	value: unknown,
	clean: (line: string) => string,
): string[] {
	const lines: string[] = [];
	const visit = (item: unknown): void => {
		if (typeof item === "string") {
			for (const line of item.split(/\n+/)) {
				const cleaned = clean(line);
				if (cleaned) {
					lines.push(cleaned);
				}
			}
			return;
		}
		if (Array.isArray(item)) {
			for (const entry of item) {
				visit(entry);
			}
			return;
		}
		if (!item || typeof item !== "object") {
			return;
		}
		const record = item as Record<string, unknown>;
		if (typeof record.text === "string") {
			visit(record.text);
			return;
		}
		if (record.itemListElement != null) {
			visit(record.itemListElement);
			return;
		}
		if (typeof record.name === "string") {
			visit(record.name);
		}
	};
	visit(value);
	return uniqueStrings(lines);
}

function readImages(value: unknown, pageUrl: string): CandidateImage[] {
	const images: CandidateImage[] = [];
	const visit = (item: unknown): void => {
		if (images.length >= 5 || item == null) {
			return;
		}
		if (typeof item === "string") {
			const sourceUrl = absoluteHttpUrl(item, pageUrl);
			if (sourceUrl) {
				images.push({ sourceUrl, alt: "" });
			}
			return;
		}
		if (Array.isArray(item)) {
			for (const entry of item) {
				visit(entry);
			}
			return;
		}
		if (typeof item !== "object") {
			return;
		}
		const record = item as Record<string, unknown>;
		const raw = record.url ?? record.contentUrl ?? record.src;
		if (typeof raw === "string") {
			const sourceUrl = absoluteHttpUrl(raw, pageUrl);
			if (sourceUrl) {
				images.push({
					sourceUrl,
					alt: namedValue(record.caption) ?? namedValue(record.name) ?? "",
				});
			}
		}
	};
	visit(value);
	return images;
}

function readUrl(node: Record<string, unknown>, pageUrl: string): string | null {
	if (typeof node.url === "string") {
		const direct = absoluteHttpUrl(node.url, pageUrl);
		if (direct) {
			return direct;
		}
	}
	const main = node.mainEntityOfPage;
	if (typeof main === "string") {
		return absoluteHttpUrl(main, pageUrl);
	}
	if (main && typeof main === "object") {
		const id = (main as Record<string, unknown>)["@id"];
		if (typeof id === "string") {
			return absoluteHttpUrl(id, pageUrl);
		}
	}
	if (typeof node["@id"] === "string") {
		return absoluteHttpUrl(node["@id"], pageUrl);
	}
	return null;
}

function firstScalar(value: unknown): string | null {
	if (Array.isArray(value)) {
		return firstScalar(value[0]);
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return String(value);
	}
	if (typeof value === "string") {
		return cleanText(value) || null;
	}
	return null;
}

function mapRecipeNode(
	node: Record<string, unknown>,
	pageUrl: string,
	extractionMethod: RecipeMethod,
): ExtractedFields | null {
	const title = typeof node.name === "string" ? cleanText(node.name) || null : namedValue(node.name);
	const ingredientsRaw = readLines(node.recipeIngredient, cleanIngredient);
	const instructions = readLines(node.recipeInstructions, cleanInstruction);
	if (!title && ingredientsRaw.length === 0 && instructions.length === 0) {
		return null;
	}
	const publisher = node.publisher ?? node.sourceOrganization;
	return {
		title,
		ingredientsRaw,
		instructions,
		servingsRaw: firstScalar(node.recipeYield ?? node.yield),
		prepTimeMinutes: parseDurationMinutes(firstScalar(node.prepTime)),
		cookTimeMinutes: parseDurationMinutes(firstScalar(node.cookTime)),
		totalTimeMinutes: parseDurationMinutes(firstScalar(node.totalTime)),
		cookingMethods: uniqueStrings(
			(Array.isArray(node.cookingMethod) ? node.cookingMethod : [node.cookingMethod])
				.filter((item): item is string => typeof item === "string")
				.map((item) => cleanText(item))
				.filter(Boolean),
		),
		author: namedValue(node.author),
		siteName: namedValue(publisher),
		sourceUrl: readUrl(node, pageUrl),
		images: readImages(node.image, pageUrl),
		extractionMethod,
	};
}

function collectJsonLdNodes(value: unknown, depth: number, out: Record<string, unknown>[]): void {
	if (depth > 8 || value == null) {
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) {
			collectJsonLdNodes(item, depth + 1, out);
		}
		return;
	}
	if (typeof value !== "object") {
		return;
	}
	const node = value as Record<string, unknown>;
	if (isRecipeType(node["@type"])) {
		out.push(node);
	}
	if ("@graph" in node) {
		collectJsonLdNodes(node["@graph"], depth + 1, out);
	}
	if ("mainEntity" in node) {
		collectJsonLdNodes(node.mainEntity, depth + 1, out);
	}
}

function parseJsonLdBlock(block: string): unknown {
	const trimmed = block
		.trim()
		.replace(/^<!--/, "")
		.replace(/-->$/, "")
		.trim();
	return JSON.parse(trimmed);
}

export function extractJsonLdRecipes(blocks: string[], pageUrl: string): ExtractedFields[] {
	const nodes: Record<string, unknown>[] = [];
	for (const block of blocks) {
		try {
			collectJsonLdNodes(parseJsonLdBlock(block), 0, nodes);
		} catch {
			// Skip malformed JSON-LD. Do not invent a recipe from it.
		}
	}
	return dedupeRecipes(
		nodes
			.map((node) => mapRecipeNode(node, pageUrl, "json-ld"))
			.filter((recipe): recipe is ExtractedFields => recipe != null && hasExtractedContent(recipe)),
	);
}

function addProp(props: Map<string, string[]>, name: string, value: string): void {
	const cleaned = cleanText(value);
	if (!cleaned) {
		return;
	}
	const current = props.get(name) ?? [];
	current.push(cleaned);
	props.set(name, current);
}

function nestedName(element: Element): string {
	return cleanText(
		element.querySelector("[itemprop='name']")?.textContent ||
			element.querySelector("[property='name']")?.textContent ||
			element.textContent ||
			"",
	);
}

function collectMicrodata(root: Element): Map<string, string[]> {
	const props = new Map<string, string[]>();
	const walk = (element: Element): void => {
		for (const child of [...element.children]) {
			if (child.hasAttribute("itemscope") && child !== root) {
				const prop = child.getAttribute("itemprop");
				if (!prop) {
					continue;
				}
				for (const name of prop.split(/\s+/)) {
					if (/^author$/i.test(name)) {
						addProp(props, "author", nestedName(child));
					} else if (/^(publisher|sourceOrganization)$/i.test(name)) {
						addProp(props, "publisher", nestedName(child));
					} else if (/^image$/i.test(name)) {
						const src =
							child.querySelector("img")?.getAttribute("src") ||
							child.getAttribute("src") ||
							child.querySelector("[itemprop='url'], [itemprop='contentUrl']")?.getAttribute("content") ||
							child.querySelector("[itemprop='url'], [itemprop='contentUrl']")?.getAttribute("href") ||
							"";
						addProp(props, "image", src);
					} else if (/^recipeInstructions$/i.test(name)) {
						addProp(
							props,
							"recipeInstructions",
							child.querySelector("[itemprop='text']")?.textContent || "",
						);
					}
				}
				continue;
			}
			const prop = child.getAttribute("itemprop");
			if (prop) {
				const tag = child.tagName.toLowerCase();
				let value = "";
				if (tag === "meta") {
					value = child.getAttribute("content") ?? "";
				} else if (tag === "time") {
					value = child.getAttribute("datetime") ?? child.textContent ?? "";
				} else if (tag === "a" || tag === "link") {
					value = child.getAttribute("href") ?? child.textContent ?? "";
				} else if (tag === "img") {
					value = child.getAttribute("src") ?? "";
				} else {
					value = child.textContent ?? "";
				}
				for (const name of prop.split(/\s+/)) {
					addProp(props, name, value);
				}
				continue;
			}
			walk(child);
		}
	};
	walk(root);
	return props;
}

function isInsideRecipeItem(element: Element): boolean {
	let parent = element.parentElement;
	while (parent) {
		if (isRecipeItemType(parent.getAttribute("itemtype"))) {
			return true;
		}
		parent = parent.parentElement;
	}
	return false;
}

function isRecipeItemType(value: string | null): boolean {
	if (!value) {
		return false;
	}
	return value.split(/\s+/).some((token) => /(^|[/])Recipe$/i.test(token));
}

function fieldsFromProps(
	props: Map<string, string[]>,
	pageUrl: string,
	method: RecipeMethod,
): ExtractedFields | null {
	const node: Record<string, unknown> = {
		name: props.get("name")?.[0] ?? null,
		recipeIngredient: props.get("recipeIngredient") ?? [],
		recipeInstructions: props.get("recipeInstructions") ?? [],
		recipeYield: props.get("recipeYield")?.[0] ?? props.get("yield")?.[0] ?? null,
		prepTime: props.get("prepTime")?.[0] ?? null,
		cookTime: props.get("cookTime")?.[0] ?? null,
		totalTime: props.get("totalTime")?.[0] ?? null,
		cookingMethod: props.get("cookingMethod") ?? [],
		author: props.get("author")?.join(", ") ?? null,
		publisher: props.get("publisher")?.[0] ?? null,
		image: props.get("image") ?? [],
		url: props.get("url")?.[0] ?? null,
	};
	return mapRecipeNode(node, pageUrl, method);
}

export function extractMicrodataRecipes(document: Document, pageUrl: string): ExtractedFields[] {
	const roots = [...document.querySelectorAll("[itemscope][itemtype]")].filter((element) =>
		isRecipeItemType(element.getAttribute("itemtype")),
	);
	const outermost = roots.filter((element) => !isInsideRecipeItem(element));
	return dedupeRecipes(
		outermost
			.map((element) => fieldsFromProps(collectMicrodata(element), pageUrl, "microdata"))
			.filter((recipe): recipe is ExtractedFields => recipe != null && hasExtractedContent(recipe)),
	);
}

function isRdfaRecipe(element: Element): boolean {
	const type = element.getAttribute("typeof");
	return isRecipeItemType(type);
}

function collectRdfa(root: Element): Map<string, string[]> {
	const props = new Map<string, string[]>();
	const walk = (element: Element): void => {
		for (const child of [...element.children]) {
			const prop = child.getAttribute("property");
			if (prop) {
				const content = child.getAttribute("content") ?? child.textContent ?? "";
				for (const name of prop.split(/\s+/)) {
					addProp(props, name, content);
				}
				continue;
			}
			if (child.hasAttribute("typeof")) {
				continue;
			}
			walk(child);
		}
	};
	walk(root);
	return props;
}

export function extractRdfaRecipes(document: Document, pageUrl: string): ExtractedFields[] {
	const roots = [...document.querySelectorAll("[typeof]")].filter((element) => isRdfaRecipe(element));
	return dedupeRecipes(
		roots
			// RDFa is structured metadata. The recipe schema has no separate rdfa method.
			.map((element) => fieldsFromProps(collectRdfa(element), pageUrl, "microdata"))
			.filter((recipe): recipe is ExtractedFields => recipe != null && hasExtractedContent(recipe)),
	);
}

export function extractStructuredRecipes(
	jsonLdBlocks: string[],
	document: Document,
	pageUrl: string,
): ExtractedFields[] {
	const jsonLd = extractJsonLdRecipes(jsonLdBlocks, pageUrl);
	if (jsonLd.length > 0) {
		return jsonLd;
	}
	const microdata = extractMicrodataRecipes(document, pageUrl);
	if (microdata.length > 0) {
		return microdata;
	}
	return extractRdfaRecipes(document, pageUrl);
}

function dedupeRecipes(recipes: ExtractedFields[]): ExtractedFields[] {
	const seen = new Set<string>();
	const result: ExtractedFields[] = [];
	for (const recipe of recipes) {
		const key = [
			cleanText(recipe.title ?? "").toLowerCase(),
			recipe.ingredientsRaw.join("|").toLowerCase(),
			recipe.instructions.join("|").toLowerCase(),
		].join("::");
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		result.push(recipe);
	}
	return result;
}
