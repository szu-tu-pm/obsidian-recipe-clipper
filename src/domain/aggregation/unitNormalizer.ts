import unitRules from "../../../rules/v1/unit-rules.json";
import { normalizeUnit } from "./stage1LexicalParser";
import { collectPhrases, normalizePhrase } from "./rulesText";

interface UnitRule {
	id: string;
	dimension: string;
	canonical: string;
	factor: number;
	aliases: string[];
}

interface UnitRulesFile {
	version: string;
	units: UnitRule[];
}

const rules = unitRules as UnitRulesFile;

export const UNIT_RULES_VERSION = rules.version;

const byAlias = new Map<string, UnitRule>();
for (const unit of rules.units) {
	for (const alias of collectPhrases([unit.id, ...unit.aliases])) {
		byAlias.set(alias, unit);
	}
}

export interface CanonicalMeasure {
	dimension: string;
	unit: string;
	quantity: number;
	quantityMax: number | null;
}

export function lookupUnit(unit: string | null): UnitRule | null {
	if (!unit) {
		return null;
	}
	const normalized = normalizeUnit(unit);
	if (!normalized) {
		return null;
	}
	return byAlias.get(normalizePhrase(normalized)) ?? null;
}

/**
 * Convert a quantity into the canonical unit of its own dimension.
 * A missing unit with a real quantity is a count of pieces.
 * Unknown units and cross-dimension pairs return null so the aggregator cannot sum them.
 */
export function canonicalizeMeasure(
	unit: string | null,
	quantity: number | null,
	quantityMax: number | null,
): CanonicalMeasure | null {
	if (quantity == null || !Number.isFinite(quantity) || quantity <= 0) {
		return null;
	}
	const quantityMaxCanonical =
		quantityMax != null && Number.isFinite(quantityMax) ? quantityMax : null;
	if (!unit) {
		return {
			dimension: "count",
			unit: "piece",
			quantity,
			quantityMax: quantityMaxCanonical,
		};
	}
	const rule = lookupUnit(unit);
	if (!rule) {
		return null;
	}
	return {
		dimension: rule.dimension,
		unit: rule.canonical,
		quantity: quantity * rule.factor,
		quantityMax: quantityMaxCanonical == null ? null : quantityMaxCanonical * rule.factor,
	};
}
