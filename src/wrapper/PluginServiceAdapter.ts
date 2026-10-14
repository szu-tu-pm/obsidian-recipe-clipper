import type { RecipeDocument } from "../domain/schema/recipeSchema";
import type { RecipeIndexEntry } from "../domain/vault/recipeIndexer";
import type { RecipeLoadResult } from "../domain/vault/recipeRepository";
import { DEFAULT_SETTINGS, type RecipePluginSettings } from "../settings";

export type VaultChangeKind = "create" | "modify" | "delete" | "rename" | "metadata";

export interface VaultChangeEvent {
	kind: VaultChangeKind;
	path: string;
	previousPath?: string;
}

export type VaultChangeListener = (event: VaultChangeEvent) => void;

export interface RecipeWorkspace {
	listRecipes(): RecipeIndexEntry[];
	loadRecipe(id: string): Promise<RecipeLoadResult>;
	saveRecipe(recipe: RecipeDocument): Promise<RecipeDocument>;
	deleteRecipe(id: string): Promise<void>;
	rebuildIndex(): void;
	applyVaultEvent(event: VaultChangeEvent): void;
}

export interface PluginServices {
	getSettings(): RecipePluginSettings;
	subscribeSettings(listener: () => void): () => void;
	subscribeVaultChanges(listener: VaultChangeListener): () => void;
	subscribeRecipes(listener: () => void): () => void;
	listRecipes(): RecipeIndexEntry[];
	loadRecipe(id: string): Promise<RecipeLoadResult>;
	saveRecipe(recipe: RecipeDocument): Promise<RecipeDocument | null>;
	deleteRecipe(id: string): Promise<void>;
	openSettings(): void;
}

export interface PluginServiceHost {
	getSettings(): RecipePluginSettings;
	openSettings(): void;
	registerVaultListener(listener: VaultChangeListener): () => void;
	logError(message: string, error?: unknown): void;
}

function copySettings(settings: RecipePluginSettings): RecipePluginSettings {
	return { ...settings };
}

export class PluginServiceAdapter implements PluginServices {
	private readonly vaultListeners = new Set<VaultChangeListener>();
	private readonly settingsListeners = new Set<() => void>();
	private readonly recipeListeners = new Set<() => void>();
	private settingsSnapshot: RecipePluginSettings;
	private recipeSnapshot: RecipeIndexEntry[] = [];
	private unsubscribeHost: (() => void) | null = null;
	private disposed = false;

	constructor(
		private readonly host: PluginServiceHost,
		private readonly workspace?: RecipeWorkspace,
	) {
		this.settingsSnapshot = this.readSettingsFromHost();
		this.refreshRecipeSnapshot();
		this.unsubscribeHost = host.registerVaultListener((event) => {
			this.handleVaultEvent(event);
		});
	}

	getSettings(): RecipePluginSettings {
		return this.settingsSnapshot;
	}

	subscribeSettings(listener: () => void): () => void {
		return this.addListener(this.settingsListeners, listener);
	}

	subscribeVaultChanges(listener: VaultChangeListener): () => void {
		return this.addListener(this.vaultListeners, listener);
	}

	subscribeRecipes(listener: () => void): () => void {
		return this.addListener(this.recipeListeners, listener);
	}

	listRecipes(): RecipeIndexEntry[] {
		return this.recipeSnapshot;
	}

	async loadRecipe(id: string): Promise<RecipeLoadResult> {
		if (this.disposed || !this.workspace) {
			return { ok: false, path: "", message: "Recipe workspace is unavailable.", raw: null };
		}
		try {
			return await this.workspace.loadRecipe(id);
		} catch (error) {
			this.host.logError("Failed to load recipe", error);
			return {
				ok: false,
				path: "",
				message: error instanceof Error ? error.message : "Failed to load recipe.",
				raw: null,
			};
		}
	}

	async saveRecipe(recipe: RecipeDocument): Promise<RecipeDocument | null> {
		if (this.disposed || !this.workspace) {
			return null;
		}
		try {
			const saved = await this.workspace.saveRecipe(recipe);
			this.workspace.rebuildIndex();
			this.refreshRecipeSnapshot();
			this.emitRecipeListeners();
			return saved;
		} catch (error) {
			this.host.logError("Failed to save recipe", error);
			return null;
		}
	}

	async deleteRecipe(id: string): Promise<void> {
		if (this.disposed || !this.workspace) {
			return;
		}
		try {
			await this.workspace.deleteRecipe(id);
			this.workspace.rebuildIndex();
			this.refreshRecipeSnapshot();
			this.emitRecipeListeners();
		} catch (error) {
			this.host.logError("Failed to delete recipe", error);
		}
	}

	openSettings(): void {
		if (this.disposed) {
			return;
		}
		try {
			this.host.openSettings();
		} catch (error) {
			this.host.logError("Failed to open plugin settings", error);
		}
	}

	notifySettingsChanged(): void {
		if (this.disposed) {
			return;
		}
		this.settingsSnapshot = this.readSettingsFromHost();
		this.emitListeners(this.settingsListeners, "Settings listener failed");
	}

	rebuildIndex(): void {
		if (this.disposed) {
			return;
		}
		try {
			this.workspace?.rebuildIndex();
			this.refreshRecipeSnapshot();
			this.emitRecipeListeners();
		} catch (error) {
			this.host.logError("Failed to rebuild recipe index", error);
		}
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.vaultListeners.clear();
		this.settingsListeners.clear();
		this.recipeListeners.clear();
		this.unsubscribeHost?.();
		this.unsubscribeHost = null;
		this.settingsSnapshot = copySettings(DEFAULT_SETTINGS);
		this.recipeSnapshot = [];
	}

	private handleVaultEvent(event: VaultChangeEvent): void {
		if (this.disposed) {
			return;
		}
		try {
			this.workspace?.applyVaultEvent(event);
			this.refreshRecipeSnapshot();
			this.emitRecipeListeners();
		} catch (error) {
			this.host.logError("Failed to update recipe index", error);
		}
		for (const listener of [...this.vaultListeners]) {
			try {
				listener(event);
			} catch (error) {
				this.host.logError("Vault change listener failed", error);
			}
		}
	}

	private refreshRecipeSnapshot(): void {
		this.recipeSnapshot = this.workspace?.listRecipes() ?? [];
	}

	private emitRecipeListeners(): void {
		this.emitListeners(this.recipeListeners, "Recipe listener failed");
	}

	private addListener<T>(set: Set<T>, listener: T): () => void {
		if (this.disposed) {
			return () => {};
		}
		set.add(listener);
		return () => {
			set.delete(listener);
		};
	}

	private emitListeners(listeners: Set<() => void>, errorMessage: string): void {
		for (const listener of [...listeners]) {
			try {
				listener();
			} catch (error) {
				this.host.logError(errorMessage, error);
			}
		}
	}

	private readSettingsFromHost(): RecipePluginSettings {
		try {
			return copySettings(this.host.getSettings());
		} catch (error) {
			this.host.logError("Failed to read plugin settings", error);
			return copySettings(DEFAULT_SETTINGS);
		}
	}
}
