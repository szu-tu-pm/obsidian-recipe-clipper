# Held-Out v1 Evaluation Report

Overall result: **PASS**

## Reproducibility metadata

- Git commit: `29105b31d758c818b76d95aac2154a0829a8433d`
- Working tree dirty: `false`
- Fixture corpus: `held-out-v1`
- Fixture manifest SHA-256: `8ff0ec7db6cb22bcd615c2f4946d54d31010b253153225f41dcb1f661e8dddda`
- Aggregation rules: `v2`
- Ollama model(s): not used
- Ollama prompt version: not used
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
| tier1Ingredients | 60 | 50 | PASS |
| tier2Ingredients | 60 | 50 | PASS |
| safeMergePairs | 50 | 50 | PASS |
| unsafeMergePairs | 50 | 50 | PASS |

## Extraction fidelity

| Corpus | Fixtures | Recipes | Ingredient recall | Quantity/unit fidelity | Instruction fidelity |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tier 1 | 3 | 3 | 100.0% (60/60) | 100.0% (60/60) | 100.0% (6/6) |
| Tier 2 | 3 | 3 | 100.0% (60/60) | 100.0% (60/60) | 100.0% (6/6) |

### Quantity/unit fidelity by ingredient category

| Category | Tier 1 | Tier 2 |
| --- | ---: | ---: |
| mixed-fraction | 100.0% (6/6) | 100.0% (6/6) |
| unicode-fraction | 100.0% (6/6) | 100.0% (6/6) |
| range | 100.0% (6/6) | 100.0% (6/6) |
| dual-unit | 100.0% (6/6) | 100.0% (6/6) |
| abbrev-period | 100.0% (6/6) | 100.0% (6/6) |
| fl-oz | 100.0% (6/6) | 100.0% (6/6) |
| unknown-unit | 100.0% (6/6) | 100.0% (6/6) |
| non-numeric | 100.0% (6/6) | 100.0% (6/6) |
| comma-prep | 100.0% (6/6) | 100.0% (6/6) |
| simple | 100.0% (6/6) | 100.0% (6/6) |

Schema validity: 100.0% (6/6).

Extraction-method fidelity: Tier 1 100.0% (3/3); Tier 2 100.0% (3/3).

Expected-scalar fidelity: Tier 1 100.0% (21/21); Tier 2 100.0% (3/3).

### Quantity/unit mismatches

- None.

### Missing expected scalar fields

- None.

### Extraction-method mismatches

- None.

Hallucinated fields: 0 across 159 evaluated output fields (0.0%).

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

- None.

## Method

Candidates are paired to hand-written ground truth by title and ingredient overlap rather than array position. Recall uses normalized exact matching against hand-written ingredient lines and instruction steps. Quantity/unit fidelity requires the matched ingredient's parsed quantity, upper range bound, and typed unit to equal ground truth. Unit comparison is case-insensitive. Trailing periods are ignored. Schema validity is established with the production Zod schema. Hallucinations are unexpected populated recipe fields, ingredients, instructions, cooking methods, or extra recipe candidates; missing expected scalar fields are reported separately. A safe aggregation pair is correct only when the canonical quantity, upper range bound, canonical unit, and merge rule all match hand-written ground truth. No LLM judge is used.

The commit recorded is the parent of the commit that adds this report.

## Coverage

The held-out script does not remeasure coverage. `npm run test:coverage` enforces the thresholds in `vitest.config.mts`: 80% lines, statements, functions, and branches overall, and 90% for those four metrics under `src/domain/aggregation` and `src/domain/extraction`. CI runs that command on every pull request.

| Scope | Lines | Statements | Functions | Branches | Threshold | Result |
| --- | ---: | ---: | ---: | ---: | ---: | :---: |
| Overall | 85.9% | 85.9% | 86.5% | 81.8% | 80% | PASS |
| src/domain/aggregation | 97.0% | 96.8% | 98.5% | 91.7% | 90% | PASS |
| src/domain/extraction | 97.3% | 97.1% | 98.5% | 90.2% | 90% | PASS |

## What this corpus leaves out

This run does not call Ollama. Tier 2 pages are DOM recipe cards only. The Loom walkthrough is recorded by a person against a vault that contains only these public fixtures.

If `workingTreeDirty` is `true`, this file was written before the code commit. Regenerate it on that clean commit before treating the recorded SHA as the baseline.
