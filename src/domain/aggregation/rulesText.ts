/**
 * Fold accents, lowercase, treat hyphens as spaces, and collapse punctuation
 * so rule lookup stays stable for words like jalapeño and crème fraîche.
 */
export function normalizePhrase(value: string): string {
	const folded = value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
	return folded
		.toLowerCase()
		.replace(/-/g, " ")
		.replace(/[^\p{L}\p{N}\s]/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function containsPhrase(text: string, phrase: string): boolean {
	if (!phrase) {
		return false;
	}
	return ` ${text} `.includes(` ${phrase} `);
}

/** Drop blank entries so a missing rule cannot become an identity that matches everything. */
export function collectPhrases(values: string[]): string[] {
	const phrases: string[] = [];
	for (const value of values) {
		const phrase = normalizePhrase(value);
		if (!phrase) {
			continue;
		}
		phrases.push(phrase);
	}
	return phrases;
}

export function removePhrase(text: string, phrase: string): string {
	if (!phrase) {
		return text;
	}
	let next = ` ${text} `;
	const needle = ` ${phrase} `;
	while (next.includes(needle)) {
		next = next.replace(needle, " ");
	}
	return next.replace(/\s+/g, " ").trim();
}
