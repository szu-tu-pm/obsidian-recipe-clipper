# Phase 2 Baseline Evaluation Report

Overall result: **FAIL**

## Reproducibility metadata

- Git commit: `a6483eb2082ce7265bb7f5063a415cacfe4cf69e`
- Working tree dirty: `true`
- Fixture corpus: `phase2-v3`
- Fixture manifest SHA-256: `1c2306b9a0794fd1d2bfb1a8d9747cb09f1e7579843b7026e76c899cd44e0ddb`
- Aggregation rules: `v1`
- Ollama model(s): `qwen2.5:7b-instruct`
- Ollama prompt version: `ollama-recipe-extraction-v1` (fingerprint `69a97961`)
- Evaluation mode: deterministic local fixtures; Ollama responses are recorded and network access is not used

## Exit gates

| Gate | Actual | Threshold | Result |
| --- | ---: | ---: | :---: |
| schemaValidity | 100.0% | 100.0% | PASS |
| hallucinatedFieldRate | 0.0% | 0.0% | PASS |
| tier1IngredientRecall | 100.0% | 98.0% | PASS |
| tier1QuantityUnitFidelity | 72.6% | 96.0% | FAIL |
| tier2IngredientRecall | 100.0% | 90.0% | PASS |
| tier2QuantityUnitFidelity | 72.5% | 88.0% | FAIL |
| falseMergeRate | 0.0% | 0.0% | PASS |
| safeMergeRecall | 100.0% | 92.0% | PASS |

## Corpus denominator floors

| Corpus | Actual | Minimum | Result |
| --- | ---: | ---: | :---: |
| tier1Ingredients | 73 | 50 | PASS |
| tier2Ingredients | 69 | 50 | PASS |
| safeMergePairs | 50 | 50 | PASS |
| unsafeMergePairs | 50 | 50 | PASS |

## Extraction fidelity

| Corpus | Fixtures | Recipes | Ingredient recall | Quantity/unit fidelity | Instruction fidelity |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tier 1 | 7 | 8 | 100.0% (73/73) | 72.6% (53/73) | 100.0% (17/17) |
| Tier 2 | 6 | 7 | 100.0% (69/69) | 72.5% (50/69) | 100.0% (14/14) |

### Quantity/unit fidelity by ingredient category

| Category | Tier 1 | Tier 2 |
| --- | ---: | ---: |
| mixed-fraction | 100.0% (7/7) | 100.0% (6/6) |
| unicode-fraction | 33.3% (2/6) | 33.3% (2/6) |
| range | 100.0% (7/7) | 100.0% (6/6) |
| dual-unit | 100.0% (7/7) | 100.0% (6/6) |
| abbrev-period | 0.0% (0/6) | 0.0% (0/6) |
| fl-oz | 0.0% (0/6) | 0.0% (0/6) |
| unknown-unit | 42.9% (3/7) | 62.5% (5/8) |
| non-numeric | 100.0% (8/8) | 100.0% (6/6) |
| comma-prep | 100.0% (6/6) | 100.0% (6/6) |
| simple | 100.0% (13/13) | 100.0% (13/13) |

Schema validity: 100.0% (15/15).

Extraction-method fidelity: Tier 1 100.0% (8/8); Tier 2 100.0% (7/7).

Expected-scalar fidelity: Tier 1 100.0% (32/32); Tier 2 100.0% (18/18).

### Quantity/unit mismatches

- tier1-graph-multi recipe 1: '2 sprigs thyme' expected quantity=2, quantityMax=null, unit=sprigs; observed quantity=2, quantityMax=null, unit=null
- tier1-large-jsonld recipe 1: '1¼ cups milk' expected quantity=1.25, quantityMax=null, unit=cups; observed quantity=2.75, quantityMax=null, unit=cups
- tier1-large-jsonld recipe 1: '2 Tbsp. tomato paste' expected quantity=2, quantityMax=null, unit=Tbsp.; observed quantity=2, quantityMax=null, unit=Tbsp
- tier1-large-jsonld recipe 1: '1 c. frozen peas' expected quantity=1, quantityMax=null, unit=c.; observed quantity=1, quantityMax=null, unit=c
- tier1-large-jsonld recipe 1: '8 fl oz apple juice' expected quantity=8, quantityMax=null, unit=fl oz; observed quantity=8, quantityMax=null, unit=null
- tier1-large-jsonld recipe 1: '2 fl. oz. cider vinegar' expected quantity=2, quantityMax=null, unit=fl. oz.; observed quantity=2, quantityMax=null, unit=null
- tier1-large-jsonld recipe 1: '2 sprigs rosemary' expected quantity=2, quantityMax=null, unit=sprigs; observed quantity=2, quantityMax=null, unit=null
- tier1-array-jsonld recipe 1: '2½ cups cooked lentils' expected quantity=2.5, quantityMax=null, unit=cups; observed quantity=10.5, quantityMax=null, unit=cups
- tier1-array-jsonld recipe 1: '1 Tbsp. tahini' expected quantity=1, quantityMax=null, unit=Tbsp.; observed quantity=1, quantityMax=null, unit=Tbsp
- tier1-array-jsonld recipe 1: '2 oz. feta' expected quantity=2, quantityMax=null, unit=oz.; observed quantity=2, quantityMax=null, unit=oz
- tier1-array-jsonld recipe 1: '6 fl oz pomegranate juice' expected quantity=6, quantityMax=null, unit=fl oz; observed quantity=6, quantityMax=null, unit=null
- tier1-array-jsonld recipe 1: '1 fl. oz. lemon juice' expected quantity=1, quantityMax=null, unit=fl. oz.; observed quantity=1, quantityMax=null, unit=null
- tier1-rdfa-recipe recipe 1: '⅓ cup chopped mint' expected quantity=0.3333333333333333, quantityMax=null, unit=cup; observed quantity=0.33, quantityMax=null, unit=cup
- tier1-rdfa-recipe recipe 1: '1½ tsp sumac' expected quantity=1.5, quantityMax=null, unit=tsp; observed quantity=5.5, quantityMax=null, unit=tsp
- tier1-rdfa-recipe recipe 1: '3 tsp. lemon zest' expected quantity=3, quantityMax=null, unit=tsp.; observed quantity=3, quantityMax=null, unit=tsp
- tier1-rdfa-recipe recipe 1: '½ c. toasted seeds' expected quantity=0.5, quantityMax=null, unit=c.; observed quantity=0.5, quantityMax=null, unit=c
- tier1-rdfa-recipe recipe 1: '4 fl oz orange juice' expected quantity=4, quantityMax=null, unit=fl oz; observed quantity=4, quantityMax=null, unit=null
- tier1-rdfa-recipe recipe 1: '3 fl. oz. olive brine' expected quantity=3, quantityMax=null, unit=fl. oz.; observed quantity=3, quantityMax=null, unit=null
- tier1-rdfa-recipe recipe 1: '2 handfuls lettuce' expected quantity=2, quantityMax=null, unit=handfuls; observed quantity=2, quantityMax=null, unit=null
- tier1-rdfa-recipe recipe 1: '1 head radicchio' expected quantity=1, quantityMax=null, unit=head; observed quantity=1, quantityMax=null, unit=null
- tier2-wprm-large recipe 1: '1¾ cups sliced carrots' expected quantity=1.75, quantityMax=null, unit=cups; observed quantity=3.25, quantityMax=null, unit=cups
- tier2-wprm-large recipe 1: '2 Tbsp. balsamic vinegar' expected quantity=2, quantityMax=null, unit=Tbsp.; observed quantity=2, quantityMax=null, unit=Tbsp
- tier2-wprm-large recipe 1: '4 oz. mushrooms' expected quantity=4, quantityMax=null, unit=oz.; observed quantity=4, quantityMax=null, unit=oz
- tier2-wprm-large recipe 1: '5 fl oz apple cider' expected quantity=5, quantityMax=null, unit=fl oz; observed quantity=5, quantityMax=null, unit=null
- tier2-wprm-large recipe 1: '1 fl. oz. lemon juice' expected quantity=1, quantityMax=null, unit=fl. oz.; observed quantity=1, quantityMax=null, unit=null
- tier2-wprm-large recipe 1: '3 sprigs thyme' expected quantity=3, quantityMax=null, unit=sprigs; observed quantity=3, quantityMax=null, unit=null
- tier2-tasty-large recipe 1: '2⅓ cups vegetable broth' expected quantity=2.3333333333333335, quantityMax=null, unit=cups; observed quantity=7, quantityMax=null, unit=cups
- tier2-tasty-large recipe 1: '1 Tbsp. olive oil' expected quantity=1, quantityMax=null, unit=Tbsp.; observed quantity=1, quantityMax=null, unit=Tbsp
- tier2-tasty-large recipe 1: '½ c. sweet corn' expected quantity=0.5, quantityMax=null, unit=c.; observed quantity=0.5, quantityMax=null, unit=c
- tier2-tasty-large recipe 1: '7 fl oz bean broth' expected quantity=7, quantityMax=null, unit=fl oz; observed quantity=7, quantityMax=null, unit=null
- tier2-tasty-large recipe 1: '2 fl. oz. lime juice' expected quantity=2, quantityMax=null, unit=fl. oz.; observed quantity=2, quantityMax=null, unit=null
- tier2-tasty-large recipe 1: '1 wedge lime' expected quantity=1, quantityMax=null, unit=wedge; observed quantity=1, quantityMax=null, unit=null
- tier2-mediavine-large recipe 1: '⅔ cup raisins' expected quantity=0.6666666666666666, quantityMax=null, unit=cup; observed quantity=0.67, quantityMax=null, unit=cup
- tier2-mediavine-large recipe 1: '1½ tsp cinnamon' expected quantity=1.5, quantityMax=null, unit=tsp; observed quantity=5.5, quantityMax=null, unit=tsp
- tier2-mediavine-large recipe 1: '2 Tbsp. maple syrup' expected quantity=2, quantityMax=null, unit=Tbsp.; observed quantity=2, quantityMax=null, unit=Tbsp
- tier2-mediavine-large recipe 1: '1 c. chopped walnuts' expected quantity=1, quantityMax=null, unit=c.; observed quantity=1, quantityMax=null, unit=c
- tier2-mediavine-large recipe 1: '6 fl oz apple juice' expected quantity=6, quantityMax=null, unit=fl oz; observed quantity=6, quantityMax=null, unit=null
- tier2-mediavine-large recipe 1: '3 fl. oz. orange juice' expected quantity=3, quantityMax=null, unit=fl. oz.; observed quantity=3, quantityMax=null, unit=null
- tier2-mediavine-large recipe 1: '2 scoops yogurt' expected quantity=2, quantityMax=null, unit=scoops; observed quantity=2, quantityMax=null, unit=null

### Missing expected scalar fields

- None.

### Extraction-method mismatches

- None.

Hallucinated fields: 0 across 226 evaluated output fields (0.0%).

### Hallucinated field details

- None.

## Aggregation compatibility

False merges: 0/50 (0.0%).

Safe-merge recall: 50/50 (100.0%).

### False merges

- None.

### Missed safe merges

- None.

### Wrong-quantity safe merges

- None.

### Incorrect-unit or rule safe merges

- None.

### Unsafe-pair rule mismatches

- None.

## Method

Candidates are paired to hand-written ground truth by title and ingredient overlap rather than array position. Recall uses normalized exact matching against hand-written ingredient lines and instruction steps. Quantity/unit fidelity requires the matched ingredient's parsed quantity, upper range bound, and typed unit to equal ground truth. Schema validity is established with the production Zod schema. Hallucinations are unexpected populated recipe fields, ingredients, instructions, cooking methods, or extra recipe candidates; missing expected scalar fields are reported separately. A safe aggregation pair is correct only when the canonical quantity, upper range bound, canonical unit, and merge rule all match hand-written ground truth. No LLM judge is used.
