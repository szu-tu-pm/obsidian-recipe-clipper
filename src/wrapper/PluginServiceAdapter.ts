import type {
	LoadedWebClip,
	PendingWebClip,
	WebClipSaveOutcome,
} from "../domain/extraction/webClipperIntake";
import type { ExistingSourceRecipe } from "../domain/extraction/types";
import type { RecipeDocument, RecipeImage } from "../domain/schema/recipeSchema";
import type { ShoppingListDocument } from "../domain/schema/shoppingListSchema";
import type { RecipeIndexEntry } from "../domain/vault/recipeIndexer";
import type { RecipeFileDiagnostic, RecipeLoadResult } from "../domain/vault/recipeRepository";
import { VaultFilePreservedError } from "../domain/vault/safeWrite";
import type { ShoppingListLoadResult } from "../domain/vault/shoppingListRepository";
import { DEFAULT_SETTINGS, type RecipePluginSettings } from "../pluginSettings";

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
	listRecipeDiagnostics(): Promise<RecipeFileDiagnostic[]>;
	saveRecipe(recipe: RecipeDocument): Promise<RecipeDocument>;
	deleteRecipe(id: string): Promise<void>;
	saveShoppingList(list: ShoppingListDocument): Promise<ShoppingListDocument>;
	loadShoppingList(id: string): Promise<ShoppingListLoadResult>;
	listShoppingLists(): Promise<ShoppingListDocument[]>;
	addImage(
		recipeId: string,
		filename: string,
		data: ArrayBuffer,
		existing: RecipeImage[],
	): Promise<RecipeImage>;
	removeImage(image: RecipeImage): Promise<void>;
	rebuildIndex(): void;
	applyVaultEvent(event: VaultChangeEvent): void;
	listPendingClips(): PendingWebClip[];
	loadClipReview(
		path: string,
		existing: ExistingSourceRecipe[],
	): Promise<LoadedWebClip | null>;
	saveClipReview(path: string, revision: string, recipe: RecipeDocument): Promise<WebClipSaveOutcome>;
}

export interface PluginServices {
	getSettings(): RecipePluginSettings;
	subscribeSettings(listener: () => void): () => void;
	subscribeVaultChanges(listener: VaultChangeListener): () => void;
	subscribeRecipes(listener: () => void): () => void;
	listRecipes(): RecipeIndexEntry[];
	/** Web clips in the recipes folder that still need review. Changes notify `subscribeRecipes`. */
	listPendingClips(): PendingWebClip[];
	loadClipReview(path: string): Promise<LoadedWebClip | null>;
	/** Save a reviewed clip only over the revision that was reviewed. */
	saveClipReview(path: string, revision: string, recipe: RecipeDocument): Promise<WebClipSaveOutcome>;
	loadRecipe(id: string): Promise<RecipeLoadResult>;
	listRecipeDiagnostics(): Promise<RecipeFileDiagnostic[]>;
	saveRecipe(recipe: RecipeDocument): Promise<RecipeDocument | null>;
	deleteRecipe(id: string): Promise<void>;
	saveShoppingList(list: ShoppingListDocument): Promise<ShoppingListDocument | null>;
	loadShoppingList(id: string): Promise<ShoppingListLoadResult>;
	listShoppingLists(): Promise<ShoppingListDocument[]>;
	addRecipeImage(
		recipeId: string,
		filename: string,
		data: ArrayBuffer,
		existing: RecipeImage[],
	): Promise<RecipeImage | null>;
	removeRecipeImage(image: RecipeImage): Promise<void>;
	getImageUrl(path: string): string | null;
	openSettings(): void;
}

export interface PluginServiceHost {
	getSettings(): RecipePluginSettings;
	openSettings(): void;
	registerVaultListener(listener: VaultChangeListener): () => void;
	getResourcePath(path: string): string | null;
	logError(message: string, error?: unknown): void;
}

function samePendingClips(a: PendingWebClip[], b: PendingWebClip[]): boolean {
	return (
		a.length === b.length &&
		a.every((clip, index) => clip.path === b[index]?.path && clip.title === b[index]?.title)
	);
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
	private clipSnapshot: PendingWebClip[] = [];
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

	listPendingClips(): PendingWebClip[] {
		return this.clipSnapshot;
	}

	async loadClipReview(path: string): Promise<LoadedWebClip | null> {
		if (this.disposed || !this.workspace) {
			return null;
		}
		try {
			return await this.workspace.loadClipReview(
				path,
				this.recipeSnapshot.map((recipe) => ({
					id: recipe.id,
					sourceUrl: recipe.sourceUrl,
					path: recipe.path,
				})),
			);
		} catch (error) {
			this.host.logError("Failed to read web clip", error);
			return null;
		}
	}

	async saveClipReview(
		path: string,
		revision: string,
		recipe: RecipeDocument,
	): Promise<WebClipSaveOutcome> {
		if (this.disposed || !this.workspace) {
			return { status: "failed", message: "Recipe workspace is unavailable." };
		}
		try {
			const outcome = await this.workspace.saveClipReview(path, revision, recipe);
			if (outcome.status === "saved") {
				this.workspace.rebuildIndex();
				this.refreshRecipeSnapshot();
				this.emitRecipeListeners();
			}
			return outcome;
		} catch (error) {
			this.host.logError("Failed to save web clip review", error);
			return {
				status: "failed",
				message: error instanceof Error ? error.message : "Failed to save the web clip review.",
			};
		}
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

	async listRecipeDiagnostics(): Promise<RecipeFileDiagnostic[]> {
		if (this.disposed || !this.workspace) {
			return [];
		}
		try {
			return await this.workspace.listRecipeDiagnostics();
		} catch (error) {
			this.host.logError("Failed to read recipe diagnostics", error);
			return [];
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
			if (error instanceof VaultFilePreservedError) {
				throw error;
			}
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

	async saveShoppingList(list: ShoppingListDocument): Promise<ShoppingListDocument | null> {
		if (this.disposed || !this.workspace) {
			return null;
		}
		try {
			return await this.workspace.saveShoppingList(list);
		} catch (error) {
			this.host.logError("Failed to save shopping list", error);
			if (error instanceof VaultFilePreservedError) {
				throw error;
			}
			return null;
		}
	}

	async listShoppingLists(): Promise<ShoppingListDocument[]> {
		if (this.disposed || !this.workspace) {
			return [];
		}
		try {
			return await this.workspace.listShoppingLists();
		} catch (error) {
			this.host.logError("Failed to list shopping lists", error);
			return [];
		}
	}

	async loadShoppingList(id: string): Promise<ShoppingListLoadResult> {
		if (this.disposed || !this.workspace) {
			return { ok: false, path: "", message: "Recipe workspace is unavailable.", raw: null };
		}
		try {
			return await this.workspace.loadShoppingList(id);
		} catch (error) {
			this.host.logError("Failed to load shopping list", error);
			return {
				ok: false,
				path: "",
				message: error instanceof Error ? error.message : "Failed to load shopping list.",
				raw: null,
			};
		}
	}

	async addRecipeImage(
		recipeId: string,
		filename: string,
		data: ArrayBuffer,
		existing: RecipeImage[],
	): Promise<RecipeImage | null> {
		if (this.disposed || !this.workspace) {
			return null;
		}
		try {
			return await this.workspace.addImage(recipeId, filename, data, existing);
		} catch (error) {
			this.host.logError("Failed to attach recipe image", error);
			return null;
		}
	}

	async removeRecipeImage(image: RecipeImage): Promise<void> {
		if (this.disposed || !this.workspace) {
			return;
		}
		try {
			await this.workspace.removeImage(image);
		} catch (error) {
			this.host.logError("Failed to remove recipe image", error);
		}
	}

	getImageUrl(path: string): string | null {
		if (this.disposed) {
			return null;
		}
		try {
			return this.host.getResourcePath(path);
		} catch (error) {
			this.host.logError("Failed to resolve image URL", error);
			return null;
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
		this.clipSnapshot = [];
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
		const clips = this.workspace?.listPendingClips() ?? [];
		// Keep the same array while nothing changed so React's external store stays stable.
		if (!samePendingClips(this.clipSnapshot, clips)) {
			this.clipSnapshot = clips;
		}
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
