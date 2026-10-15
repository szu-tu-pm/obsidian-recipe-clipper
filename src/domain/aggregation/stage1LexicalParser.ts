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
	t: "tsp",
	tbsp: "tbsp",
	tsp: "tsp",
	c: "cup",
	cup: "cup",
	cups: "cups",
	floz: "fl oz",
	"fl oz": "fl oz",
	milligrams: "milligrams",
	milligram: "milligram",
};

const DUAL_UNIT_PAREN = /^\s*[\d./\s-]+\s*[a-zA-Zµμ.]+\s*$/;

export function normalizeVulgarFractions(text: string): string {
	let next = text;
	for (const [symbol, ascii] of Object.entries(VULGAR_FRACTIONS)) {
		next = next.split(symbol).join(ascii);
	}
	return next;
}

export function hasExplicitNumericQuantity(text: string): boolean {
	return /\d/.test(normalizeVulgarFractions(text));
}

export function isNonNumericQualifier(text: string): boolean {
	return NON_NUMERIC_PATTERNS.some((pattern) => pattern.test(text));
}

function extractParentheticals(text: string): { text: string; notes: string[] } {
	const notes: string[] = [];
	const stripped = text.replace(/\(([^)]*)\)/g, (_match, inner: string) => {
		const trimmed = inner.trim();
		if (trimmed) {
			notes.push(trimmed);
		}
		return " ";
	});
	return { text: stripped.replace(/\s+/g, " ").trim(), notes };
}

/** Canonicalize unit tokens so aliases like `fl. oz.`, `T`, and `c` classify correctly. */
export function normalizeUnit(unit: string): string {
	const trimmed = unit.trim();
	if (!trimmed) {
		return "";
	}
	if (trimmed === "T") {
		return "tbsp";
	}
	if (trimmed === "t") {
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

	const { text: withoutParens, notes: parentheticals } = extractParentheticals(
		normalizeVulgarFractions(trimmed).replace(/[\u2013\u2014]/g, "-"),
	);

	if (isNonNumericQualifier(trimmed) && !hasExplicitNumericQuantity(trimmed)) {
		const qualifiers = [
			...parentheticals,
			...NON_NUMERIC_PATTERNS.filter((pattern) => pattern.test(trimmed)).map((pattern) => {
				const match = trimmed.match(pattern);
				return match?.[0] ?? "";
			}),
		].filter(Boolean);
		return {
			...emptyIngredient(rawText, "non_numeric"),
			name: stripNonNumeric(withoutParens) || trimmed,
			qualifiers: unique(qualifiers),
			optional: /\boptional\b/i.test(trimmed),
		};
	}

	let parsed: ReturnType<typeof parseIngredient> = null;
	try {
		parsed = parseIngredient(withoutParens, "en", {
			includeExtra: true,
			includeAlternativeUnits: false,
			fallbackLanguage: "en",
		});
	} catch {
		return {
			...emptyIngredient(rawText, "ambiguous"),
			qualifiers: parentheticals,
		};
	}

	if (!parsed || !parsed.ingredient) {
		return {
			...emptyIngredient(rawText, classify(trimmed, null, null)),
			qualifiers: parentheticals,
		};
	}

	const isRange = parsed.minQuantity !== parsed.maxQuantity;
	const quantity = Number.isFinite(parsed.minQuantity) ? parsed.minQuantity : parsed.quantity;
	const quantityMax = Number.isFinite(parsed.maxQuantity) ? parsed.maxQuantity : parsed.quantity;
	const hasQuantity = Number.isFinite(quantity) && quantity > 0;
	const unit = parsed.unitText || parsed.unit || null;
	const preparation = parsed.extra?.trim() ? parsed.extra.trim() : null;
	const dualUnits = parentheticals.filter((note) => DUAL_UNIT_PAREN.test(note));
	const qualifiers = unique([
		...parentheticals,
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
			unitSystem: inferUnitSystem(parsed.unit || unit),
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
		unitSystem: inferUnitSystem(parsed.unit || unit),
		preparation,
		qualifiers,
		optional: /\boptional\b/i.test(trimmed),
		parseConfidence: classify(trimmed, quantity, isRange ? quantityMax : quantity),
	};
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
