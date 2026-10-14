import type { EventRef } from "obsidian";
import type RecipePlugin from "../main";
import type { PluginServiceHost, VaultChangeEvent } from "./PluginServiceAdapter";

interface SettingManager {
	open(): void;
	openTabById(id: string): void;
}

function getSettingManager(plugin: RecipePlugin): SettingManager | null {
	const setting = (plugin.app as unknown as { setting?: SettingManager }).setting;
	return setting ?? null;
}

export function createObsidianPluginHost(plugin: RecipePlugin): PluginServiceHost {
	return {
		getSettings: () => plugin.settings,
		openSettings: () => {
			const setting = getSettingManager(plugin);
			if (!setting) {
				throw new Error("Obsidian settings UI is unavailable.");
			}
			setting.open();
			setting.openTabById(plugin.manifest.id);
		},
		registerVaultListener: (listener) => {
			const { vault, metadataCache } = plugin.app;
			const vaultRefs: EventRef[] = [];
			const cacheRefs: EventRef[] = [];

			const emit = (event: VaultChangeEvent): void => {
				listener(event);
			};

			vaultRefs.push(vault.on("create", (file) => emit({ kind: "create", path: file.path })));
			vaultRefs.push(vault.on("modify", (file) => emit({ kind: "modify", path: file.path })));
			vaultRefs.push(vault.on("delete", (file) => emit({ kind: "delete", path: file.path })));
			vaultRefs.push(
				vault.on("rename", (file, oldPath) =>
					emit({ kind: "rename", path: file.path, previousPath: oldPath }),
				),
			);
			cacheRefs.push(
				metadataCache.on("changed", (file) => emit({ kind: "metadata", path: file.path })),
			);
			cacheRefs.push(
				metadataCache.on("deleted", (file) => emit({ kind: "metadata", path: file.path })),
			);

			return () => {
				for (const ref of vaultRefs) {
					vault.offref(ref);
				}
				for (const ref of cacheRefs) {
					metadataCache.offref(ref);
				}
			};
		},
		logError: (message, error) => {
			console.error(`[obsidian-recipe-clipper] ${message}`, error);
		},
	};
}
