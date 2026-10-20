# ADR-001: React UI behind an Obsidian adapter

- Status: accepted
- Date: 2026-10-20

## Context

The recipe manager is an Obsidian desktop plugin, and Obsidian's plugin API is the only way to read the vault, write notes, and mount a view. The screens themselves are easier to build and test as React components. Importing `obsidian` from those components would make every UI test depend on the desktop app.

## Decision

React components in `src/ui` receive a `PluginServiceAdapter`. That adapter is the only object that calls Obsidian. `src/ui` and `src/domain` do not import `obsidian`. Tests use `MockPluginServices` and an in-memory vault. The production host (`createObsidianPluginHost`) implements the same adapter against `Vault`, `metadataCache`, and `ItemView`.

The view mounts React from `RecipeItemView`. Closing the view unmounts the tree and drops vault listeners.

## Consequences

- UI tests run in Vitest with jsdom. They do not launch Obsidian.
- A behavior that needs a new Obsidian API is added to the adapter first, then used by React.
- Obsidian-only modules (`main.ts`, `settings.ts`, `RecipeItemView.ts`, `RecipeViewRoot.tsx`) stay outside the coverage thresholds because they cannot run without the desktop runtime.
- The bundle still has to stay under 500 KB, because the adapter does not remove React from the plugin.
