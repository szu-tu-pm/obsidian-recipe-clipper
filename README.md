# Recipe Manager & Shopping Lists

Desktop-only Obsidian plugin (`minAppVersion: 1.7.7`) for capturing recipes, storing them as structured Markdown, and generating shopping lists.

Capabilities include:
- **3-Tier Local URL Extraction**: Extracts recipes from JSON-LD (`@graph`), Microdata, RDFa, and common DOM recipe cards (WPRM, Tasty, Mediavine, heading+list), with a local loopback Ollama fallback whose output is strictly grounded in the webpage text.
- **Structured vs. Visible Disagreement Review**: Flags ingredients where a webpage's structured data and visible recipe card disagree, letting you choose per line before saving.
- **Obsidian Web Clipper (Chrome) Intake**: Imports recipes clipped with `clipper/recipe.web-clipper.json` (`type: recipe-clip`) through the same human-in-the-loop review flow, with optimistic concurrency and read-back verification.
- **Rule-Based Shopping List Aggregation**: Preserves units as typed in saved recipe notes and standardizes/merges ingredients only during shopping-list generation when local rules (`rules/v1/`) prove identity, dimensional compatibility, and matching blocking qualifiers.
- **Local Ollama Recipe Translation**: Translates recipes into 13 languages while enforcing amount, unit, and amount-unit pair invariants and preserving the untranslated original for revert and shopping-list aggregation.

## Requirements

- Node.js 20.19+
- Obsidian 1.7.7 or newer on Windows or macOS desktop

## Build

```bash
npm install
npm run build
```

`npm run build` typechecks, bundles `main.js` with esbuild, copies `styles.css`, and fails if the uncompressed bundle is 500 KB or larger.

Development watch mode:

```bash
npm run dev
```

`main.js` is a generated artifact and is gitignored. Run `npm run build` (or `npm run dev`) before loading the plugin in Obsidian. Do not commit `main.js`; keep TypeScript as the source of truth.

To load the plugin locally, copy or symlink this folder into `.obsidian/plugins/obsidian-recipe-clipper/` in a dedicated test vault (never a personal vault used for real recipes). After enabling the plugin, use the ribbon icon or the **Open recipe manager** command. React UI mounts through `RecipeItemView` and talks to Obsidian only via `PluginServiceAdapter`. Recipes are stored as `schemaVersion: 2` Markdown with stable `rec_*` IDs, indexed from Obsidian `metadataCache`, and images go under `Recipes/_attachments/<recipe-id>/`. v1 files are migrated on read (`parseConfidence` 0–1 scores become `null`).

## Settings

| Setting | Default |
| --- | --- |
| Recipes folder | `Recipes/` |
| Shopping lists folder | `Shopping Lists/` |
| Attachments folder | `Recipes/_attachments/` |
| Ollama endpoint | `http://127.0.0.1:11434` |
| Default model | `qwen2.5:7b-instruct` |
| Lightweight model | `llama3.2:3b-instruct` |

## Work split

- **Greg Szu-Tu**: plugin scaffold, React-to-Obsidian wrapper, vault storage, URL extraction, ratings/images, PR merge sign-off.
- **Lin**: test harness (Vitest, Playwright, isolated temp vault, GitHub Actions), ingredient rules engine, shopping lists, evaluations, Antigravity CLI audits.

## Architecture notes

- [ADR-001](docs/adr/001-react-obsidian-wrapper.md) — React UI talks to Obsidian only through an adapter.
- [ADR-002](docs/adr/002-local-ingredient-rules-engine.md) — shopping lists merge with versioned local rules, not a model.
- [ADR-003](docs/adr/003-three-tier-url-extraction.md) — structured data, then DOM cards, then grounded loopback Ollama.
- [ADR-004](docs/adr/004-markdown-schema-v1.md) — versioned Markdown notes; the plugin writes schema v2.

Agent constraints for this repo live in `AGENTS.md` and `.cursorrules`.

## Evaluation

`npm run eval` scores the tuning corpus and writes `docs/eval-reports/phase2-baseline-report.md`. `npm run eval:held-out` scores a separate corpus under `tests/evals/held-out/` and writes `docs/eval-reports/held-out-v1-report.md`. Neither command uses the network. `npm run test:coverage` enforces 80% coverage overall and 90% for aggregation and extraction.

The held-out pages use the host `public.example` and the byline Public Domain Test Kitchen. They are not copies of anyone's published recipes.

## Demo script

Record this against a vault that contains only the public fixtures in `tests/evals/held-out/`. Do not open a personal vault, and do not paste a private note, a home-directory path, or a photo you do not have rights to.

1. Build with `npm run build` and load the plugin from a dedicated test vault.
2. Open **Open recipe manager**. The recipe list should be empty until you import one of the held-out pages.
3. Import `https://public.example/held-out/barley-tahini` only if that host is served by your own fixture. Otherwise use **New recipe** and type the barley bowl from `tests/evals/held-out/manifest.json`.
4. Save the note and show the frontmatter: `schemaVersion: 2`, units as typed, and a `rec_` id.
5. Add a second recipe that shares an ingredient in a compatible unit, then open the shopping list and show one merged row. Add a fresh-versus-dried pair and show that those rows stay separate.
6. Translate one saved recipe, then show that the shopping list still aggregates the original amounts.

Screenshots and the Loom walkthrough are recorded by a person from this script. They are not checked in until that recording exists, so the repo does not ship images from a private vault.

## License

MIT
