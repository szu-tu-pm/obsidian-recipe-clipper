import { normalizeVulgarFractions, parseIngredientLine } from "../aggregation/stage1LexicalParser";
import type { RecipeDocument } from "../schema/recipeSchema";
import { cleanText } from "./text";

/**
 * One ingredient where a page's structured data and its visible list say different things.
 * `structured` is null for a line only the visible list has; `visible` is null for a line
 * only the structured data has. `index` is the line's place in the structured list, or null
 * for a visible-only line.
 */
export interface IngredientDisagreement {
	index: number | null;
	structured: string | null;
	visible: string | null;
}

export type IngredientChoice = "structured" | "visible";

/**
 * Reduce a line to the words that carry its meaning, so the comparison ignores case,
 * whitespace, brackets, punctuation, unicode fractions and a trailing "plus more ..." note.
 */
export function normalizeIngredientForComparison(line: string): string {
	return cleanText(
		normalizeVulgarFractions(line).normalize("NFKC").toLowerCase()
			.replace(/\bplus (?:more|extra)\b.*$/u, " ")
			.replace(/[‐-―−]/gu, "-")
			.replace(/[()[\]{}]/gu, " ")
			.replace(/[,;:!?"'*•]/gu, " ")
			.replace(/(?<!\d)\.|\.(?!\d)/gu, " "),
	);
}

/** Words of a line without its numbers, so "2 cups sugar" and "1 cup sugar" still look related. */
function words(normalized: string): Set<string> {
	return new Set(normalized.split(" ").filter((word) => word && !/^[\d/.-]+$/u.test(word)));
}

/** Share of the shorter line's words that the other line also has. */
function overlap(a: Set<string>, b: Set<string>): number {
	const shorter = Math.min(a.size, b.size);
	if (shorter === 0) {
		return 0;
	}
	let shared = 0;
	for (const word of a) {
		if (b.has(word)) {
			shared += 1;
		}
	}
	return shared / shorter;
}

/** Two unmatched lines are shown side by side only when they plausibly describe one ingredient. */
const PAIR_THRESHOLD = 0.5;

/**
 * Compare a page's structured ingredient list with its visible one. Lines that match after
 * normalizing are agreement and are not reported. Each remaining structured line is paired
 * with the most similar remaining visible line so the reviewer sees both versions.
 */
export function compareIngredientLists(
	structured: string[],
	visible: string[],
): IngredientDisagreement[] {
	if (structured.length === 0 || visible.length === 0) {
		return [];
	}
	const remainingVisible = visible.map((text) => ({ text, normalized: normalizeIngredientForComparison(text) }));
	const unmatched: { index: number; text: string; normalized: string }[] = [];
	structured.forEach((text, index) => {
		const normalized = normalizeIngredientForComparison(text);
		const hit = remainingVisible.findIndex((item) => item.normalized === normalized);
		if (hit >= 0) {
			remainingVisible.splice(hit, 1);
			return;
		}
		unmatched.push({ index, text, normalized });
	});

	const result: IngredientDisagreement[] = [];
	for (const line of unmatched) {
		const lineWords = words(line.normalized);
		let best = -1;
		let bestScore = 0;
		remainingVisible.forEach((item, position) => {
			const score = overlap(lineWords, words(item.normalized));
			if (score > bestScore) {
				best = position;
				bestScore = score;
			}
		});
		if (best >= 0 && bestScore >= PAIR_THRESHOLD) {
			const [paired] = remainingVisible.splice(best, 1);
			result.push({ index: line.index, structured: line.text, visible: paired?.text ?? null });
		} else {
			result.push({ index: line.index, structured: line.text, visible: null });
		}
	}
	for (const item of remainingVisible) {
		result.push({ index: null, structured: null, visible: item.text });
	}
	return result;
}

/**
 * Apply the reviewer's picks to a draft. Without a pick a line keeps the structured text,
 * and a visible-only line is left out. Picking "visible" on a structured-only line removes it, so nothing is replaced unless the reviewer chose it.
 */
export function applyIngredientChoices(
	draft: RecipeDocument,
	disagreements: IngredientDisagreement[],
	choices: ReadonlyMap<IngredientDisagreement, IngredientChoice>,
): RecipeDocument {
	const ingredients = [...draft.frontmatter.ingredients];
	const additions = [];
	const removals = new Set<number>();
	for (const item of disagreements) {
		if (choices.get(item) !== "visible") {
			continue;
		}
		if (item.visible == null) {
			// The visible page has no such line, so choosing it removes the structured one.
			if (item.index != null) {
				removals.add(item.index);
			}
			continue;
		}
		const parsed = parseIngredientLine(item.visible);
		if (item.index == null) {
			additions.push(parsed);
		} else if (ingredients[item.index]) {
			ingredients[item.index] = parsed;
		}
	}
	return {
		...draft,
		frontmatter: {
			...draft.frontmatter,
			ingredients: [...ingredients.filter((_, position) => !removals.has(position)), ...additions],
		},
	};
}
