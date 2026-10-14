import { App, PluginSettingTab, Setting } from "obsidian";
import type RecipePlugin from "./main";

export interface RecipePluginSettings {
	recipesFolder: string;
	shoppingListsFolder: string;
	attachmentsFolder: string;
	ollamaEndpoint: string;
	ollamaModel: string;
	ollamaLightweightModel: string;
	ollamaTimeoutMs: number;
	ollamaHealthCheckMs: number;
}

export const DEFAULT_SETTINGS: RecipePluginSettings = {
	recipesFolder: "Recipes",
	shoppingListsFolder: "Shopping Lists",
	attachmentsFolder: "Recipes/_attachments",
	ollamaEndpoint: "http://127.0.0.1:11434",
	ollamaModel: "qwen2.5:7b-instruct",
	ollamaLightweightModel: "llama3.2:3b-instruct",
	ollamaTimeoutMs: 25_000,
	ollamaHealthCheckMs: 1_500,
};

function normalizeFolder(value: string, fallback: string): string {
	const trimmed = value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
	return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeEndpoint(value: string): string {
	return value.trim().replace(/\/+$/g, "") || DEFAULT_SETTINGS.ollamaEndpoint;
}

function parsePositiveInt(value: string, fallback: number): number {
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export class RecipeSettingTab extends PluginSettingTab {
	plugin: RecipePlugin;

	constructor(app: App, plugin: RecipePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Recipe Manager & Shopping Lists" });

		containerEl.createEl("h3", { text: "Vault folders" });

		new Setting(containerEl)
			.setName("Recipes folder")
			.setDesc("Markdown recipes are stored here (schemaVersion 1).")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.recipesFolder)
					.setValue(this.plugin.settings.recipesFolder)
					.onChange(async (value) => {
						this.plugin.settings.recipesFolder = normalizeFolder(
							value,
							DEFAULT_SETTINGS.recipesFolder,
						);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Shopping lists folder")
			.setDesc("Generated shopping lists are stored independently from recipes.")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.shoppingListsFolder)
					.setValue(this.plugin.settings.shoppingListsFolder)
					.onChange(async (value) => {
						this.plugin.settings.shoppingListsFolder = normalizeFolder(
							value,
							DEFAULT_SETTINGS.shoppingListsFolder,
						);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Recipe attachments folder")
			.setDesc("Recipe images are stored under this folder, grouped by recipe id.")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.attachmentsFolder)
					.setValue(this.plugin.settings.attachmentsFolder)
					.onChange(async (value) => {
						this.plugin.settings.attachmentsFolder = normalizeFolder(
							value,
							DEFAULT_SETTINGS.attachmentsFolder,
						);
						await this.plugin.saveSettings();
					}),
			);

		containerEl.createEl("h3", { text: "Local Ollama" });
		containerEl.createEl("p", {
			text: "Used as the Tier 3 URL-extraction fallback when JSON-LD and DOM heuristics cannot extract ingredients and instructions. No cloud-model fallback is used.",
		});

		new Setting(containerEl)
			.setName("Ollama endpoint")
			.setDesc("Base URL for the local Ollama server (chat path is /api/chat).")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.ollamaEndpoint)
					.setValue(this.plugin.settings.ollamaEndpoint)
					.onChange(async (value) => {
						this.plugin.settings.ollamaEndpoint = normalizeEndpoint(value);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Default model")
			.setDesc("Primary local model for structured recipe extraction.")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.ollamaModel)
					.setValue(this.plugin.settings.ollamaModel)
					.onChange(async (value) => {
						this.plugin.settings.ollamaModel =
							value.trim() || DEFAULT_SETTINGS.ollamaModel;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Lightweight model")
			.setDesc("Optional smaller local model (llama3.2:3b-instruct or qwen2.5:3b-instruct).")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.ollamaLightweightModel)
					.setValue(this.plugin.settings.ollamaLightweightModel)
					.onChange(async (value) => {
						this.plugin.settings.ollamaLightweightModel =
							value.trim() || DEFAULT_SETTINGS.ollamaLightweightModel;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Health-check timeout (ms)")
			.setDesc("Fail fast when Ollama is not reachable before starting extraction.")
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.ollamaHealthCheckMs))
					.setValue(String(this.plugin.settings.ollamaHealthCheckMs))
					.onChange(async (value) => {
						this.plugin.settings.ollamaHealthCheckMs = parsePositiveInt(
							value,
							DEFAULT_SETTINGS.ollamaHealthCheckMs,
						);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Extraction timeout (ms)")
			.setDesc("Maximum wait for a local Ollama extraction response.")
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.ollamaTimeoutMs))
					.setValue(String(this.plugin.settings.ollamaTimeoutMs))
					.onChange(async (value) => {
						this.plugin.settings.ollamaTimeoutMs = parsePositiveInt(
							value,
							DEFAULT_SETTINGS.ollamaTimeoutMs,
						);
						await this.plugin.saveSettings();
					}),
			);
	}
}
