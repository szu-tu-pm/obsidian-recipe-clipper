import { Plugin } from "obsidian";
import {
	DEFAULT_SETTINGS,
	RecipeSettingTab,
	type RecipePluginSettings,
} from "./settings";
import { createObsidianPluginHost } from "./wrapper/createObsidianPluginHost";
import { PluginServiceAdapter } from "./wrapper/PluginServiceAdapter";
import { RECIPE_VIEW_TYPE, RecipeItemView } from "./wrapper/RecipeItemView";

export default class RecipePlugin extends Plugin {
	settings: RecipePluginSettings = DEFAULT_SETTINGS;
	private adapter: PluginServiceAdapter | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.adapter = new PluginServiceAdapter(createObsidianPluginHost(this));

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
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.adapter?.notifySettingsChanged();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.adapter?.notifySettingsChanged();
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

	private requireAdapter(): PluginServiceAdapter {
		if (!this.adapter) {
			throw new Error("PluginServiceAdapter is not initialized.");
		}
		return this.adapter;
	}
}
