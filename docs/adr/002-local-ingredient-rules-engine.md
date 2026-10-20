# ADR-002: Local rules engine instead of runtime LLM merging

- Status: accepted
- Date: 2026-10-20

## Context

A shopping list should combine "1 cup scallions" and "2 tbsp green onions" when they are the same ingredient in compatible units. An LLM can guess that those lines match, and it can also guess that "1 cup flour" and "120 g flour" match. The second guess needs a density the page did not state. A model can also treat "fresh basil" and "dried basil" as the same pantry item.

The plugin already has an optional local model for extraction and translation. Using it to decide merges would make shopping lists depend on a running model, a prompt, and a nondeterministic answer.

## Decision

Merging happens only in `aggregateIngredients`, and only when the versioned files in `rules/v1/` agree on all of the following:

- the canonical ingredient identity, including an alias group when one exists
- the dimension and canonical unit
- the blocking qualifiers (fresh/dried, salted/unsalted, raw/cooked, whole/ground, bone-in/boneless)

Units stay as typed in the saved recipe note. Standardization happens only while building the shopping list. If a rule cannot prove a merge, the lines stay separate. The rule id (`v2.merge-alias`, `v2.merge-same-dimension`, or `v2.keep-separate`) is stored on the aggregated row.

Changing the meaning of a rule requires a new `version` in every rules file. The folder name stays `rules/v1/` until a breaking ruleset replaces it.

## Consequences

- The same two lines always produce the same shopping-list row offline.
- Alias coverage is small on purpose. Unlisted ingredients merge only when the normalized name, dimension, and unit already match.
- Volume and mass never convert into each other. A cup of flour and a gram of flour stay on separate rows.
- Eval gates require a 0% false-merge rate and at least 92% safe-merge recall, with at least 50 safe and 50 unsafe pairs.
