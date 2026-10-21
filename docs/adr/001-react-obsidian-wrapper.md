# ADR-001: React UI behind an Obsidian adapter

- Status: accepted
- Date: 2026-10-20 (amended 2026-10-20 to clarify the vault adapter boundary)

## Context

The recipe manager is an Obsidian desktop plugin, and Obsidian's plugin API is the only way to read the vault, write notes, and mount a view. The screens themselves are easier to build and test as React components. Importing `obsidian` from those components would make every UI test depend on the desktop app.

## Decision

React components in `src/ui` receive a `PluginServiceAdapter`. That adapter decouples the UI layer from Obsidian's host APIs.

- `src/ui` never imports `obsidian`.
- Core domain logic (`src/domain/aggregation`, `src/domain/extraction`, `src/domain/schema`, `src/domain/translation`) never imports `obsidian`.
- The vault boundary (`src/domain/vault/vaultPort.ts`) defines an agnostic interface (`VaultPort`). Tests use `MockPluginServices` and `InMemoryVault`.
- Exactly six modules import `obsidian`. Nothing else under `src` does, including `PluginServiceAdapter`, which reaches Obsidian only through the host object it is given:
  - `src/domain/vault/obsidianVault.ts` is the concrete `VaultPort` and frontmatter-cache adapter over Obsidian's `Vault` and `MetadataCache`. It is the one Obsidian-bound file inside `src/domain`; the rest of `src/domain/vault` does not import `obsidian`.
  - `src/wrapper/createObsidianPluginHost.ts` builds the production host that `PluginServiceAdapter` uses, and wires vault events.
  - `src/wrapper/RecipeItemView.ts` is the `ItemView` that mounts React.
  - `src/wrapper/RecipeViewRoot.tsx` shows `Notice` messages for the React root.
  - `src/main.ts` is the `Plugin` lifecycle entry point and constructs the vault adapter.
  - `src/settings.ts` is the settings tab.
- `tests/unit/importBoundaries.test.ts` holds this list and fails if any other file under `src` imports `obsidian`, or if a listed file stops doing so. Changing the list means changing this ADR.

The view mounts React from `RecipeItemView`. Closing the view unmounts the tree and drops vault listeners.

## Consequences

- UI tests run in Vitest with jsdom. They do not launch Obsidian.
- A behavior that needs a new Obsidian API is added to the adapter first, then used by React.
- Obsidian-only modules (`main.ts`, `settings.ts`, `RecipeItemView.ts`, `RecipeViewRoot.tsx`) stay outside the coverage thresholds because they cannot run without the desktop runtime.
- The bundle still has to stay under 500 KB, because the adapter does not remove React from the plugin.
