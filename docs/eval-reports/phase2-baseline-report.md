# Phase 2 Baseline Evaluation Report

Overall result: **PASS**

## Reproducibility metadata

- Git commit: `0e61fcc4a4bc6b068797751c4bc13566d0c64297`
- Fixture corpus: `phase2-v1`
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
| tier1QuantityUnitFidelity | 96.0% | 96.0% | PASS |
| tier2IngredientRecall | 100.0% | 90.0% | PASS |
| tier2QuantityUnitFidelity | 100.0% | 88.0% | PASS |
| falseMergeRate | 0.0% | 0.0% | PASS |
| safeMergeRecall | 100.0% | 92.0% | PASS |

## Extraction fidelity

| Corpus | Fixtures | Recipes | Ingredient recall | Quantity/unit fidelity | Instruction fidelity |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tier 1 | 5 | 6 | 100.0% (25/25) | 96.0% (24/25) | 100.0% (13/13) |
| Tier 2 | 3 | 4 | 100.0% (9/9) | 100.0% (9/9) | 100.0% (8/8) |

Schema validity: 100.0% (10/10).

### Quantity/unit mismatches

- tier1-graph-multi recipe 1: '2 sprigs thyme' expected quantity=2, quantityMax=null, unit=sprigs; observed quantity=2, quantityMax=null, unit=null

Hallucinated fields: 0 across 99 evaluated output fields (0.0%).

### Hallucinated field details

- None.

## Aggregation compatibility

False merges: 0/13 (0.0%).

Safe-merge recall: 13/13 (100.0%).

### False merges

- None.

### Missed safe merges

- None.

## Method

Recall uses normalized exact matching against hand-written ingredient lines and instruction steps. Quantity/unit fidelity requires the matched ingredient's parsed quantity, upper range bound, and typed unit to equal ground truth. Schema validity is established with the production Zod schema. Hallucinations are unexpected populated recipe fields, ingredients, instructions, cooking methods, or extra recipe candidates. Aggregation is evaluated by executing the production deterministic rules over labeled safe and unsafe pairs; no LLM judge is used.
