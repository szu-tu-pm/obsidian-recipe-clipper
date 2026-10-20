# ADR-004: Versioned Markdown recipe schema

- Status: accepted
- Date: 2026-10-20

## Context

Recipes have to live as normal vault notes so they can be edited, synced, and read without this plugin. They also have to be strict enough to aggregate, translate, and reopen without losing ingredient identity. A free-form note cannot promise stable ids, units, or a translation that still shops from the original amounts.

The first schema stored a `parseConfidence` score between 0 and 1. Later work needed typed units preserved exactly, a place for the untranslated original, and a confidence value the parser could leave unknown.

## Decision

Each recipe is a Markdown file with YAML frontmatter checked by `recipeFrontmatterSchema`. The current document version is `schemaVersion: 2`.

- Ids are Crockford base32 (`rec_` for recipes, `ing_` for ingredients) and stay put when a line is edited but not replaced.
- Ingredient `unit` is the unit as typed. Shopping-list code canonicalizes a copy; it does not rewrite the note.
- `translation.original` keeps the pre-translation ingredients and steps. Aggregation reads those original lines, so a translation cannot change what merges.
- v1 notes are migrated on read. Their old `parseConfidence` scores become `null` rather than a guessed probability.

A note whose frontmatter fails the schema is left byte-for-byte unchanged. Shopping lists are separate files and are not rewritten when a recipe is edited or deleted.

Web Clipper intake uses `type: recipe-clip` until review promotes the note to `type: recipe`.

## Consequences

- Adding a frontmatter key changes `bodyHash`, because the hash follows JSON key order. New keys are appended after the existing ones.
- Translation review can revert to `translation.original`, and it asks before replacing a translation the person has edited.
- Eval reports require 100% Zod validity on extracted drafts before they count as a pass.
- The filename of this ADR says v1 because that was the first versioned contract. The body describes v2, which is the schema the plugin writes.
