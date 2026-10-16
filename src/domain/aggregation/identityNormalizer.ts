import aliasRules from "../../../rules/v1/ingredient-aliases.json";
import qualifierRules from "../../../rules/v1/qualifier-rules.json";
import type { RecipeIngredient } from "../schema/recipeSchema";
import { collectPhrases, containsPhrase, normalizePhrase, removePhrase } from "./rulesText";

interface AliasGroup {
	id: string;
	display: string;
	names: string[];
}

interface AliasRulesFile {
	version: string;
	groups: AliasGroup[];
}

interface QualifierGroup {
	id: string;
	values: string[];
}

interface QualifierRulesFile {
	version: string;
	blocking: QualifierGroup[];
	mergeablePreparation: string[];
}

interface AliasMatch {
	id: string;
	display: string;
	phrase: string;
}

interface BlockingHit {
	group: string;
	value: string;
}

const aliases = aliasRules as AliasRulesFile;
const qualifiers = qualifierRules as QualifierRulesFile;

export const ALIAS_RULES_VERSION = aliases.version;
export const QUALIFIER_RULES_VERSION = qualifiers.version;

const aliasByPhrase = new Map<string, AliasMatch>();
for (const group of aliases.groups) {
	for (const phrase of collectPhrases(group.names)) {
		aliasByPhrase.set(phrase, { id: group.id, display: group.display, phrase });
	}
}

const blockingPhrases: BlockingHit[] = qualifiers.blocking
	.flatMap((group) => collectPhrases(group.values).map((value) => ({ group: group.id, value })))
	.sort((a, b) => b.value.length - a.value.length);

const preparationPhrases = collectPhrases(qualifiers.mergeablePreparation).sort((a, b) => b.length - a.length);

export interface IngredientIdentity {
	canonicalId: string;
	display: string;
	usedAlias: boolean;
	matchedPhrase: string | null;
	blockingKey: string;
	preparation: string | null;
}

export function resolveIngredientIdentity(ingredient: RecipeIngredient): IngredientIdentity {
	const combined = normalizePhrase(`${ingredient.name} ${ingredient.preparation ?? ""}`);
	const withoutPrep = removePhrases(combined, preparationPhrases);
	const direct = aliasByPhrase.get(withoutPrep);
	const stripped = direct ? null : removeBlocking(withoutPrep);
	const matched = direct ?? (stripped ? aliasByPhrase.get(stripped) : undefined);
	const blocking = blockingHits(normalizePhrase(`${combined} ${ingredient.raw}`)).filter(
		(hit) => !matched || !containsPhrase(matched.phrase, hit.value),
	);
	const preparation = preparationNotes(combined);
	if (matched) {
		return {
			canonicalId: matched.id,
			display: matched.display,
			usedAlias: true,
			matchedPhrase: matched.phrase,
			blockingKey: blockingSignature(blocking),
			preparation,
		};
	}
	const fallback = stripped || withoutPrep || "unknown";
	return {
		canonicalId: `name:${fallback}`,
		display: fallback,
		usedAlias: false,
		matchedPhrase: null,
		blockingKey: blockingSignature(blocking),
		preparation,
	};
}

function removePhrases(text: string, phrases: string[]): string {
	let next = text;
	for (const phrase of phrases) {
		next = removePhrase(next, phrase);
	}
	return next;
}

function removeBlocking(text: string): string {
	let next = text;
	for (const hit of blockingPhrases) {
		next = removePhrase(next, hit.value);
	}
	return next;
}

function blockingHits(text: string): BlockingHit[] {
	const found: BlockingHit[] = [];
	const seen = new Set<string>();
	for (const hit of blockingPhrases) {
		const key = `${hit.group}=${hit.value}`;
		if (seen.has(key) || !containsPhrase(text, hit.value)) {
			continue;
		}
		seen.add(key);
		found.push(hit);
	}
	return found;
}

function blockingSignature(hits: BlockingHit[]): string {
	return [...hits]
		.sort((a, b) => a.group.localeCompare(b.group) || a.value.localeCompare(b.value))
		.map((hit) => `${hit.group}=${hit.value}`)
		.join(";");
}

function preparationNotes(text: string): string | null {
	const found = preparationPhrases.filter((phrase) => containsPhrase(text, phrase));
	found.sort((a, b) => a.localeCompare(b));
	return found.length > 0 ? found.join(", ") : null;
}
