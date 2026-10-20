# ADR-003: Three-tier URL extraction with a grounded local model

- Status: accepted
- Date: 2026-10-20

## Context

Recipe pages publish structured data (JSON-LD, Microdata, RDFa), visible recipe cards (WPRM, Tasty, Mediavine, or a heading plus lists), or unstructured prose. Structured data is often incomplete or different from the visible card. A model can read the prose, and it can also invent a quantity, a step, or a title that was not on the page.

Some sites block a headless fetch. The Obsidian Web Clipper can save the page the person already opened.

## Decision

`extractRecipeFromPage` tries sources in this order:

1. JSON-LD, then Microdata, then RDFa.
2. DOM card heuristics when structured data is missing.
3. A local Ollama model, and only when the endpoint is a loopback address. The prompt is versioned in `docs/prompts/ollama-recipe-extraction.md`. `groundOllamaExtraction` drops any field the model returns that is not present in the page text.

When structured ingredients and the visible list disagree, the import review asks the person to pick per line before anything is saved. Web Clipper notes use `type: recipe-clip` so an unreviewed clip is not treated as a finished recipe. Saving a reviewed clip checks the note revision and restores the original bytes if the write cannot be read back.

HTML is capped and stripped of scripts, iframes, and inline event handlers before parsing.

## Consequences

- Tier 1 and tier 2 fixtures run with no network. The held-out corpus does not call Ollama at all.
- A model cannot add an ingredient, step, or title that the page did not contain. The eval gate for invented fields is 0%.
- The person still has to resolve disagreements. The extractor does not silently prefer one list.
- Sites that block server-side fetch are handled by the Web Clipper path, not by a credentialed scraper.
