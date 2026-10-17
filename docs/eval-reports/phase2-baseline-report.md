# Phase 2 Baseline Evaluation Report

Overall result: **PASS**

## Reproducibility metadata

- Git commit: `ba5bb591d6b7cd511547b445f6304f5695fd595e`
- Working tree dirty: `true`
- Fixture corpus: `phase2-v2`
- Fixture manifest SHA-256: `526ce2272c8404f494a49fad65acfd488ad143d30addf55a0211c92904a7bee8`
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
| tier1QuantityUnitFidelity | 98.2% | 96.0% | PASS |
| tier2IngredientRecall | 100.0% | 90.0% | PASS |
| tier2QuantityUnitFidelity | 100.0% | 88.0% | PASS |
| falseMergeRate | 0.0% | 0.0% | PASS |
| safeMergeRecall | 100.0% | 92.0% | PASS |

## Corpus denominator floors

| Corpus | Actual | Minimum | Result |
| --- | ---: | ---: | :---: |
| tier1Ingredients | 55 | 50 | PASS |
| tier2Ingredients | 52 | 50 | PASS |
| safeMergePairs | 50 | 50 | PASS |
| unsafeMergePairs | 50 | 50 | PASS |

## Extraction fidelity

| Corpus | Fixtures | Recipes | Ingredient recall | Quantity/unit fidelity | Instruction fidelity |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tier 1 | 7 | 8 | 100.0% (55/55) | 98.2% (54/55) | 100.0% (17/17) |
| Tier 2 | 6 | 7 | 100.0% (52/52) | 100.0% (52/52) | 100.0% (14/14) |

Schema validity: 100.0% (15/15).

Extraction-method fidelity: Tier 1 100.0% (8/8); Tier 2 100.0% (7/7).

Expected-scalar fidelity: Tier 1 100.0% (32/32); Tier 2 100.0% (18/18).

### Quantity/unit mismatches

- tier1-graph-multi recipe 1: '2 sprigs thyme' expected quantity=2, quantityMax=null, unit=sprigs; observed quantity=2, quantityMax=null, unit=null

### Missing expected scalar fields

- None.

### Extraction-method mismatches

- None.

Hallucinated fields: 0 across 191 evaluated output fields (0.0%).

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
