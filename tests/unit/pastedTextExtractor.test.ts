import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseIngredientLine } from "../../src/domain/aggregation/stage1LexicalParser";
import {
	assistantNameForLink,
	DEFAULT_PARSER_PARTS,
	extractPastedRecipe,
	extractPastedRecipeWithModel,
	NO_SECTIONS_WARNING,
	parsePastedIngredient,
	parsePastedText,
	resolveSourceLink,
	stripChatNoise,
	type ModelExtract,
	type ParsedPaste,
	type PasteParserParts,
} from "../../src/domain/extraction/pastedTextExtractor";
import {
	ollamaExtractionSchema,
	parseModelContent,
} from "../../src/domain/extraction/ollamaExtractor";
import { recipeFrontmatterSchema } from "../../src/domain/schema/recipeSchema";
import { DEFAULT_SETTINGS } from "../../src/pluginSettings";

const FIXTURES = new URL("../fixtures/pasted-text/", import.meta.url);
const visible = readFileSync(new URL("chatgpt-thai-curry-visible.txt", FIXTURES), "utf8");
const markdown = readFileSync(new URL("chatgpt-thai-curry-markdown.md", FIXTURES), "utf8");

// Worked by hand from chatgpt-thai-curry-visible.txt: phase name, then its numbered sub-steps.
const PHASES: Array<[string, string[]]> = [
	[
		"Start the rice",
		[
			"Rinse ¾ cup dry jasmine rice.",
			"Add to pot with 1 cup water.",
			"Bring to a boil, cover, reduce heat to low.",
			"Simmer 15 minutes, then rest covered for 5 minutes.",
		],
	],
	[
		"Prep the ingredients",
		[
			"Cut chicken thighs into 1-inch pieces.",
			"Slice bell peppers and onion.",
			"Cut asparagus into 2-inch pieces.",
			"Mince garlic and halve lime.",
			"Pat chicken dry; season lightly with salt and pepper.",
		],
	],
	[
		"Sear the chicken",
		[
			"Heat 1 tbsp oil in a large skillet over medium-high heat.",
			"Add chicken in a single layer (work in batches if needed).",
			"Sear 3–4 minutes without moving.",
			"Flip and cook another 2–3 minutes.",
			"Transfer chicken to a plate. It will finish cooking in the sauce.",
		],
	],
	[
		"Cook the vegetables",
		[
			"Reduce heat to medium.",
			"Add sliced onion and bell peppers to the same pan.",
			"Sauté 3–4 minutes until slightly softened.",
			"Add minced garlic; cook 30 seconds.",
		],
	],
	[
		"Add the curry sauce",
		[
			"Pour in the entire 11 oz bottle of red curry sauce.",
			"Add ½ cup coconut milk.",
			"Stir to combine and bring to a gentle simmer.",
			"Return chicken and any juices to the pan.",
			"Simmer 5 minutes, stirring occasionally.",
		],
	],
	[
		"Finish with asparagus and lime",
		[
			"Add asparagus pieces.",
			"Simmer 4–5 minutes until bright green and tender-crisp.",
			"Confirm chicken reaches 165°F (74°C) internally.",
			"Turn off heat and stir in juice of ½–1 lime.",
			"Taste before adding more salt, chili flakes, or lime.",
		],
	],
	[
		"Serve",
		[
			"Divide jasmine rice into 2–3 bowls.",
			"Spoon chicken curry and vegetables over rice.",
			"Garnish with cilantro or extra lime if desired.",
		],
	],
];
const EXPECTED_STEPS = PHASES.flatMap(([phase, steps]) => steps.map((step) => `${phase}: ${step}`));

const EXPECTED_NAMES = [
	"boneless, skinless chicken thighs",
	"Trader Joe's Thai Style Red Curry Sauce",
	"unsweetened coconut milk",
	"bell peppers",
	"asparagus",
	"yellow onion",
	"garlic",
	"lime",
	"jasmine rice",
	"neutral cooking oil",
	"salt and black pepper",
	"chili flakes, cilantro",
];

function withoutIds(parsed: ParsedPaste): unknown {
	return {
		...parsed,
		ingredients: parsed.ingredients.map(({ id: _id, ...rest }) => rest),
	};
}

describe("fixtures: ChatGPT Thai curry", () => {
	it("parses the visible-text fixture to the title, 12 ingredients, 31 ordered steps and servings", () => {
		const parsed = parsePastedText(visible);
		expect(parsed.title).toBe("High-Protein Thai Red Chicken Curry");
		expect(parsed.ingredients).toHaveLength(12);
		expect(parsed.ingredients.map((item) => item.name)).toEqual(EXPECTED_NAMES);
		expect(EXPECTED_STEPS).toHaveLength(31);
		expect(parsed.instructions).toEqual(EXPECTED_STEPS);
		expect(parsed.servings).toEqual({ raw: "2–3 servings", amount: null });
	});

	it("does not turn the 35–40 min range into a number and warns", () => {
		const parsed = parsePastedText(visible);
		expect(parsed.prepTimeMinutes).toBeNull();
		expect(parsed.cookTimeMinutes).toBeNull();
		expect(parsed.totalTimeMinutes).toBeNull();
		expect(parsed.notes).toContain("Time as written: 35–40 min");
		expect(parsed.warnings.some((warning) => /35–40 min.*no Prep, Cook or Total label/.test(warning))).toBe(true);
	});

	it("keeps the quick cooking tips and My preferred version in Notes", () => {
		const { notes } = parsePastedText(visible);
		expect(notes).toContain("- Thicker curry: Simmer uncovered for an extra 2–3 minutes.");
		expect(notes).toContain("- Meal prep: Refrigerate promptly");
		expect(notes).toContain("My preferred version: Use the full 1.5 lb chicken");
		expect(notes).not.toMatch(/\n\n/);
	});

	it("produces no ingredients for the empty-Ingredients markdown fixture, keeps 31 steps and warns", () => {
		const parsed = parsePastedText(markdown);
		expect(parsed.title).toBe("High-Protein Thai Red Chicken Curry");
		expect(parsed.ingredients).toEqual([]);
		expect(parsed.sections.ingredients).toBe(true);
		expect(parsed.instructions).toEqual(EXPECTED_STEPS);
		expect(parsed.servings).toEqual({ raw: "2–3 servings", amount: null });
		const warning = parsed.warnings.find((text) => /ingredient list was empty/i.test(text));
		expect(warning).toMatch(/visible page/);
		expect(parsed.notes).toContain("My preferred version:");
	});
});

describe("ingredient lines from the fixture", () => {
	function line(text: string) {
		return parsePastedIngredient(text);
	}

	it("reads a range with a side note: quantity 1, quantityMax 1.5, unit lb, note kept out of the name", () => {
		const item = line("Boneless, skinless chicken thighs — 1–1.5 lb (use 1.5 lb for more protein)");
		expect(item).toMatchObject({
			name: "boneless, skinless chicken thighs",
			quantity: 1,
			quantityMax: 1.5,
			unit: "lb",
			parseConfidence: "range",
		});
		expect(item.qualifiers).toContain("use 1.5 lb for more protein");
		expect(item.name).not.toMatch(/use 1\.5/);
	});

	it("reads quantity, no unit, name and preparation", () => {
		expect(line("Bell peppers — 2, sliced")).toMatchObject({
			name: "bell peppers",
			quantity: 2,
			quantityMax: null,
			unit: null,
			preparation: "sliced",
		});
	});

	it("reads a Unicode fraction with a metric aside, keeping the unit as typed", () => {
		expect(line("Unsweetened coconut milk — ½ cup (120 ml)")).toMatchObject({
			quantity: 0.5,
			unit: "cup",
			name: "unsweetened coconut milk",
		});
	});

	it("reads a package unit that the shared parser does not list", () => {
		expect(line("Trader Joe's Thai Style Red Curry Sauce — 1 bottle (11 oz)")).toMatchObject({
			quantity: 1,
			unit: "bottle",
			name: "Trader Joe's Thai Style Red Curry Sauce",
		});
	});

	it("marks 'To taste' as non-numeric with no quantity", () => {
		expect(line("Salt and black pepper — To taste")).toMatchObject({
			name: "salt and black pepper",
			quantity: null,
			quantityMax: null,
			unit: null,
			parseConfidence: "non_numeric",
		});
	});

	it("marks an Optional: line as optional and keeps it out of the name", () => {
		expect(line("Optional: chili flakes, cilantro — To taste")).toMatchObject({
			name: "chili flakes, cilantro",
			optional: true,
			quantity: null,
			parseConfidence: "non_numeric",
		});
	});

	it("keeps the pasted line in raw and units as typed", () => {
		const text = "Garlic — 3–4 cloves, minced";
		expect(line(text)).toMatchObject({ raw: text, unit: "cloves", quantity: 3, quantityMax: 4 });
		expect(line("Asparagus — 1 bunch (about 8 oz), cut into 2-inch pieces")).toMatchObject({
			unit: "bunch",
			preparation: "cut into 2-inch pieces",
		});
		expect(line("Jasmine rice (dry) — ¾ cup")).toMatchObject({
			name: "jasmine rice",
			quantity: 0.75,
			unit: "cup",
			qualifiers: ["dry"],
		});
	});

	it("handles the other shapes of a name-first line", () => {
		expect(line("- **Olive oil** - 2 tbsp")).toMatchObject({ name: "olive oil", unit: "tbsp", quantity: 2 });
		expect(line("Pinch of saffron — A pinch")).toMatchObject({ parseConfidence: "non_numeric" });
		expect(line("Water — as much as you like")).toMatchObject({
			parseConfidence: "ambiguous",
			quantity: null,
			qualifiers: ["as much as you like"],
		});
		expect(line("Rice — about 2 cups")).toMatchObject({ quantity: null, parseConfidence: "ambiguous" });
		expect(line("Optional: 1 tsp chili flakes")).toMatchObject({ optional: true, quantity: 1, unit: "tsp" });
		expect(line("2 cups flour — sifted").quantity).toBe(2);
	});
});

describe("extra paste shapes", () => {
	it("(a) reads 'quantity unit name, preparation' lines", () => {
		const parsed = parsePastedText(
			"Simple Cake\n\nIngredients\n2 cups flour, sifted\n1 tsp baking powder\n\nInstructions\n1. Mix.\n2. Bake.\n",
		);
		expect(parsed.title).toBe("Simple Cake");
		expect(parsed.ingredients.map((item) => [item.name, item.quantity, item.unit, item.preparation])).toEqual([
			["flour", 2, "cups", "sifted"],
			["baking powder", 1, "tsp", null],
		]);
		expect(parsed.instructions).toEqual(["Mix.", "Bake."]);
	});

	it("(b) reads numbered `1)` and bulleted steps with no phases", () => {
		const numbered = parsePastedText("Toast\nIngredients\n- 2 slices bread\nDirections\n1) Toast the bread.\n2) Butter it.\n");
		expect(numbered.instructions).toEqual(["Toast the bread.", "Butter it."]);
		const bulleted = parsePastedText("Toast\nIngredients\n* 2 slices bread\nMethod\n- Toast the bread.\n• Butter it.\n");
		expect(bulleted.instructions).toEqual(["Toast the bread.", "Butter it."]);
		expect(bulleted.ingredients.map((item) => item.name)).toEqual(["bread"]);
	});

	it("(c) reads a Claude or Gemini style bold heading with labelled times and servings", () => {
		const parsed = parsePastedText(
			[
				"**Garlic Butter Pasta**",
				"",
				"**Prep time:** 10 minutes",
				"**Cook time:** 15 minutes",
				"**Serves:** 4",
				"",
				"**Ingredients:**",
				"- 12 oz spaghetti",
				"- 4 cloves garlic, minced",
				"",
				"**Instructions:**",
				"1. Boil the pasta.",
				"2. Saute the garlic.",
				"",
				"**Tips:**",
				"- Save some pasta water.",
			].join("\n"),
		);
		expect(parsed.title).toBe("Garlic Butter Pasta");
		expect(parsed.prepTimeMinutes).toBe(10);
		expect(parsed.cookTimeMinutes).toBe(15);
		expect(parsed.totalTimeMinutes).toBeNull();
		expect(parsed.servings).toEqual({ raw: "Serves: 4", amount: 4 });
		expect(parsed.ingredients.map((item) => [item.name, item.quantity, item.unit])).toEqual([
			["spaghetti", 12, "oz"],
			["garlic", 4, "cloves"],
		]);
		expect(parsed.instructions).toEqual(["Boil the pasta.", "Saute the garlic."]);
		expect(parsed.notes).toBe("Tips\n- Save some pasta water.");
		expect(parsed.warnings).toEqual([]);
	});

	it("(c) uses the first markdown heading as the title and treats group labels as labels", () => {
		const parsed = parsePastedText(
			"Sure, here is a recipe.\n\n# 🥣 Oatmeal\n\n## Ingredients\n**For the base:**\n1/2 cup oats\n\n## Directions\nStep 1: Boil water.\nStep 2: Stir in oats.\n",
		);
		expect(parsed.title).toBe("Oatmeal");
		expect(parsed.notes).toBe("Sure, here is a recipe.");
		expect(parsed.ingredients.map((item) => [item.name, item.quantity, item.unit])).toEqual([["oats", 0.5, "cup"]]);
		expect(parsed.instructions).toEqual(["Boil water.", "Stir in oats."]);
	});

	it("(d) returns an empty draft and a warning for text with no sections", () => {
		const parsed = parsePastedText(
			"Hello! Can you help with dinner tonight?\nI was thinking about something with chicken and rice, maybe 2 cups of rice.",
		);
		expect(parsed.title).toBe("Hello! Can you help with dinner tonight?");
		expect(parsed.ingredients).toEqual([]);
		expect(parsed.instructions).toEqual([]);
		expect(parsed.notes).toBe("");
		expect(parsed.servings).toBeNull();
		expect(parsed.warnings).toEqual([NO_SECTIONS_WARNING]);
		const result = extractPastedRecipe({ text: "" });
		expect(result.candidate.draft.frontmatter.title).toBe("Untitled recipe");
		expect(result.warnings).toContain("No title was found in the text.");
	});

	it("(e) reads CRLF line endings the same as LF", () => {
		const crlf = visible.replace(/\n/g, "\r\n");
		expect(crlf).toContain("\r\n");
		expect(withoutIds(parsePastedText(crlf))).toEqual(withoutIds(parsePastedText(visible)));
		expect(parsePastedText(markdown.replace(/\n/g, "\r\n")).instructions).toEqual(EXPECTED_STEPS);
	});

	it("(f) reads a time and servings given as single values", () => {
		const parsed = parsePastedText(
			"Test Soup\nPrep time: 15 minutes\nCook Time: 1 hour 30 minutes\nServes 4\nIngredients\n1 cup stock\nInstructions\nSimmer.\n",
		);
		expect(parsed.prepTimeMinutes).toBe(15);
		expect(parsed.cookTimeMinutes).toBe(90);
		expect(parsed.servings).toEqual({ raw: "Serves 4", amount: 4 });
		expect(parsed.warnings).toEqual([]);
		const headline = parsePastedText("Quick Rice\n45 min   4 servings\nIngredients\n1 cup rice\nInstructions\nCook.\n");
		expect(headline.totalTimeMinutes).toBeNull();
		expect(headline.notes).toBe("Time as written: 45 min");
		expect(headline.warnings).toHaveLength(1);
		expect(headline.warnings[0]).toMatch(/no Prep, Cook or Total label/);
		expect(headline.servings).toEqual({ raw: "4 servings", amount: 4 });
		const hours = parsePastedText("Slow Beans\nTotal time: 1.5 hours\nIngredients\n1 cup beans\nInstructions\nCook.\n");
		expect(hours.totalTimeMinutes).toBe(90);
	});

	it("warns, and keeps the text, for a time that is a range or cannot be read as minutes", () => {
		const parsed = parsePastedText(
			"Soup\nPrep time: 10-15 minutes  Total time: 30 min  Total time: 45 min  Active time: 20 min\nIngredients\n1 cup stock\nInstructions\nSimmer.\n",
		);
		expect(parsed.prepTimeMinutes).toBeNull();
		expect(parsed.totalTimeMinutes).toBe(30);
		expect(parsed.notes).toContain("Prep time as written: 10-15 minutes");
		expect(parsed.notes).toContain("Time as written: 45 min");
		expect(parsed.notes).not.toContain("Time as written: 30 min");
		expect(parsed.notes).toContain("Active time: 20 min");
		expect(parsed.warnings).toHaveLength(2);
		expect(parsed.warnings[1]).toMatch(/could not be saved as minutes/);
	});

	it("reads plain steps, a missing Ingredients section and missing steps", () => {
		const plain = parsePastedText("Eggs\nIngredients\n2 eggs\nSteps\nCrack the eggs\nFry them\n");
		expect(plain.instructions).toEqual(["Crack the eggs", "Fry them"]);
		const missing = parsePastedText("Eggs\nInstructions\n1. Crack the eggs.\n");
		expect(missing.ingredients).toEqual([]);
		expect(missing.warnings).toHaveLength(1);
		expect(missing.warnings[0]).toMatch(/No Ingredients section/);
		const noSteps = parsePastedText("Eggs\nIngredients\n2 eggs\n");
		expect(noSteps.warnings).toEqual(["No instruction steps were found in the text."]);
	});

	it("reads bold phase names and ends the steps at a tips heading", () => {
		const parsed = parsePastedText(
			"Eggs\nIngredients\n2 eggs\nInstructions\n**Prep**\n1. Crack.\n**Cook**\n1. Fry.\n**Chef's tips**\n- Use butter.\nEnjoy!\n",
		);
		expect(parsed.instructions).toEqual(["Prep: Crack.", "Cook: Fry."]);
		expect(parsed.notes).toBe("Chef's tips\n- Use butter.\nEnjoy!");
	});

	it("takes the first time and servings only, and keeps later ones in Notes", () => {
		const parsed = parsePastedText(
			"Eggs\nServes 2   Serves 4\nIngredients\n2 eggs\nInstructions\n1. Fry.\n",
		);
		expect(parsed.servings).toEqual({ raw: "Serves 2", amount: 2 });
		expect(parsed.notes).toBe("Serves 4");
	});
});

describe("source link and assistant", () => {
	it("keeps only an http(s) link and warns about anything else", () => {
		expect(resolveSourceLink("https://chatgpt.com/share/abc")).toEqual({
			url: "https://chatgpt.com/share/abc",
			warning: null,
		});
		expect(resolveSourceLink("chatgpt.com/share/abc").url).toBe("https://chatgpt.com/share/abc");
		expect(resolveSourceLink("  ")).toEqual({ url: null, warning: null });
		for (const bad of ["javascript:alert(1)", "ftp://example.com/x", "file:///etc/passwd", "not a link"]) {
			const resolved = resolveSourceLink(bad);
			expect(resolved.url, bad).toBeNull();
			expect(resolved.warning, bad).toMatch(/not an http\(s\) link/);
		}
	});

	it("names the assistant only for the three known hosts", () => {
		expect(assistantNameForLink("https://chatgpt.com/share/abc")).toBe("ChatGPT");
		expect(assistantNameForLink("https://claude.ai/share/abc")).toBe("Claude");
		expect(assistantNameForLink("https://gemini.google.com/share/abc")).toBe("Gemini");
		expect(assistantNameForLink("https://www.chatgpt.com/share/abc")).toBe("ChatGPT");
		expect(assistantNameForLink("https://example.com/share/abc")).toBeNull();
		expect(assistantNameForLink("javascript:alert(1)")).toBeNull();
		expect(assistantNameForLink("")).toBeNull();
	});
});

describe("review result", () => {
	const existing = [{ id: "rec_X", sourceUrl: "https://chatgpt.com/share/abc/", path: "Recipes/Old.md" }];

	it("builds a schema-valid pasted-text draft that records the assistant and source link", () => {
		const result = extractPastedRecipe({
			text: visible,
			sourceLink: "chatgpt.com/share/abc",
			generatedBy: "ChatGPT",
			now: "2026-10-20T10:00:00.000Z",
			existingRecipes: existing,
		});
		const { frontmatter } = result.candidate.draft;
		expect(recipeFrontmatterSchema.safeParse(frontmatter).success).toBe(true);
		expect(frontmatter).toMatchObject({
			extractionMethod: "pasted-text",
			generatedBy: "ChatGPT",
			sourceUrl: "https://chatgpt.com/share/abc",
			importedAt: "2026-10-20T10:00:00.000Z",
			totalTimeMinutes: null,
		});
		expect(result.duplicates.map((match) => match.id)).toEqual(["rec_X"]);
		expect(result.candidate.ingredientsRaw).toHaveLength(12);
	});

	it("leaves generatedBy and sourceUrl out unless they were given", () => {
		const result = extractPastedRecipe({ text: visible, sourceLink: "javascript:alert(1)" });
		const { frontmatter } = result.candidate.draft;
		expect("generatedBy" in frontmatter).toBe(false);
		expect(frontmatter.sourceUrl).toBeNull();
		expect(result.warnings.some((warning) => /not an http\(s\) link/.test(warning))).toBe(true);
		expect(result.duplicates).toEqual([]);
	});
});

// --- Mutation probes ---------------------------------------------------------------------
// Each gate measures a value through a function that takes the code under test as a
// parameter. The gate passes the real parser; the mutation test passes a broken one through
// the same measurement and asserts the measured value moves.

type ParseFn = (text: string) => ParsedPaste;
const real: ParseFn = (text) => parsePastedText(text);
const withParts =
	(parts: Partial<PasteParserParts>): ParseFn =>
	(text) =>
		parsePastedText(text, { ...DEFAULT_PARSER_PARTS, ...parts });

const FOLLOW_UP = "\nIf you want, I can:\n- Adjust the spice level\n- Convert it to a slow cooker\n";
const NOISE_TEXTS = [visible + FOLLOW_UP, markdown + FOLLOW_UP];
const NOISE_PATTERNS = [
	/image_group/,
	/Portion size/,
	/Current selection unavailable/,
	/^-? ?[23] servings$/m,
	/If you want, I can/,
	/Adjust the spice level/,
];

/** How many (noise pattern, pasted text) pairs still show up anywhere in the parsed recipe. */
function measureNoiseLeaks(parse: ParseFn): number {
	let leaks = 0;
	for (const text of NOISE_TEXTS) {
		const parsed = parse(text);
		const everything = [
			parsed.title ?? "",
			...parsed.ingredients.map((item) => item.raw),
			...parsed.instructions,
			parsed.notes,
			...parsed.warnings,
		].join("\n");
		leaks += NOISE_PATTERNS.filter((pattern) => pattern.test(everything)).length;
	}
	return leaks;
}

/** Ingredients of the visible fixture that keep a range: quantityMax above quantity. Hand count: 2 (chicken, garlic). */
function measureRangesKept(parse: ParseFn): number {
	return parse(visible).ingredients.filter(
		(item) => item.quantity !== null && item.quantityMax !== null && item.quantityMax > item.quantity,
	).length;
}

/** Ingredients found for the markdown fixture, whose Ingredients section is empty. */
function measureRebuiltIngredients(parse: ParseFn): number {
	return parse(markdown).ingredients.length;
}

const UNLABELED_TEXTS = [
	"Quick Rice\n45 min   4 servings\nIngredients\n1 cup rice\nInstructions\nCook.\n",
	"Soup\nTime: 30 min\nIngredients\n1 cup stock\nInstructions\nSimmer.\n",
	visible,
];

/** Time fields filled from durations that carry no Prep, Cook or Total label. */
function measureUnlabeledTimesAssigned(parse: ParseFn): number {
	return UNLABELED_TEXTS.reduce((count, text) => {
		const p = parse(text);
		return count + [p.prepTimeMinutes, p.cookTimeMinutes, p.totalTimeMinutes].filter((v) => v !== null).length;
	}, 0);
}

const MODEL_TEXT =
	"Weeknight lentil soup\n\nI simmered 1 cup red lentils with 4 cups water and a diced onion for 25 minutes.\nThen I stirred in lemon juice.\n";
const MODEL_REPLY = {
	title: "Weeknight lentil soup",
	ingredientsRaw: ["1 cup red lentils", "4 cups water", "2 cups saffron"],
	instructions: ["Then I stirred in lemon juice.", "Garnish with truffle shavings."],
	servingsRaw: "serves 6",
	cookTimeMinutes: 25,
	totalTimeMinutes: 90,
	author: "Gordon Ramsay",
};

function modelFetch(reply: unknown): typeof fetch {
	return (async (url: string | URL | Request) =>
		String(url).endsWith("/api/tags")
			? new Response("{}", { status: 200 })
			: new Response(JSON.stringify({ message: { content: JSON.stringify(reply) } }), {
					status: 200,
				})) as typeof fetch;
}

const OLLAMA = {
	endpoint: DEFAULT_SETTINGS.ollamaEndpoint,
	model: DEFAULT_SETTINGS.ollamaModel,
	healthCheckMs: 1000,
	timeoutMs: 1000,
};

/** A model path that trusts the model's JSON without the grounding check. */
const ungroundedExtract: ModelExtract = async (_text, _url, options) => {
	const chat = await options.fetchImpl!(`${options.endpoint}/api/chat`, { method: "POST" });
	const payload = (await chat.json()) as { message: { content: string } };
	const value = ollamaExtractionSchema.parse(parseModelContent(payload.message.content));
	return {
		fields: {
			title: value.title,
			ingredientsRaw: value.ingredientsRaw,
			instructions: value.instructions,
			servingsRaw: value.servingsRaw ?? null,
			prepTimeMinutes: value.prepTimeMinutes ?? null,
			cookTimeMinutes: value.cookTimeMinutes ?? null,
			totalTimeMinutes: value.totalTimeMinutes ?? null,
			cookingMethods: [],
			author: null,
			siteName: null,
			sourceUrl: null,
			images: [],
			extractionMethod: "ollama",
		},
		warnings: [],
		cancelled: false,
	};
};

async function measureHallucinationsKept(extract?: ModelExtract) {
	const { result } = await extractPastedRecipeWithModel(
		{ text: MODEL_TEXT },
		{ ...OLLAMA, fetchImpl: modelFetch(MODEL_REPLY) },
		extract,
	);
	const { draft } = result.candidate;
	const survivors = [
		draft.frontmatter.ingredients.some((item) => /saffron/.test(item.raw)),
		draft.instructions.some((step) => /truffle/.test(step)),
		draft.frontmatter.servings !== null,
		draft.frontmatter.totalTimeMinutes === 90,
	].filter(Boolean).length;
	const grounded =
		draft.frontmatter.ingredients.length + draft.instructions.length + (draft.frontmatter.cookTimeMinutes ? 1 : 0);
	return { survivors, grounded, result };
}

describe("noise dropping", () => {
	it("leaks nothing from image placeholders, the portion-size widget or follow-up offers", () => {
		expect(measureNoiseLeaks(real)).toBe(0);
	});

	it("catches a parser that stops dropping noise (measured leaks rise from 0)", () => {
		const mutant = withParts({ stripNoise: (lines) => lines });
		// Hand count: visible shows Portion size, the two option lines, the offer and its bullet (4);
		// markdown adds image_group and Current selection unavailable, and its widget options (6).
		expect(measureNoiseLeaks(mutant)).toBe(10);
	});

	it("drops each noise shape on its own", () => {
		const lines = [
			'image_group{"query":["x"],"layout":"carousel"}',
			"Keep this line image_group{\"a\":1} here",
			"**Portion size**",
			"- 2 servings",
			"3 servings",
			"Current selection unavailable.",
			"Kept after widget",
			"Would you like a shopping list?",
			"Salt to taste. citeturn0search1",
			"If you like, serve with lime.",
			"Want me to scale it?",
			"- scale to 4",
			"",
			"Let me know if you want changes",
		];
		expect(stripChatNoise(lines)).toEqual([
			"Keep this line  here",
			"Kept after widget",
			"Salt to taste. ",
			"If you like, serve with lime.",
		]);
	});
});

describe("unlabeled durations", () => {
	it("leaves every time field empty for a duration with no explicit label", () => {
		expect(measureUnlabeledTimesAssigned(real)).toBe(0);
	});

	it("catches a parser that assigns an unlabeled duration to total time (measured 0 becomes 2)", () => {
		// Hand count: "45 min" and "Time: 30 min" would each become a total time; the fixture's 35–40 min range cannot.
		const mutant: ParseFn = (text) => {
			const parsed = parsePastedText(text);
			const unlabeled = /^(?:Time: )?(\d+) min\b/m.exec(text.replace(/^[^\n]*\n/, ""));
			return unlabeled && parsed.totalTimeMinutes === null
				? { ...parsed, totalTimeMinutes: Number(unlabeled[1]) }
				: parsed;
		};
		expect(measureUnlabeledTimesAssigned(mutant)).toBe(2);
	});
});

describe("range handling", () => {
	it("keeps quantityMax for both ranged fixture ingredients", () => {
		expect(measureRangesKept(real)).toBe(2);
	});

	it("catches a parser that collapses ranges (measured count falls from 2 to 0)", () => {
		const mutant = withParts({
			parseIngredient: (line) => ({ ...parsePastedIngredient(line), quantityMax: null }),
		});
		expect(measureRangesKept(mutant)).toBe(0);
	});
});

describe("no ingredient rebuild", () => {
	it("finds no ingredients for the empty-Ingredients fixture", () => {
		expect(measureRebuiltIngredients(real)).toBe(0);
	});

	it("catches a parser that rebuilds ingredients from the step text (measured count rises from 0)", () => {
		const mutant: ParseFn = (text) => {
			const parsed = parsePastedText(text);
			if (parsed.ingredients.length > 0) {
				return parsed;
			}
			const rebuilt = parsed.instructions
				.filter((step) => /\d\s*(?:cup|tbsp|lb|oz|½|¾)/.test(step))
				.map((step) => parseIngredientLine(step));
			return { ...parsed, ingredients: rebuilt };
		};
		expect(measureRebuiltIngredients(mutant)).toBeGreaterThan(0);
	});
});

describe("Ollama grounding on the paste path (mocked model)", () => {
	it("keeps only values that appear in the pasted text and drops the rest", async () => {
		const { survivors, grounded, result } = await measureHallucinationsKept();
		expect(survivors).toBe(0);
		// Hand count: 2 grounded ingredients, 1 grounded step, 1 grounded cook time.
		expect(grounded).toBe(4);
		const { draft } = result.candidate;
		expect(draft.frontmatter.ingredients.map((item) => item.raw)).toEqual([
			"1 cup red lentils",
			"4 cups water",
		]);
		expect(draft.instructions).toEqual(["Then I stirred in lemon juice."]);
		expect(draft.frontmatter.title).toBe("Weeknight lentil soup");
		expect(draft.frontmatter.cookTimeMinutes).toBe(25);
		expect(draft.frontmatter.servings).toBeNull();
		expect(draft.frontmatter.extractionMethod).toBe("pasted-text");
		expect(result.warnings.some((warning) => /local model extracted/.test(warning))).toBe(true);
		expect(result.warnings).not.toContain(NO_SECTIONS_WARNING);
	});

	it("catches a model path without the grounding check (hallucinated values kept: 0 becomes 4)", async () => {
		const { survivors } = await measureHallucinationsKept(ungroundedExtract);
		expect(survivors).toBe(4);
	});

	it("does not call the model when the text has a recipe section", async () => {
		let calls = 0;
		const { result, cancelled } = await extractPastedRecipeWithModel(
			{ text: visible },
			{ ...OLLAMA },
			async () => {
				calls += 1;
				return { fields: null, warnings: [], cancelled: false };
			},
		);
		expect(calls).toBe(0);
		expect(cancelled).toBe(false);
		expect(result.candidate.ingredientsRaw).toHaveLength(12);
	});

	it("falls back to the empty draft with the model's warnings when it returns nothing usable", async () => {
		const { result } = await extractPastedRecipeWithModel(
			{ text: MODEL_TEXT, sourceLink: "https://claude.ai/share/x" },
			{ ...OLLAMA, fetchImpl: modelFetch({ title: "x", ingredientsRaw: ["9 cups gold"], instructions: [] }) },
		);
		expect(result.candidate.ingredientsRaw).toEqual([]);
		expect(result.warnings).toContain(NO_SECTIONS_WARNING);
		expect(result.warnings).toContain("Local Ollama output was not grounded in the page text.");
	});

	it("reports a cancelled model request", async () => {
		const controller = new AbortController();
		controller.abort();
		const { cancelled } = await extractPastedRecipeWithModel(
			{ text: MODEL_TEXT },
			{ ...OLLAMA, fetchImpl: modelFetch({}), signal: controller.signal },
		);
		expect(cancelled).toBe(true);
	});
});
