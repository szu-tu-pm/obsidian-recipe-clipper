import type { RecipeIngredient } from "../schema/recipeSchema";
import {
	ALIAS_RULES_VERSION,
	QUALIFIER_RULES_VERSION,
	resolveIngredientIdentity,
} from "./identityNormalizer";
import { canonicalizeMeasure, UNIT_RULES_VERSION, type CanonicalMeasure } from "./unitNormalizer";

export interface AggregateSource {
	recipeId: string;
	ingredient: RecipeIngredient;
}

export interface AggregateSourceRef {
	recipeId: string;
	ingredientId: string;
}

export interface AggregatedIngredient {
	canonicalId: string;
	name: string;
	quantity: number | null;
	quantityMax: number | null;
	unit: string | null;
	dimension: string | null;
	preparation: string | null;
	mergeRuleId: string;
	mergeReason: string;
	rulesVersion: string;
	sourceRefs: AggregateSourceRef[];
}

interface PreparedIngredient {
	source: AggregateSource;
	canonicalId: string;
	name: string;
	measure: CanonicalMeasure | null;
	blockingKey: string;
	preparation: string | null;
	usedAlias: boolean;
	refusal: "non-numeric" | "unsupported-unit" | null;
	mergeKey: string;
}

export function sharedRulesVersion(...versions: string[]): string {
	const [first] = versions;
	if (!first || versions.some((version) => version !== first)) {
		throw new Error("Ingredient rule files must share one version.");
	}
	return first;
}

export const RULES_VERSION = sharedRulesVersion(
	UNIT_RULES_VERSION,
	ALIAS_RULES_VERSION,
	QUALIFIER_RULES_VERSION,
);

export function aggregateIngredients(sources: AggregateSource[]): AggregatedIngredient[] {
	const prepared = sources.map(prepareIngredient);
	const groups = new Map<string, PreparedIngredient[]>();
	for (const item of prepared) {
		const list = groups.get(item.mergeKey) ?? [];
		list.push(item);
		groups.set(item.mergeKey, list);
	}

	const siblings = new Map<string, PreparedIngredient[][]>();
	for (const list of groups.values()) {
		if (list[0]?.refusal) {
			continue;
		}
		const key = list[0].canonicalId;
		const related = siblings.get(key) ?? [];
		related.push(list);
		siblings.set(key, related);
	}

	const aggregated = [...groups.values()].map((list) =>
		toAggregate(list, siblings.get(list[0].canonicalId) ?? []),
	);
	aggregated.sort((a, b) => {
		const byName = a.name.localeCompare(b.name);
		if (byName !== 0) {
			return byName;
		}
		const byUnit = (a.unit ?? "").localeCompare(b.unit ?? "");
		if (byUnit !== 0) {
			return byUnit;
		}
		return a.canonicalId.localeCompare(b.canonicalId);
	});
	return aggregated;
}

function prepareIngredient(source: AggregateSource): PreparedIngredient {
	const identity = resolveIngredientIdentity(source.ingredient);
	const { quantity, quantityMax, unit } = source.ingredient;
	const measure = canonicalizeMeasure(unit, quantity, quantityMax);
	const refusal = refusalFor(quantity, measure);
	const mergeKey = refusal
		? `solo:${source.ingredient.id}`
		: [identity.canonicalId, measure?.dimension, measure?.unit, identity.blockingKey].join("|");
	return {
		source,
		canonicalId: identity.canonicalId,
		name: identity.display,
		measure: refusal ? null : measure,
		blockingKey: identity.blockingKey,
		preparation: identity.preparation,
		usedAlias: identity.usedAlias,
		refusal,
		mergeKey,
	};
}

function refusalFor(
	quantity: number | null,
	measure: CanonicalMeasure | null,
): PreparedIngredient["refusal"] {
	if (quantity == null || !Number.isFinite(quantity) || quantity <= 0) {
		return "non-numeric";
	}
	if (!measure) {
		return "unsupported-unit";
	}
	return null;
}

function toAggregate(
	list: PreparedIngredient[],
	related: PreparedIngredient[][],
): AggregatedIngredient {
	const first = list[0];
	const sourceRefs = list
		.map((item) => ({
			recipeId: item.source.recipeId,
			ingredientId: item.source.ingredient.id,
		}))
		.sort((a, b) => a.recipeId.localeCompare(b.recipeId) || a.ingredientId.localeCompare(b.ingredientId));
	const preparation = uniquePreparations(list);
	const decision = decisionFor(list, related);
	if (first.refusal) {
		return {
			canonicalId: first.canonicalId,
			name: first.name,
			quantity: first.source.ingredient.quantity,
			quantityMax: first.source.ingredient.quantityMax,
			unit: first.source.ingredient.unit,
			dimension: null,
			preparation,
			mergeRuleId: decision.mergeRuleId,
			mergeReason: decision.mergeReason,
			rulesVersion: RULES_VERSION,
			sourceRefs,
		};
	}

	// Entries that share a merge key already have a canonical measure.
	const measure = first.measure as CanonicalMeasure;
	const measures = list.map((item) => item.measure as CanonicalMeasure);
	const hasRange = measures.some((measure) => measure.quantityMax != null);
	return {
		canonicalId: first.canonicalId,
		name: first.name,
		quantity: measures.reduce((sum, measure) => sum + measure.quantity, 0),
		quantityMax: hasRange
			? measures.reduce((sum, measure) => sum + (measure.quantityMax ?? measure.quantity), 0)
			: null,
		unit: measure.unit,
		dimension: measure.dimension,
		preparation,
		mergeRuleId: decision.mergeRuleId,
		mergeReason: decision.mergeReason,
		rulesVersion: RULES_VERSION,
		sourceRefs,
	};
}

function decisionFor(
	list: PreparedIngredient[],
	related: PreparedIngredient[][],
): { mergeRuleId: string; mergeReason: string } {
	const refusal = list[0].refusal;
	if (refusal === "non-numeric") {
		return {
			mergeRuleId: `${RULES_VERSION}.keep-separate`,
			mergeReason: "Non-numeric quantity; entries were not merged.",
		};
	}
	if (refusal === "unsupported-unit") {
		return {
			mergeRuleId: `${RULES_VERSION}.keep-separate`,
			mergeReason: "Unsupported unit; entries were not merged.",
		};
	}
	if (list.length > 1) {
		const usedAlias = list.some((item) => item.usedAlias);
		return {
			mergeRuleId: usedAlias ? `${RULES_VERSION}.merge-alias` : `${RULES_VERSION}.merge-same-dimension`,
			mergeReason: usedAlias
				? "Alias and compatible units were summed in the canonical unit."
				: "Compatible units were summed in the canonical unit.",
		};
	}
	if (related.length > 1) {
		return {
			mergeRuleId: `${RULES_VERSION}.keep-separate`,
			mergeReason: conflictReason(related),
		};
	}
	return {
		mergeRuleId: `${RULES_VERSION}.no-merge`,
		mergeReason: "No compatible ingredient to merge.",
	};
}

function conflictReason(related: PreparedIngredient[][]): string {
	const measures = related.flat().map((item) => item.measure as CanonicalMeasure);
	const dimensions = new Set(measures.map((measure) => measure.dimension));
	if (dimensions.size > 1) {
		return "Cross-dimension conversion is not allowed.";
	}
	const units = new Set(measures.map((measure) => measure.unit));
	if (units.size > 1) {
		return "These units are not interchangeable.";
	}
	return "Blocking qualifiers do not match.";
}

function uniquePreparations(list: PreparedIngredient[]): string | null {
	const notes = new Set<string>();
	for (const item of list) {
		for (const note of (item.preparation ?? "").split(", ")) {
			if (note) {
				notes.add(note);
			}
		}
	}
	const sorted = [...notes].sort((a, b) => a.localeCompare(b));
	return sorted.length > 0 ? sorted.join(", ") : null;
}
