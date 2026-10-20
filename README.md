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

## License

MIT
