import { Plugin } from "obsidian";
import { canvasImageProcessor } from "./domain/vault/canvasImageProcessor";
import {
	createObsidianFrontmatterCache,
	createObsidianVaultPort,
	obsidianYamlCodec,
} from "./domain/vault/obsidianVault";
import { AttachmentManager } from "./domain/vault/attachmentManager";
import { RecipeIndexer } from "./domain/vault/recipeIndexer";
import { RecipeRepository } from "./domain/vault/recipeRepository";
import type { FrontmatterCachePort, VaultPort } from "./domain/vault/vaultPort";
import {
	DEFAULT_SETTINGS,
	RecipeSettingTab,
	type RecipePluginSettings,
} from "./settings";
import { createObsidianPluginHost } from "./wrapper/createObsidianPluginHost";
import {
	PluginServiceAdapter,
	type RecipeWorkspace,
} from "./wrapper/PluginServiceAdapter";
import { RECIPE_VIEW_TYPE, RecipeItemView } from "./wrapper/RecipeItemView";

export default class RecipePlugin extends Plugin {
	settings: RecipePluginSettings = DEFAULT_SETTINGS;
	private adapter: PluginServiceAdapter | null = null;
	private indexer: RecipeIndexer | null = null;
	private repository: RecipeRepository | null = null;
	private attachments: AttachmentManager | null = null;
	private vaultPort: VaultPort | null = null;
	private frontmatterCache: FrontmatterCachePort | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.vaultPort = createObsidianVaultPort(this.app.vault);
		this.frontmatterCache = createObsidianFrontmatterCache(
			this.app.vault,
			this.app.metadataCache,
			this.settings.attachmentsFolder,
		);
		this.indexer = new RecipeIndexer(
			this.settings.recipesFolder,
			this.settings.attachmentsFolder,
		);
		this.repository = new RecipeRepository(
			this.vaultPort,
			obsidianYamlCodec,
			this.indexer,
			this.settings.recipesFolder,
		);
		this.attachments = new AttachmentManager(
			this.vaultPort,
			canvasImageProcessor,
			this.settings.attachmentsFolder,
		);

		this.adapter = new PluginServiceAdapter(
			createObsidianPluginHost(this),
			this.createWorkspace(),
		);

		this.registerView(
			RECIPE_VIEW_TYPE,
			(leaf) => new RecipeItemView(leaf, this.requireAdapter()),
		);

		this.addSettingTab(new RecipeSettingTab(this.app, this));

		this.addRibbonIcon("utensils-crossed", "Open Recipe Manager", () => {
			void this.activateView();
		});

		this.addCommand({
			id: "open-recipe-manager",
			name: "Open recipe manager",
			callback: () => {
				void this.activateView();
			},
		});

		this.app.workspace.onLayoutReady(() => {
			void this.initializeVault();
		});
		this.registerEvent(
			this.app.metadataCache.on("resolved", () => {
				this.requireAdapter().rebuildIndex();
			}),
		);
	}

	onunload(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(RECIPE_VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof RecipeItemView) {
				view.unmountReact();
			}
		}
		this.adapter?.dispose();
		this.adapter = null;
		this.indexer = null;
		this.repository = null;
		this.attachments = null;
		this.vaultPort = null;
		this.frontmatterCache = null;
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.applyFolderSettings();
		this.adapter?.notifySettingsChanged();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.applyFolderSettings();
		this.adapter?.notifySettingsChanged();
		this.adapter?.rebuildIndex();
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(RECIPE_VIEW_TYPE)[0];
		if (existing) {
			workspace.revealLeaf(existing);
			return;
		}

		const leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
		await leaf.setViewState({ type: RECIPE_VIEW_TYPE, active: true });
		workspace.revealLeaf(leaf);
	}

	private async initializeVault(): Promise<void> {
		if (!this.vaultPort) {
			return;
		}
		await this.vaultPort.mkdir(this.settings.recipesFolder);
		await this.vaultPort.mkdir(this.settings.shoppingListsFolder);
		await this.vaultPort.mkdir(this.settings.attachmentsFolder);
		this.requireAdapter().rebuildIndex();
	}

	private applyFolderSettings(): void {
		this.indexer?.configure(this.settings.recipesFolder, this.settings.attachmentsFolder);
		this.repository?.configure(this.settings.recipesFolder);
		this.attachments?.configure(this.settings.attachmentsFolder);
		if (this.vaultPort) {
			this.frontmatterCache = createObsidianFrontmatterCache(
				this.app.vault,
				this.app.metadataCache,
				this.settings.attachmentsFolder,
			);
		}
	}

	private createWorkspace(): RecipeWorkspace {
		return {
			listRecipes: () => this.indexer?.list() ?? [],
			loadRecipe: (id) => {
				if (!this.repository) {
					return Promise.resolve({
						ok: false,
						path: "",
						message: "Recipe repository is unavailable.",
						raw: null,
					});
				}
				return this.repository.loadById(id);
			},
			saveRecipe: (recipe) => {
				if (!this.repository) {
					return Promise.reject(new Error("Recipe repository is unavailable."));
				}
				return this.repository.save(recipe);
			},
			deleteRecipe: (id) => this.repository?.remove(id) ?? Promise.resolve(),
			rebuildIndex: () => {
				if (this.indexer && this.frontmatterCache) {
					this.indexer.rebuildFromCache(this.frontmatterCache);
				}
			},
			applyVaultEvent: (event) => {
				if (this.indexer && this.frontmatterCache) {
					this.indexer.applyVaultEvent(event, this.frontmatterCache);
				}
			},
		};
	}

	private requireAdapter(): PluginServiceAdapter {
		if (!this.adapter) {
			throw new Error("PluginServiceAdapter is not initialized.");
		}
		return this.adapter;
	}
}
