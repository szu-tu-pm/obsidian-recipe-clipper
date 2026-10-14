import { App, PluginSettingTab, Setting, type TextComponent } from "obsidian";
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

function persistTextOnBlur(
	text: TextComponent,
	apply: (raw: string) => string,
	assign: (next: string) => void,
	save: () => Promise<void>,
): void {
	text.inputEl.addEventListener("blur", () => {
		const next = apply(text.getValue());
		assign(next);
		text.setValue(String(next));
		void save();
	});
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

		const save = () => this.plugin.saveSettings();

		containerEl.createEl("h2", { text: "Recipe Manager & Shopping Lists" });

		containerEl.createEl("h3", { text: "Vault folders" });

		new Setting(containerEl)
			.setName("Recipes folder")
			.setDesc("Markdown recipes are stored here (schemaVersion 1).")
			.addText((text) => {
				text
					.setPlaceholder(DEFAULT_SETTINGS.recipesFolder)
					.setValue(this.plugin.settings.recipesFolder);
				persistTextOnBlur(
					text,
					(raw) => normalizeFolder(raw, DEFAULT_SETTINGS.recipesFolder),
					(next) => {
						this.plugin.settings.recipesFolder = next;
					},
					save,
				);
			});

		new Setting(containerEl)
			.setName("Shopping lists folder")
			.setDesc("Generated shopping lists are stored independently from recipes.")
			.addText((text) => {
				text
					.setPlaceholder(DEFAULT_SETTINGS.shoppingListsFolder)
					.setValue(this.plugin.settings.shoppingListsFolder);
				persistTextOnBlur(
					text,
					(raw) => normalizeFolder(raw, DEFAULT_SETTINGS.shoppingListsFolder),
					(next) => {
						this.plugin.settings.shoppingListsFolder = next;
					},
					save,
				);
			});

		new Setting(containerEl)
			.setName("Recipe attachments folder")
			.setDesc("Recipe images are stored under this folder, grouped by recipe id.")
			.addText((text) => {
				text
					.setPlaceholder(DEFAULT_SETTINGS.attachmentsFolder)
					.setValue(this.plugin.settings.attachmentsFolder);
				persistTextOnBlur(
					text,
					(raw) => normalizeFolder(raw, DEFAULT_SETTINGS.attachmentsFolder),
					(next) => {
						this.plugin.settings.attachmentsFolder = next;
					},
					save,
				);
			});

		containerEl.createEl("h3", { text: "Local Ollama" });
		containerEl.createEl("p", {
			text: "Used as the Tier 3 URL-extraction fallback when JSON-LD and DOM heuristics cannot extract ingredients and instructions. No cloud-model fallback is used.",
		});

		new Setting(containerEl)
			.setName("Ollama endpoint")
			.setDesc("Base URL for the local Ollama server (chat path is /api/chat).")
			.addText((text) => {
				text
					.setPlaceholder(DEFAULT_SETTINGS.ollamaEndpoint)
					.setValue(this.plugin.settings.ollamaEndpoint);
				persistTextOnBlur(
					text,
					normalizeEndpoint,
					(next) => {
						this.plugin.settings.ollamaEndpoint = next;
					},
					save,
				);
			});

		new Setting(containerEl)
			.setName("Default model")
			.setDesc("Primary local model for structured recipe extraction.")
			.addText((text) => {
				text
					.setPlaceholder(DEFAULT_SETTINGS.ollamaModel)
					.setValue(this.plugin.settings.ollamaModel);
				persistTextOnBlur(
					text,
					(raw) => raw.trim() || DEFAULT_SETTINGS.ollamaModel,
					(next) => {
						this.plugin.settings.ollamaModel = next;
					},
					save,
				);
			});

		new Setting(containerEl)
			.setName("Lightweight model")
			.setDesc("Optional smaller local model (llama3.2:3b-instruct or qwen2.5:3b-instruct).")
			.addText((text) => {
				text
					.setPlaceholder(DEFAULT_SETTINGS.ollamaLightweightModel)
					.setValue(this.plugin.settings.ollamaLightweightModel);
				persistTextOnBlur(
					text,
					(raw) => raw.trim() || DEFAULT_SETTINGS.ollamaLightweightModel,
					(next) => {
						this.plugin.settings.ollamaLightweightModel = next;
					},
					save,
				);
			});

		new Setting(containerEl)
			.setName("Health-check timeout (ms)")
			.setDesc("Fail fast when Ollama is not reachable before starting extraction.")
			.addText((text) => {
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.ollamaHealthCheckMs))
					.setValue(String(this.plugin.settings.ollamaHealthCheckMs));
				persistTextOnBlur(
					text,
					(raw) =>
						String(
							parsePositiveInt(raw, DEFAULT_SETTINGS.ollamaHealthCheckMs),
						),
					(next) => {
						this.plugin.settings.ollamaHealthCheckMs = Number.parseInt(next, 10);
					},
					save,
				);
			});

		new Setting(containerEl)
			.setName("Extraction timeout (ms)")
			.setDesc("Maximum wait for a local Ollama extraction response.")
			.addText((text) => {
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.ollamaTimeoutMs))
					.setValue(String(this.plugin.settings.ollamaTimeoutMs));
				persistTextOnBlur(
					text,
					(raw) => String(parsePositiveInt(raw, DEFAULT_SETTINGS.ollamaTimeoutMs)),
					(next) => {
						this.plugin.settings.ollamaTimeoutMs = Number.parseInt(next, 10);
					},
					save,
				);
			});
	}

	hide(): void {
		const active = this.containerEl.ownerDocument.activeElement;
		if (active instanceof HTMLElement && this.containerEl.contains(active)) {
			active.blur();
		}
		super.hide();
	}
}
