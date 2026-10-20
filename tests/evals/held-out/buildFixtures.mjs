/**
 * Writes the held-out v1 corpus. Expected quantities are assigned from the
 * line text and from the factors published in rules/v1/unit-rules.json.
 * Run: node tests/evals/held-out/buildFixtures.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const CUP = 48;
const TBSP = 3;
const TSP = 1;
const FL_OZ = 6;
const PINT = 96;
const QUART = 192;
const GALLON = 768;
const OZ = 28.349523125;
const LB = 453.59237;

const tier1Lines = [
	line("1 1/2 cups pearled barley", 1.5, "cups", "mixed-fraction"),
	line("2 1/4 tsp caraway seeds", 2.25, "tsp", "mixed-fraction"),
	line("3 1/2 tbsp sesame oil", 3.5, "tbsp", "mixed-fraction"),
	line("1 3/4 cups millet", 1.75, "cups", "mixed-fraction"),
	line("2 1/2 cups wheat berries", 2.5, "cups", "mixed-fraction"),
	line("1 1/4 tsp fennel seed", 1.25, "tsp", "mixed-fraction"),
	line("½ cup tahini", 0.5, "cup", "unicode-fraction"),
	line("¼ tsp ground cardamom", 0.25, "tsp", "unicode-fraction"),
	line("¾ cup coconut milk", 0.75, "cup", "unicode-fraction"),
	line("⅓ cup molasses", 0.3333333333333333, "cup", "unicode-fraction"),
	line("2⅓ cups mushroom stock", 2.3333333333333335, "cups", "unicode-fraction"),
	line("⅛ tsp ground cloves", 0.125, "tsp", "unicode-fraction"),
	line("2 to 3 cans chickpeas", 2, "cans", "range", 3),
	line("4 to 5 cans tomatoes", 4, "cans", "range", 5),
	line("1 to 2 cans pumpkin", 1, "cans", "range", 2),
	line("3-4 bay leaves", 3, null, "range", 4),
	line("5-6 sage leaves", 5, null, "range", 6),
	line("2-3 mint leaves", 2, null, "range", 3),
	line("8 ounces (227g) farro noodles", 8, "ounces", "dual-unit"),
	line("4 ounces (113g) pecans", 4, "ounces", "dual-unit"),
	line("12 ounces (340g) tempeh strips", 12, "ounces", "dual-unit"),
	line("2 cups (480 ml) beet juice", 2, "cups", "dual-unit"),
	line("1 cup (240 ml) apple cider", 1, "cup", "dual-unit"),
	line("3 cups (720 ml) mushroom broth", 3, "cups", "dual-unit"),
	line("1 Tbsp. mustard oil", 1, "Tbsp.", "abbrev-period"),
	line("1 Tbsp. date syrup", 1, "Tbsp.", "abbrev-period"),
	line("½ c. bulgur", 0.5, "c.", "abbrev-period"),
	line("½ c. freekeh", 0.5, "c.", "abbrev-period"),
	line("2 tsp. sumac", 2, "tsp.", "abbrev-period"),
	line("3 oz. halloumi", 3, "oz.", "abbrev-period"),
	line("6 fl oz grapefruit juice", 6, "fl oz", "fl-oz"),
	line("2 fl. oz. rice vinegar", 2, "fl. oz.", "fl-oz"),
	line("7 fl oz ginger beer", 7, "fl oz", "fl-oz"),
	line("4 fl oz vegetable stock", 4, "fl oz", "fl-oz"),
	line("12 fl oz kombucha", 12, "fl oz", "fl-oz"),
	line("5 fl. oz. coconut water", 5, "fl. oz.", "fl-oz"),
	line("2 sprigs marjoram", 2, "sprigs", "unknown-unit"),
	line("1 wedge cabbage", 1, "wedge", "unknown-unit"),
	line("2 stalks lemongrass", 2, "stalks", "unknown-unit"),
	line("3 sprigs savory", 3, "sprigs", "unknown-unit"),
	line("4 wedges fennel", 4, "wedges", "unknown-unit"),
	line("1 stalk celery", 1, "stalk", "unknown-unit"),
	line("pepper as needed", null, null, "non-numeric"),
	line("chili oil as desired", null, null, "non-numeric"),
	line("vinegar as needed", null, null, "non-numeric"),
	line("herbs as desired", null, null, "non-numeric"),
	line("paprika to taste", null, null, "non-numeric"),
	line("broth as needed", null, null, "non-numeric"),
	line("1 shallot, coarsely chopped", 1, null, "comma-prep"),
	line("4 cloves garlic, crushed", 4, "cloves", "comma-prep"),
	line("7 cloves garlic, finely minced", 7, "cloves", "comma-prep"),
	line("1 leek, cut into wedges", 1, null, "comma-prep"),
	line("8 cloves garlic, crushed", 8, "cloves", "comma-prep"),
	line("11 cloves garlic, finely minced", 11, "cloves", "comma-prep"),
	line("200 g brown lentils", 200, "g", "simple"),
	line("1 tsp turmeric", 1, "tsp", "simple"),
	line("180 g chard", 180, "g", "simple"),
	line("275 g beets", 275, "g", "simple"),
	line("1 cup quinoa", 1, "cup", "simple"),
	line("2 tbsp honey", 2, "tbsp", "simple"),
];

const tier2Lines = [
	line("2 1/2 cups polenta", 2.5, "cups", "mixed-fraction"),
	line("1 1/4 tsp smoked paprika", 1.25, "tsp", "mixed-fraction"),
	line("4 1/2 tbsp chili crisp", 4.5, "tbsp", "mixed-fraction"),
	line("3 1/4 cups buckwheat", 3.25, "cups", "mixed-fraction"),
	line("1 1/2 lb parsnips", 1.5, "lb", "mixed-fraction"),
	line("2 3/4 tsp anise seed", 2.75, "tsp", "mixed-fraction"),
	line("½ cup miso", 0.5, "cup", "unicode-fraction"),
	line("¼ cup harissa paste", 0.25, "cup", "unicode-fraction"),
	line("¾ tsp allspice", 0.75, "tsp", "unicode-fraction"),
	line("⅓ cup maple syrup", 0.3333333333333333, "cup", "unicode-fraction"),
	line("⅛ cup yogurt", 0.125, "cup", "unicode-fraction"),
	line("½ tsp cinnamon", 0.5, "tsp", "unicode-fraction"),
	line("6 to 7 cans artichokes", 6, "cans", "range", 7),
	line("2 to 4 cans coconut cream", 2, "cans", "range", 4),
	line("8 to 9 cans hominy", 8, "cans", "range", 9),
	line("7-8 thyme leaves", 7, null, "range", 8),
	line("4-5 oregano leaves", 4, null, "range", 5),
	line("9-10 curry leaves", 9, null, "range", 10),
	line("6 ounces (170g) soba", 6, "ounces", "dual-unit"),
	line("10 ounces (283g) tofu", 10, "ounces", "dual-unit"),
	line("5 ounces (142g) feta", 5, "ounces", "dual-unit"),
	line("4 cups (960 ml) dashi", 4, "cups", "dual-unit"),
	line("5 cups (1200 ml) whey", 5, "cups", "dual-unit"),
	line("6 cups (1440 ml) aquafaba", 6, "cups", "dual-unit"),
	line("2 Tbsp. black vinegar", 2, "Tbsp.", "abbrev-period"),
	line("3 Tbsp. chili oil", 3, "Tbsp.", "abbrev-period"),
	line("½ c. amaranth", 0.5, "c.", "abbrev-period"),
	line("½ c. teff", 0.5, "c.", "abbrev-period"),
	line("4 tsp. zaatar", 4, "tsp.", "abbrev-period"),
	line("6 oz. paneer", 6, "oz.", "abbrev-period"),
	line("3 fl oz yuzu juice", 3, "fl oz", "fl-oz"),
	line("8 fl. oz. clam juice", 8, "fl. oz.", "fl-oz"),
	line("9 fl oz tamarind water", 9, "fl oz", "fl-oz"),
	line("10 fl oz barley tea", 10, "fl oz", "fl-oz"),
	line("11 fl oz aloe juice", 11, "fl oz", "fl-oz"),
	line("1 fl. oz. bitters", 1, "fl. oz.", "fl-oz"),
	line("5 sprigs dill", 5, "sprigs", "unknown-unit"),
	line("2 wedges radicchio", 2, "wedges", "unknown-unit"),
	line("3 stalks rhubarb", 3, "stalks", "unknown-unit"),
	line("6 sprigs tarragon", 6, "sprigs", "unknown-unit"),
	line("2 wedges endive", 2, "wedges", "unknown-unit"),
	line("4 stalks chard", 4, "stalks", "unknown-unit"),
	line("fish sauce as needed", null, null, "non-numeric"),
	line("sesame as desired", null, null, "non-numeric"),
	line("stock to taste", null, null, "non-numeric"),
	line("garnish as desired", null, null, "non-numeric"),
	line("tea as needed", null, null, "non-numeric"),
	line("sauce as needed", null, null, "non-numeric"),
	line("1 fennel bulb, coarsely chopped", 1, null, "comma-prep"),
	line("6 cloves garlic, crushed", 6, "cloves", "comma-prep"),
	line("9 cloves garlic, finely minced", 9, "cloves", "comma-prep"),
	line("2 plums, thinly sliced", 2, null, "comma-prep"),
	line("12 cloves garlic, crushed", 12, "cloves", "comma-prep"),
	line("3 pears, peeled and diced", 3, null, "comma-prep"),
	line("320 g black beans", 320, "g", "simple"),
	line("2 tsp cumin", 2, "tsp", "simple"),
	line("150 g spinach", 150, "g", "simple"),
	line("400 g potatoes", 400, "g", "simple"),
	line("2 cups oats", 2, "cups", "simple"),
	line("3 eggs", 3, null, "simple"),
];

const tier1Recipes = [
	{
		id: "heldout-tier1-barley-bowl",
		title: "Barley and Tahini Bowl",
		pageUrl: "https://public.example/held-out/barley-tahini",
		file: "tier1/barley-tahini.html",
		prep: 5,
		cook: 20,
		total: 25,
		method: "Roast",
		instructions: ["Toast the barley.", "Whisk the tahini and fold it through."],
	},
	{
		id: "heldout-tier1-millet-salad",
		title: "Millet and Citrus Salad",
		pageUrl: "https://public.example/held-out/millet-citrus",
		file: "tier1/millet-citrus.html",
		prep: 10,
		cook: 15,
		total: 25,
		method: "Simmer",
		instructions: ["Simmer the millet.", "Dress it with citrus and herbs."],
	},
	{
		id: "heldout-tier1-lentil-stew",
		title: "Lentil and Grapefruit Stew",
		pageUrl: "https://public.example/held-out/lentil-grapefruit",
		file: "tier1/lentil-grapefruit.html",
		prep: 15,
		cook: 40,
		total: 55,
		method: "Bake",
		instructions: ["Soften the shallot and leek.", "Bake until the lentils are tender."],
	},
];

const tier2Recipes = [
	{
		id: "heldout-tier2-polenta",
		title: "Polenta with Chili Crisp",
		pageUrl: "https://public.example/held-out/polenta-chili",
		file: "tier2/polenta-chili.html",
		card: "wprm",
		instructions: ["Stir the polenta until thick.", "Spoon the chili crisp over the top."],
	},
	{
		id: "heldout-tier2-buckwheat",
		title: "Buckwheat and Yuzu",
		pageUrl: "https://public.example/held-out/buckwheat-yuzu",
		file: "tier2/buckwheat-yuzu.html",
		card: "tasty",
		instructions: ["Boil the buckwheat.", "Finish with yuzu juice."],
	},
	{
		id: "heldout-tier2-soba",
		title: "Soba and Tamarind",
		pageUrl: "https://public.example/held-out/soba-tamarind",
		file: "tier2/soba-tamarind.html",
		card: "mediavine",
		instructions: ["Cook the soba.", "Toss with the tamarind water."],
	},
];

const SAME = "v2.merge-same-dimension";
const ALIAS = "v2.merge-alias";
const KEEP = "v2.keep-separate";

const safeMerges = [
	safe("barley-cup-tbsp", "1 cup barley", "2 tbsp barley", 1 * CUP + 2 * TBSP, "tsp", SAME),
	safe("millet-cup-tsp", "2 cups millet", "1 tsp millet", 2 * CUP + TSP, "tsp", SAME),
	safe("quinoa-tbsp-tsp", "1 tbsp quinoa", "1 tsp quinoa", TBSP + TSP, "tsp", SAME),
	safe("farro-floz-cup", "4 fl oz farro water", "1 cup farro water", 4 * FL_OZ + CUP, "tsp", SAME),
	safe("tahini-pint-cup", "1 pint tahini", "1 cup tahini", PINT + CUP, "tsp", SAME),
	safe("molasses-quart-tbsp", "1 quart molasses", "2 tbsp molasses", QUART + 2 * TBSP, "tsp", SAME),
	safe("bulgur-cup-tbsp", "3 cups bulgur", "1 tbsp bulgur", 3 * CUP + TBSP, "tsp", SAME),
	safe("polenta-tbsp-tsp", "2 tbsp polenta", "2 tsp polenta", 2 * TBSP + 2 * TSP, "tsp", SAME),
	safe("honey-cups", "1 cup honey", "1 cup honey", 2 * CUP, "tsp", SAME),
	safe("buttermilk-floz-tbsp", "2 fl oz buttermilk", "1 tbsp buttermilk", 2 * FL_OZ + TBSP, "tsp", SAME),
	safe("lentils-g-oz", "100 g lentils", "1 oz lentils", 100 + OZ, "g", SAME),
	safe("chickpeas-lb-oz", "1 lb chickpeas", "8 oz chickpeas", LB + 8 * OZ, "g", SAME),
	safe("tempeh-kg-g", "1 kg tempeh", "250 g tempeh", 1000 + 250, "g", SAME),
	safe("walnuts-ounces", "2 oz walnuts", "2 oz walnuts", 4 * OZ, "g", SAME),
	safe("pecans-g-lb", "500 g pecans", "1 lb pecans", 500 + LB, "g", SAME),
	safe("rice-oz-g", "3 oz rice", "100 g rice", 3 * OZ + 100, "g", SAME),
	safe("oats-oz-lb", "1 oz oats", "1 lb oats", OZ + LB, "g", SAME),
	safe("potatoes-kg", "2 kg potatoes", "1 kg potatoes", 3000, "g", SAME),
	safe("spinach-g-oz", "50 g spinach", "2 oz spinach", 50 + 2 * OZ, "g", SAME),
	safe("tofu-oz-lb", "4 oz tofu", "1 lb tofu", 4 * OZ + LB, "g", SAME),
	safe("broth-ml-l", "500 ml broth", "1 l broth", 1500, "ml", SAME),
	safe("stock-ml", "250 ml stock", "250 ml stock", 500, "ml", SAME),
	safe("whey-liter-ml", "1 liter whey", "200 ml whey", 1200, "ml", SAME),
	safe("dashi-liters", "2 l dashi", "1 l dashi", 3000, "ml", SAME),
	safe("cider-ml-liter", "100 ml cider", "1 liter cider", 1100, "ml", SAME),
	safe("juice-ml", "750 ml juice", "250 ml juice", 1000, "ml", SAME),
	safe("tomatoes-cans", "3 cans artichoke hearts", "1 can artichoke hearts", 4, "can", SAME),
	safe("beans-cans", "2 cans beans", "2 cans beans", 4, "can", SAME),
	safe("ginger-pieces", "1 piece ginger", "3 pieces ginger", 4, "piece", SAME),
	safe("parsley-bunches", "2 bunches marjoram", "1 bunch marjoram", 3, "bunch", SAME),
	safe("scallion-alias", "3 cups scallions", "1 tbsp green onions", 3 * CUP + TBSP, "tsp", ALIAS),
	safe("water-cups", "4 cups water", "2 tbsp water", 4 * CUP + 2 * TBSP, "tsp", ALIAS),
	safe("butter-tbsp-tsp", "3 tbsp butter", "2 tsp butter", 3 * TBSP + 2 * TSP, "tsp", ALIAS),
	safe("flour-g-oz", "100 g flour", "1 oz all-purpose flour", 100 + OZ, "g", ALIAS),
	safe("garlic-cloves", "9 cloves garlic", "7 cloves garlic", 16, "clove", ALIAS),
	safe("cilantro-alias", "2 cups cilantro", "2 tbsp coriander leaves", 2 * CUP + 2 * TBSP, "tsp", ALIAS),
	safe("chicken-oz-lb", "8 oz chicken", "1 lb chicken thighs", 8 * OZ + LB, "g", ALIAS),
	safe("salt-tsp-tbsp", "6 tsp salt", "1 tbsp salt", 6 * TSP + TBSP, "tsp", ALIAS),
	safe("coriander-alias", "2 tsp coriander", "2 tbsp coriander seeds", 2 * TSP + 2 * TBSP, "tsp", ALIAS),
	safe("scallion-floz", "2 cups green onions", "1 fl oz scallions", 2 * CUP + FL_OZ, "tsp", ALIAS),
	safe("freekeh-cup-tbsp", "1 cup freekeh", "3 tbsp freekeh", CUP + 3 * TBSP, "tsp", SAME),
	safe("amaranth-tsp-tbsp", "2 tsp amaranth", "2 tbsp amaranth", 2 * TSP + 2 * TBSP, "tsp", SAME),
	safe("sorghum-gallon-cup", "1 gal sorghum", "1 cup sorghum", GALLON + CUP, "tsp", SAME),
	safe("teff-pint-tsp", "1 pt teff", "2 tsp teff", PINT + 2 * TSP, "tsp", SAME),
	safe("seitan-ounces", "6 oz seitan", "6 oz seitan", 12 * OZ, "g", SAME),
	safe("lentils-pounds", "1 lb lentils", "1 lb lentils", 2 * LB, "g", SAME),
	safe("kombucha-l-ml", "2 l kombucha", "500 ml kombucha", 2500, "ml", SAME),
	safe("hominy-cans", "3 cans hominy", "1 can hominy", 4, "can", SAME),
	safe("tempeh-pieces", "1 piece tempeh", "1 piece tempeh", 2, "piece", SAME),
	safe("dill-bunches", "1 bunch dill", "2 bunches dill", 3, "bunch", SAME),
];

const unsafeMerges = [
	unsafe("xdim-barley", "1 cup barley", "100 g barley", "cross-dimension"),
	unsafe("xdim-millet", "1 cup millet", "100 g millet", "cross-dimension"),
	unsafe("xdim-quinoa", "1 cup quinoa", "50 g quinoa", "cross-dimension"),
	unsafe("xdim-farro", "1 cup farro", "200 g farro", "cross-dimension"),
	unsafe("xdim-lentils", "2 cups lentils", "1 oz lentils", "cross-dimension"),
	unsafe("xdim-flour", "2 cups flour", "200 g all-purpose flour", "cross-dimension"),
	unsafe("xdim-water", "5 cups water", "50 g water", "cross-dimension"),
	unsafe("xdim-butter", "4 tbsp butter", "30 g butter", "cross-dimension"),
	unsafe("xdim-chicken", "1 cup chicken", "200 g chicken", "cross-dimension"),
	unsafe("xdim-salt", "3 tsp salt", "6 g salt", "cross-dimension"),
	unsafe("count-garlic-clove-bunch", "6 cloves garlic", "2 bunches garlic", "count-unit"),
	unsafe("count-tomatoes-can-piece", "3 cans artichoke hearts", "1 piece artichoke hearts", "count-unit"),
	unsafe("count-parsley-bunch-piece", "2 bunches marjoram", "4 pieces marjoram", "count-unit"),
	unsafe("count-beans-can-bunch", "2 cans beans", "1 bunch beans", "count-unit"),
	unsafe("count-ginger-piece-bunch", "1 piece ginger", "1 bunch ginger", "count-unit"),
	unsafe("count-garlic-clove-can", "8 cloves garlic", "1 can garlic", "count-unit"),
	unsafe("count-dill-bunch-can", "1 bunch dill", "1 can dill", "count-unit"),
	unsafe("count-tofu-piece-can", "3 pieces tofu", "1 can tofu", "count-unit"),
	unsafe("count-scallion-bunch-piece", "2 bunches scallions", "1 piece scallions", "count-unit"),
	unsafe("count-chicken-can-clove", "1 can chicken", "2 cloves chicken", "count-unit"),
	unsafe("fresh-basil", "1 cup fresh basil", "1 cup dried basil", "blocking-qualifier"),
	unsafe("fresh-thyme", "1 tbsp fresh thyme", "1 tbsp dried thyme", "blocking-qualifier"),
	unsafe("fresh-mint", "2 cups fresh mint", "2 cups dried mint", "blocking-qualifier"),
	unsafe("fresh-oregano", "2 tsp fresh oregano", "2 tsp dried oregano", "blocking-qualifier"),
	unsafe("fresh-ginger", "1 lb fresh ginger", "1 lb dried ginger", "blocking-qualifier"),
	unsafe("fresh-turmeric", "100 g fresh turmeric", "100 g dried turmeric", "blocking-qualifier"),
	unsafe("salted-butter", "3 tbsp salted butter", "3 tbsp unsalted butter", "blocking-qualifier"),
	unsafe("salted-butter-volume", "2 tbsp salted butter", "1 tsp unsalted butter", "blocking-qualifier"),
	unsafe("raw-chicken-cup", "1 cup raw chicken", "1 cup cooked chicken", "blocking-qualifier"),
	unsafe("raw-chicken-mass", "2 lb raw chicken", "4 oz cooked chicken", "blocking-qualifier"),
	unsafe("whole-coriander", "2 tsp whole coriander", "2 tsp ground coriander", "blocking-qualifier"),
	unsafe("whole-coriander-seeds", "1 tbsp whole coriander", "2 tsp ground coriander seeds", "blocking-qualifier"),
	unsafe("bone-chicken", "2 lb boneless chicken", "8 oz bone-in chicken", "blocking-qualifier"),
	unsafe("bone-chicken-thigh", "2 cups boneless chicken", "1 cup bone-in chicken thighs", "blocking-qualifier"),
	unsafe("dried-cilantro", "2 cups fresh cilantro", "2 tbsp dried cilantro", "blocking-qualifier"),
	unsafe("metric-barley", "1 cup barley", "240 ml barley", "cross-system-volume"),
	unsafe("metric-millet", "1 tbsp millet", "15 ml millet", "cross-system-volume"),
	unsafe("metric-quinoa", "1 tsp quinoa", "5 ml quinoa", "cross-system-volume"),
	unsafe("metric-farro", "1 fl oz farro water", "30 ml farro water", "cross-system-volume"),
	unsafe("metric-broth", "3 cups broth", "50 ml broth", "cross-system-volume"),
	unsafe("metric-stock", "2 cups stock", "100 ml stock", "cross-system-volume"),
	unsafe("metric-whey", "1 pint whey", "100 ml whey", "cross-system-volume"),
	unsafe("metric-dashi", "1 quart dashi", "1 l dashi", "cross-system-volume"),
	unsafe("salted-butter-mass", "1 oz salted butter", "1 oz unsalted butter", "blocking-qualifier"),
	unsafe("raw-shrimp", "100 g raw shrimp", "100 g cooked shrimp", "blocking-qualifier"),
	unsafe("whole-flour", "1 cup whole flour", "1 cup ground flour", "blocking-qualifier"),
	unsafe("fresh-basil-mixed", "2 tsp fresh basil", "1 tbsp dried basil", "blocking-qualifier"),
	unsafe("bone-thigh-mass", "2 lb boneless chicken thighs", "8 oz bone-in chicken thighs", "blocking-qualifier"),
	unsafe("fresh-garlic", "3 cloves fresh garlic", "1 clove dried garlic", "blocking-qualifier"),
	unsafe("salted-water", "1 cup salted water", "1 cup unsalted water", "blocking-qualifier"),
];

function line(raw, quantity, unit, category, quantityMax) {
	return { raw, quantity, unit, category, ...(quantityMax == null ? {} : { quantityMax }) };
}

function safe(id, left, right, expectedQuantity, expectedUnit, expectedMergeRuleId) {
	return { id, left, right, expectedQuantity, expectedQuantityMax: null, expectedUnit, expectedMergeRuleId };
}

function unsafe(id, left, right, category) {
	return { id, left, right, category, expectedMergeRuleId: KEEP };
}

function buckets(items, recipes) {
	const groups = recipes.map(() => []);
	items.forEach((item, index) => groups[index % recipes.length].push(item));
	return groups;
}

function jsonLdPage(recipe, ingredients) {
	const data = {
		"@context": "https://schema.org",
		"@type": "Recipe",
		name: recipe.title,
		url: recipe.pageUrl,
		author: { "@type": "Person", name: "Public Domain Test Kitchen" },
		publisher: { name: "Open Recipes" },
		recipeYield: "4 servings",
		prepTime: `PT${recipe.prep}M`,
		cookTime: `PT${recipe.cook}M`,
		totalTime: `PT${recipe.total}M`,
		cookingMethod: recipe.method,
		recipeIngredient: ingredients.map((item) => item.raw),
		recipeInstructions: recipe.instructions.map((text) => ({ "@type": "HowToStep", text })),
	};
	return `<!doctype html><html><head><meta property="og:site_name" content="Open Recipes"><script type="application/ld+json">\n${JSON.stringify(data)}\n</script></head><body><h1>${recipe.title}</h1></body></html>\n`;
}

function cardPage(recipe, ingredients) {
	const items = ingredients.map((item) => `<li>${item.raw}</li>`).join("");
	const steps = recipe.instructions.map((text) => `<li>${text}</li>`).join("");
	if (recipe.card === "wprm") {
		const wprmItems = ingredients.map((item) => `<li class="wprm-recipe-ingredient">${item.raw}</li>`).join("");
		const wprmSteps = recipe.instructions.map((text) => `<li class="wprm-recipe-instruction">${text}</li>`).join("");
		return `<!doctype html><html><head><title>${recipe.title}</title></head><body><article class="wprm-recipe"><h2 class="wprm-recipe-name">${recipe.title}</h2><ul>${wprmItems}</ul><ol>${wprmSteps}</ol></article></body></html>\n`;
	}
	if (recipe.card === "tasty") {
		return `<!doctype html><html><head><title>${recipe.title}</title></head><body><div class="tasty-recipes"><h2 class="tasty-recipes-title">${recipe.title}</h2><div class="tasty-recipes-ingredients"><ul>${items}</ul></div><div class="tasty-recipes-instructions"><ol>${steps}</ol></div></div></body></html>\n`;
	}
	return `<!doctype html><html><head><title>${recipe.title}</title></head><body><div class="mv-create-card"><h2 class="mv-create-title">${recipe.title}</h2><div class="mv-create-ingredients"><ul>${items}</ul></div><div class="mv-create-instructions"><ol>${steps}</ol></div></div></body></html>\n`;
}

function fixture(recipe, ingredients, tier) {
	return {
		id: recipe.id,
		tier,
		file: recipe.file,
		pageUrl: recipe.pageUrl,
		expected: [
			{
				title: recipe.title,
				extractionMethod: tier === 1 ? "json-ld" : "dom-heuristic",
				ingredients,
				instructions: recipe.instructions,
				servingsRaw: tier === 1 ? "4 servings" : null,
				prepTimeMinutes: tier === 1 ? recipe.prep : null,
				cookTimeMinutes: tier === 1 ? recipe.cook : null,
				totalTimeMinutes: tier === 1 ? recipe.total : null,
				cookingMethods: tier === 1 ? [recipe.method] : [],
				author: tier === 1 ? "Public Domain Test Kitchen" : null,
				siteName: tier === 1 ? "Open Recipes" : null,
			},
		],
	};
}

if (safeMerges.length !== 50 || unsafeMerges.length !== 50) {
	throw new Error(`Expected 50/50 pairs, got ${safeMerges.length}/${unsafeMerges.length}`);
}
if (tier1Lines.length !== 60 || tier2Lines.length !== 60) {
	throw new Error(`Expected 60/60 lines, got ${tier1Lines.length}/${tier2Lines.length}`);
}

const tier1Groups = buckets(tier1Lines, tier1Recipes);
const tier2Groups = buckets(tier2Lines, tier2Recipes);
const manifest = {
	version: "held-out-v1",
	promptVersion: "ollama-recipe-extraction-v1",
	fixtures: [
		...tier1Recipes.map((recipe, index) => fixture(recipe, tier1Groups[index], 1)),
		...tier2Recipes.map((recipe, index) => fixture(recipe, tier2Groups[index], 2)),
	],
};

mkdirSync(resolve(root, "tier1"), { recursive: true });
mkdirSync(resolve(root, "tier2"), { recursive: true });
mkdirSync(resolve(root, "aggregation"), { recursive: true });
tier1Recipes.forEach((recipe, index) => {
	writeFileSync(resolve(root, recipe.file), jsonLdPage(recipe, tier1Groups[index]));
});
tier2Recipes.forEach((recipe, index) => {
	writeFileSync(resolve(root, recipe.file), cardPage(recipe, tier2Groups[index]));
});
writeFileSync(resolve(root, "manifest.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
writeFileSync(
	resolve(root, "aggregation/pairs.json"),
	`${JSON.stringify({ safeMerges, unsafeMerges }, null, "\t")}\n`,
);
