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
	compoundUnits: CompoundUnitRule[];
}

interface CompoundUnitRule {
	containerUnitId: string;
	descriptorUnitIds?: string[];
	descriptorAliases?: string[];
	multiplyByDescriptor: boolean;
}

const rules = unitRules as UnitRulesFile;

export const UNIT_RULES_VERSION = rules.version;

const byAlias = new Map<string, UnitRule>();
const byId = new Map<string, UnitRule>();
for (const unit of rules.units) {
	byId.set(unit.id, unit);
	for (const alias of collectPhrases([unit.id, ...unit.aliases])) {
		byAlias.set(alias, unit);
	}
}

const COMPOUND_UNIT = /^(\d+(?:\.\d+)?|\d+\/\d+|\d+\s+\d+\/\d+)(?:\s*-\s*|\s+)([a-z]+)\s+([a-z]+)$/i;

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
	const compound = canonicalizeCompoundUnit(unit, quantity, quantityMaxCanonical);
	if (compound) {
		return compound;
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

function canonicalizeCompoundUnit(
	unit: string,
	quantity: number,
	quantityMax: number | null,
): CanonicalMeasure | null {
	const compoundText = unit
		.trim()
		.toLowerCase()
		.replace(/([a-z])\./g, "$1")
		.replace(/\s+/g, " ");
	const match = compoundText.match(COMPOUND_UNIT);
	if (!match) {
		return null;
	}
	const descriptorQuantity = parseCompoundQuantity(match[1]);
	if (!Number.isFinite(descriptorQuantity) || descriptorQuantity <= 0) {
		return null;
	}
	const descriptor = normalizePhrase(match[2]);
	const container = normalizePhrase(match[3]);
	for (const compoundRule of rules.compoundUnits) {
		const containerRule = byId.get(compoundRule.containerUnitId);
		if (!containerRule || !collectPhrases([containerRule.id, ...containerRule.aliases]).includes(container)) {
			continue;
		}
		if (!compoundRule.multiplyByDescriptor) {
			const descriptors = collectPhrases(compoundRule.descriptorAliases ?? []);
			if (!descriptors.includes(descriptor)) {
				continue;
			}
			return {
				dimension: containerRule.dimension,
				unit: containerRule.canonical,
				quantity: quantity * containerRule.factor,
				quantityMax: quantityMax == null ? null : quantityMax * containerRule.factor,
			};
		}
		for (const descriptorUnitId of compoundRule.descriptorUnitIds ?? []) {
			const descriptorRule = byId.get(descriptorUnitId);
			if (!descriptorRule || !collectPhrases([descriptorRule.id, ...descriptorRule.aliases]).includes(descriptor)) {
				continue;
			}
			return {
				dimension: descriptorRule.dimension,
				unit: descriptorRule.canonical,
				quantity: quantity * descriptorQuantity * descriptorRule.factor,
				quantityMax: quantityMax == null
					? null
					: quantityMax * descriptorQuantity * descriptorRule.factor,
			};
		}
	}
	return null;
}

function parseCompoundQuantity(text: string): number {
	const mixed = text.match(/^(\d+)\s+(\d+)\/(\d+)$/);
	if (mixed) {
		return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
	}
	const fraction = text.match(/^(\d+)\/(\d+)$/);
	if (fraction) {
		return Number(fraction[1]) / Number(fraction[2]);
	}
	return Number(text);
}
