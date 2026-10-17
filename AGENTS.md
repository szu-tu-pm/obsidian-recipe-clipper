# Agent guide

Shared instructions for every coding agent in this repo (Codex reads this file directly; Claude reads it through CLAUDE.md).

## Project

Obsidian plugin (TypeScript, React 18, Zod, Vitest) that clips recipes into the vault and builds shopping lists. Tasks come from the Notion database "Recipe Project — Implementation Tasks"; each task page lists Deliverables and Acceptance Criteria & Test Gates, which are the spec.

## Commands

- `npm run build` — typecheck, production bundle, bundle-size check. Must pass.
- `npm test` — Vitest. Must pass.
- `npm run test:coverage` — use when a task's gates name coverage thresholds.

## Rules

- Build only what the task's Deliverables and Acceptance Criteria ask for. Do not refactor unrelated code.
- Put files at the paths the Deliverables name.
- Every acceptance criterion that code can satisfy needs a test that would fail without the change.
- Tests are deterministic and offline. Anything that needs the network or a live Ollama goes in a separate script that PR CI does not run.
- Units stay as typed in saved recipe files; standardize units only during shopping-list aggregation.
- Ingredient-matching rules live as data in `rules/v1/`; bump `rulesVersion` when you change their meaning.
- Leave gates that need a person (Greg Szu-Tu's merge sign-off, testing inside the Obsidian desktop app, OS compatibility runs) unchecked, and say so. Lin's audit is the Claude/Codex cross-review; the orchestrator ticks it, never the implementer.

## Git and PR conventions

- Branch: `<agent>/<task-id>-<slug>`, for example `codex/p2-5-eval-harness` or `claude/p2-7-web-clipper`.
- Commit subject: one plain sentence ending in a period that says what changed for the user, e.g. "Merge ingredients only when the local rules can prove they match."
- PR body sections: Intent, Problem, Acceptance criteria (checkboxes copied from the task), Test plan (commands run and their result; say what was not run).
