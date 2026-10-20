import { parseIngredient } from "@jlucaspains/sharp-recipe-parser";
import {
	generateIngredientId,
	type ParseConfidence,
	type RecipeIngredient,
	type UnitSystem,
} from "../schema/recipeSchema";

export type { ParseConfidence };

const VULGAR_FRACTIONS: Record<string, string> = {
	"¼": "1/4",
	"½": "1/2",
	"¾": "3/4",
	"⅓": "1/3",
	"⅔": "2/3",
	"⅕": "1/5",
	"⅖": "2/5",
	"⅗": "3/5",
	"⅘": "4/5",
	"⅙": "1/6",
	"⅚": "5/6",
	"⅐": "1/7",
	"⅛": "1/8",
	"⅜": "3/8",
	"⅝": "5/8",
	"⅞": "7/8",
	"⅑": "1/9",
	"⅒": "1/10",
};

const NON_NUMERIC_PATTERNS = [
	/\bto taste\b/i,
	/\bas needed\b/i,
	/\bas desired\b/i,
	/\ba pinch\b/i,
	/\ba handful\b/i,
	/\ba dash\b/i,
	/\ba sprinkle\b/i,
];

const METRIC_UNITS = new Set([
	"g",
	"gram",
	"grams",
	"kg",
	"kilogram",
	"kilograms",
	"mg",
	"milligram",
	"milligrams",
	"ml",
	"milliliter",
	"millilitre",
	"milliliters",
	"millilitres",
	"l",
	"liter",
	"litre",
	"cl",
	"dl",
]);

const IMPERIAL_UNITS = new Set([
	"cup",
	"cups",
	"tbsp",
	"tablespoon",
	"tablespoons",
	"tsp",
	"teaspoon",
	"teaspoons",
	"oz",
	"ounce",
	"ounces",
	"lb",
	"pound",
	"pounds",
	"pint",
	"pints",
	"quart",
	"quarts",
	"gallon",
	"gallons",
	"stick",
	"sticks",
	"fl oz",
	"fluid ounce",
	"fluid ounces",
]);

const UNIT_ALIASES: Record<string, string> = {
	c: "cup",
	floz: "fl oz",
};

const QUANTITY_PART = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)`;
const LEADING_QUANTITY = new RegExp(
	String.raw`^\s*(${QUANTITY_PART})(?:\s*(?:-|to|or)\s*(${QUANTITY_PART}))?`,
	"i",
);
const CUSTOM_UNIT_AFTER_QUANTITY = new RegExp(
	String.raw`^(\s*${QUANTITY_PART}(?:\s*(?:-|to|or)\s*${QUANTITY_PART})?\s+)(fl(?:\.\s*|\s+)oz\.?|fluid\s+ounces?|sprigs?|heads?|handfuls?|wedges?|scoops?)(?=\s+\S)`,
	"i",
);

const PACKAGE_SIZE_UNIT = String.raw`(?:g|grams?|kg|kilograms?|oz\.?|ounces?|lb|lbs|pounds?)`;
const PACKAGE_CONTAINER = String.raw`(?:cans?)`;
const PARENTHESIZED_PACKAGE = new RegExp(
	String.raw`^\s*(${QUANTITY_PART})\s+\(\s*(${QUANTITY_PART})\s+(${PACKAGE_SIZE_UNIT})\s*\)\s+(${PACKAGE_CONTAINER})\s+(.+)$`,
	"i",
);
const HYPHENATED_PACKAGE = new RegExp(
	String.raw`^\s*(${QUANTITY_PART})\s+(${QUANTITY_PART})-(${PACKAGE_SIZE_UNIT})\s+(${PACKAGE_CONTAINER})\s+(.+)$`,
	"i",
);
const UNPARENTHESIZED_PACKAGE = new RegExp(
	String.raw`^\s*(${QUANTITY_PART})\s+(${QUANTITY_PART})\s+(${PACKAGE_SIZE_UNIT})\s+(${PACKAGE_CONTAINER})\s+(.+)$`,
	"i",
);
const HYPHENATED_PIECE = new RegExp(
	String.raw`^\s*(?:a|an|one)\s+(${QUANTITY_PART})-(inch|inches)\s+(piece)\s+of\s+(.+)$`,
	"i",
);

const DUAL_UNIT_PAREN = /^\s*[\d./\s-]+\s*[a-zA-Zµμ.]+\s*$/;

export function normalizeVulgarFractions(text: string): string {
	const symbols = Object.keys(VULGAR_FRACTIONS).join("");
	return text.replace(new RegExp(String.raw`(\d)?([${symbols}])`, "gu"), (_match, whole: string | undefined, symbol: string) =>
		`${whole ? `${whole} ` : ""}${VULGAR_FRACTIONS[symbol]}`,
	);
}

export function hasExplicitNumericQuantity(text: string): boolean {
	return /\d/.test(normalizeVulgarFractions(text));
}

export function isNonNumericQualifier(text: string): boolean {
	return NON_NUMERIC_PATTERNS.some((pattern) => pattern.test(text));
}

function extractParentheticals(text: string): { text: string; notes: string[] } {
	const notes: string[] = [];
	const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
	const closers = new Set(Object.values(pairs));
	const stack: string[] = [];
	let stripped = "";
	let note = "";
	for (const character of text) {
		if (pairs[character]) {
			stack.push(pairs[character]);
			continue;
		}
		if (closers.has(character)) {
			if (stack.length > 0) {
				const expected = stack.at(-1);
				if (character === expected) {
					stack.pop();
				}
				if (stack.length === 0) {
					const trimmed = note.replace(/[()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
					if (trimmed) {
						notes.push(trimmed);
					}
					note = "";
					stripped += " ";
				}
			}
			continue;
		}
		if (stack.length > 0) {
			note += character;
		} else {
			stripped += character;
		}
	}
	if (note.trim()) {
		notes.push(note.replace(/[()[\]{}]/g, " ").replace(/\s+/g, " ").trim());
	}
	return { text: stripped.replace(/[()[\]{}]/g, " ").replace(/\s+/g, " ").trim(), notes };
}

function extractTrailingNotes(text: string): {
	text: string;
	qualifiers: string[];
	preparations: string[];
} {
	const qualifiers: string[] = [];
	const preparations: string[] = [];
	let remaining = text;
	for (const pattern of [
		{ regex: /(?:,\s*)?(plus more if needed)\s*$/i, destination: qualifiers },
		{ regex: /(?:,\s*)?(or to taste)\s*$/i, destination: qualifiers },
		{ regex: /(?:,\s*)?(divided)\s*$/i, destination: preparations },
	]) {
		const match = remaining.match(pattern.regex);
		if (match) {
			pattern.destination.push(match[1]);
			remaining = remaining.slice(0, match.index).replace(/[\s,]+$/g, "");
		}
	}
	return { text: remaining.trim(), qualifiers, preparations };
}

/** Canonicalize unit tokens so aliases like `fl. oz.`, `T`, and `c` classify correctly. */
export function normalizeUnit(unit: string): string {
	const trimmed = unit.trim();
	if (!trimmed) {
		return "";
	}
	const withoutPeriod = trimmed.replace(/\.+$/g, "");
	if (withoutPeriod === "T") {
		return "tbsp";
	}
	if (withoutPeriod === "t") {
		return "tsp";
	}
	const collapsed = trimmed
		.toLowerCase()
		.replace(/\./g, "")
		.replace(/\s+/g, " ")
		.trim();
	return UNIT_ALIASES[collapsed] ?? collapsed;
}

export function inferUnitSystem(unit: string | null): UnitSystem | null {
	if (!unit) {
		return null;
	}
	const compoundDescriptor = unit
		.trim()
		.toLowerCase()
		.replace(/([a-z])\./g, "$1")
		.match(/^\d+(?:\.\d+)?(?:\s*-\s*|\s+)([a-z]+)\s+[a-z]+$/i)?.[1];
	if (compoundDescriptor) {
		return inferUnitSystem(compoundDescriptor);
	}
	const key = normalizeUnit(unit);
	if (METRIC_UNITS.has(key)) {
		return "metric";
	}
	if (IMPERIAL_UNITS.has(key)) {
		return "imperial";
	}
	return "unknown";
}

function classify(
	text: string,
	quantity: number | null,
	quantityMax: number | null,
): ParseConfidence {
	if (quantity !== null && quantityMax !== null && quantityMax !== quantity) {
		return "range";
	}
	if (quantity !== null) {
		return "exact";
	}
	// No parsed quantity. A qualifier still wins when the line also has digits
	// (e.g. "salt to taste, leftover from step 2") so we do not mark it ambiguous.
	if (isNonNumericQualifier(text)) {
		return "non_numeric";
	}
	return "ambiguous";
}

function emptyIngredient(raw: string, confidence: ParseConfidence): RecipeIngredient {
	return {
		id: generateIngredientId(),
		raw,
		name: raw.trim() || raw,
		canonicalId: null,
		quantity: null,
		quantityMax: null,
		unit: null,
		unitSystem: null,
		preparation: null,
		qualifiers: [],
		optional: /\boptional\b/i.test(raw),
		parseConfidence: confidence,
	};
}

export function parseIngredientLine(raw: string): RecipeIngredient {
	const rawText = raw;
	const trimmed = raw.trim();
	if (!trimmed) {
		return emptyIngredient(rawText, "ambiguous");
	}

	const normalized = normalizeVulgarFractions(trimmed).replace(/[\u2013\u2014]/g, "-");
	const sizedUnit = replaceSizedUnit(normalized);
	const { text: withoutParens, notes: parentheticals } = extractParentheticals(sizedUnit.text);
	const trailing = extractTrailingNotes(withoutParens);
	const exactQuantity = parseLeadingQuantity(trailing.text);
	const customUnit = sizedUnit.unit
		? { text: trailing.text, unit: sizedUnit.unit }
		: replaceCustomUnit(trailing.text);

	if (isNonNumericQualifier(trimmed) && !hasExplicitNumericQuantity(trimmed)) {
		const qualifiers = [
			...parentheticals,
			...trailing.qualifiers,
			...NON_NUMERIC_PATTERNS.filter((pattern) => pattern.test(trailing.text)).map((pattern) => {
				const match = trailing.text.match(pattern);
				return match?.[0] ?? "";
			}),
		].filter(Boolean);
		return {
			...emptyIngredient(rawText, "non_numeric"),
			name: stripNonNumeric(trailing.text) || trimmed,
			qualifiers: unique(qualifiers),
			optional: /\boptional\b/i.test(trimmed),
		};
	}

	let parsed: ReturnType<typeof parseIngredient> = null;
	try {
		parsed = parseIngredient(customUnit.text, "en", {
			includeExtra: true,
			includeAlternativeUnits: false,
			fallbackLanguage: "en",
		});
	} catch {
		return {
			...emptyIngredient(rawText, "ambiguous"),
			qualifiers: unique([...parentheticals, ...trailing.qualifiers]),
		};
	}

	if (!parsed || !parsed.ingredient) {
		return {
			...emptyIngredient(rawText, classify(trimmed, null, null)),
			qualifiers: unique([...parentheticals, ...trailing.qualifiers]),
		};
	}

	const parsedQuantity = Number.isFinite(parsed.minQuantity) ? parsed.minQuantity : parsed.quantity;
	const parsedQuantityMax = Number.isFinite(parsed.maxQuantity) ? parsed.maxQuantity : parsed.quantity;
	const quantity = exactQuantity?.min ?? parsedQuantity;
	const quantityMax = exactQuantity?.max ?? parsedQuantityMax;
	const isRange = quantity !== quantityMax;
	const hasQuantity = Number.isFinite(quantity) && quantity > 0;
	const unit = customUnit.unit ?? (parsed.unitText || parsed.unit || null);
	const preparationParts = unique([
		...(parsed.extra?.trim() ? [parsed.extra.trim()] : []),
		...trailing.preparations,
	]);
	const preparation = preparationParts.length > 0 ? preparationParts.join(", ") : null;
	const dualUnits = parentheticals.filter((note) => DUAL_UNIT_PAREN.test(note));
	const qualifiers = unique([
		...parentheticals,
		...trailing.qualifiers,
		...dualUnits.map((note) => `dual-unit:${note}`),
	]);

	if (!hasQuantity) {
		return {
			id: generateIngredientId(),
			raw: rawText,
			name: parsed.ingredient.trim() || trimmed,
			canonicalId: null,
			quantity: null,
			quantityMax: null,
			unit: unit || null,
			unitSystem: inferUnitSystem(unit || parsed.unit),
			preparation,
			qualifiers,
			optional: /\boptional\b/i.test(trimmed),
			parseConfidence: classify(trimmed, null, null),
		};
	}

	return {
		id: generateIngredientId(),
		raw: rawText,
		name: parsed.ingredient.trim(),
		canonicalId: null,
		quantity,
		quantityMax: isRange ? quantityMax : null,
		unit,
		unitSystem: inferUnitSystem(unit || parsed.unit),
		preparation,
		qualifiers,
		optional: /\boptional\b/i.test(trimmed),
		parseConfidence: classify(trimmed, quantity, isRange ? quantityMax : quantity),
	};
}

function replaceSizedUnit(text: string): { text: string; unit: string | null } {
	const parenthesized = text.match(PARENTHESIZED_PACKAGE);
	if (parenthesized) {
		return {
			text: `${parenthesized[1]} piece ${parenthesized[5]}`,
			unit: `${parenthesized[2]} ${parenthesized[3]} ${parenthesized[4]}`,
		};
	}
	const hyphenated = text.match(HYPHENATED_PACKAGE);
	if (hyphenated) {
		return {
			text: `${hyphenated[1]} piece ${hyphenated[5]}`,
			unit: `${hyphenated[2]}-${hyphenated[3]} ${hyphenated[4]}`,
		};
	}
	const plain = text.match(UNPARENTHESIZED_PACKAGE);
	if (plain) {
		return {
			text: `${plain[1]} piece ${plain[5]}`,
			unit: `${plain[2]} ${plain[3]} ${plain[4]}`,
		};
	}
	const piece = text.match(HYPHENATED_PIECE);
	if (piece) {
		return {
			text: `1 piece ${piece[4]}`,
			unit: `${piece[1]}-${piece[2]} ${piece[3]}`,
		};
	}
	return { text, unit: null };
}

function replaceCustomUnit(text: string): { text: string; unit: string | null } {
	const match = text.match(CUSTOM_UNIT_AFTER_QUANTITY);
	if (!match) {
		return { text, unit: null };
	}
	const proxyUnit = /^fl|^fluid/i.test(match[2]) ? "cup" : "piece";
	return {
		text: text.replace(CUSTOM_UNIT_AFTER_QUANTITY, `$1${proxyUnit}`),
		unit: match[2],
	};
}

function parseLeadingQuantity(text: string): { min: number; max: number } | null {
	const match = text.match(LEADING_QUANTITY);
	if (!match || !match[0].includes("/")) {
		return null;
	}
	const min = parseQuantityPart(match[1]);
	const max = match[2] ? parseQuantityPart(match[2]) : min;
	return min > 0 && max > 0 ? { min, max } : null;
}

function parseQuantityPart(text: string): number {
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

function stripNonNumeric(text: string): string {
	let next = text;
	for (const pattern of NON_NUMERIC_PATTERNS) {
		next = next.replace(pattern, "");
	}
	return next.replace(/^[,\s]+|[,\s]+$/g, "").trim();
}

function unique(values: string[]): string[] {
	return [...new Set(values.filter((value) => value.length > 0))];
}
