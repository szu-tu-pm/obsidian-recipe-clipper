# Recipe Manager & Shopping Lists

Desktop-only Obsidian plugin (`minAppVersion: 1.7.7`) for capturing recipes, storing them as structured Markdown, and generating shopping lists.

This repository is the implementation of the Recipe Project. Phase 1 starts with the plugin scaffold and settings; capture, storage, and UI land in later tasks.

## Requirements

- Node.js 20+
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

To load the plugin locally, copy or symlink this folder into `.obsidian/plugins/obsidian-recipe-clipper/` in a dedicated test vault (never a personal vault used for real recipes).

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
