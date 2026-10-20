# Phase 2 Baseline Evaluation Report

Overall result: **PASS**

## Reproducibility metadata

- Git commit: `54750343ef23a6488cdc2342f32cdc3d14ee3531`
- Working tree dirty: `false`
- Fixture corpus: `phase2-v3`
- Fixture manifest SHA-256: `1c2306b9a0794fd1d2bfb1a8d9747cb09f1e7579843b7026e76c899cd44e0ddb`
- Aggregation rules: `v2`
- Ollama model(s): `qwen2.5:7b-instruct`
- Ollama prompt version: `ollama-recipe-extraction-v1` (fingerprint `69a97961`)
- Evaluation mode: deterministic local fixtures; Ollama responses are recorded and network access is not used

## Exit gates

| Gate | Actual | Threshold | Result |
| --- | ---: | ---: | :---: |
| schemaValidity | 100.0% | 100.0% | PASS |
| hallucinatedFieldRate | 0.0% | 0.0% | PASS |
| tier1IngredientRecall | 100.0% | 98.0% | PASS |
| tier1QuantityUnitFidelity | 100.0% | 96.0% | PASS |
| tier2IngredientRecall | 100.0% | 90.0% | PASS |
| tier2QuantityUnitFidelity | 100.0% | 88.0% | PASS |
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
| Tier 1 | 7 | 8 | 100.0% (73/73) | 100.0% (73/73) | 100.0% (17/17) |
| Tier 2 | 6 | 7 | 100.0% (69/69) | 100.0% (69/69) | 100.0% (14/14) |

### Quantity/unit fidelity by ingredient category

| Category | Tier 1 | Tier 2 |
| --- | ---: | ---: |
| mixed-fraction | 100.0% (7/7) | 100.0% (6/6) |
| unicode-fraction | 100.0% (6/6) | 100.0% (6/6) |
| range | 100.0% (7/7) | 100.0% (6/6) |
| dual-unit | 100.0% (7/7) | 100.0% (6/6) |
| abbrev-period | 100.0% (6/6) | 100.0% (6/6) |
| fl-oz | 100.0% (6/6) | 100.0% (6/6) |
| unknown-unit | 100.0% (7/7) | 100.0% (8/8) |
| non-numeric | 100.0% (8/8) | 100.0% (6/6) |
| comma-prep | 100.0% (6/6) | 100.0% (6/6) |
| simple | 100.0% (13/13) | 100.0% (13/13) |

Schema validity: 100.0% (15/15).

Extraction-method fidelity: Tier 1 100.0% (8/8); Tier 2 100.0% (7/7).

Expected-scalar fidelity: Tier 1 100.0% (32/32); Tier 2 100.0% (18/18).

### Quantity/unit mismatches

- None.

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

## Known gaps

The remaining 27 quantity/unit mismatches are tracked as P2-9:

- Unicode mixed fractions: 6 lines.
- Rounded thirds: 2 lines.
- Fluid-ounce units: 12 lines.
- Count units: 7 lines.

## Method

Candidates are paired to hand-written ground truth by title and ingredient overlap rather than array position. Recall uses normalized exact matching against hand-written ingredient lines and instruction steps. Quantity/unit fidelity requires the matched ingredient's parsed quantity, upper range bound, and typed unit to equal ground truth. Unit comparison is case-insensitive. Trailing periods are ignored. Schema validity is established with the production Zod schema. Hallucinations are unexpected populated recipe fields, ingredients, instructions, cooking methods, or extra recipe candidates; missing expected scalar fields are reported separately. A safe aggregation pair is correct only when the canonical quantity, upper range bound, canonical unit, and merge rule all match hand-written ground truth. No LLM judge is used.

The commit recorded is the parent of the commit that adds this report.
