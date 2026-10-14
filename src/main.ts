import { Plugin } from "obsidian";
import {
	DEFAULT_SETTINGS,
	RecipeSettingTab,
	type RecipePluginSettings,
} from "./settings";

export default class RecipePlugin extends Plugin {
	settings: RecipePluginSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new RecipeSettingTab(this.app, this));
	}

	onunload(): void {}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
