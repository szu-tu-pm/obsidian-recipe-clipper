# ADR-001: React UI behind an Obsidian adapter

- Status: accepted
- Date: 2026-10-20 (amended 2026-10-20 to clarify the vault adapter boundary)

## Context

The recipe manager is an Obsidian desktop plugin, and Obsidian's plugin API is the only way to read the vault, write notes, and mount a view. The screens themselves are easier to build and test as React components. Importing `obsidian` from those components would make every UI test depend on the desktop app.

## Decision

React components in `src/ui` receive a `PluginServiceAdapter`. That adapter decouples the UI layer from Obsidian's host APIs.

- `src/ui` never imports `obsidian`.
- Core domain logic (`src/domain/aggregation`, `src/domain/extraction`, `src/domain/schema`, `src/domain/translation`) never imports `obsidian`.
- The vault boundary (`src/domain/vault/vaultPort.ts`) defines an agnostic interface (`VaultPort`). Tests use `MockPluginServices` and `InMemoryVault`. The production runtime uses `ObsidianVaultAdapter` (`src/domain/vault/obsidianVault.ts`), which is the sole domain adapter with direct bindings to Obsidian's `Vault` and `MetadataCache`.
- The production host (`createObsidianPluginHost` in `src/wrapper/obsidianPluginHost.ts`) implements `PluginServiceAdapter` using the Obsidian runtime and provides it to the React tree.

The view mounts React from `RecipeItemView`. Closing the view unmounts the tree and drops vault listeners.

## Consequences

- UI tests run in Vitest with jsdom. They do not launch Obsidian.
- A behavior that needs a new Obsidian API is added to the adapter first, then used by React.
- Obsidian-only modules (`main.ts`, `settings.ts`, `RecipeItemView.ts`, `RecipeViewRoot.tsx`) stay outside the coverage thresholds because they cannot run without the desktop runtime.
- The bundle still has to stay under 500 KB, because the adapter does not remove React from the plugin.
