import { ItemView, type WorkspaceLeaf } from "obsidian";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginServices } from "./PluginServiceAdapter";
import { RecipeViewRoot } from "./RecipeViewRoot";
import { WrapperProvider } from "./WrapperContext";

export const RECIPE_VIEW_TYPE = "recipe-manager-view";

export class RecipeItemView extends ItemView {
	private reactRoot: Root | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly services: PluginServices,
	) {
		super(leaf);
	}

	getViewType(): string {
		return RECIPE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Recipes";
	}

	getIcon(): string {
		return "utensils-crossed";
	}

	async onOpen(): Promise<void> {
		this.mountReact();
	}

	async onClose(): Promise<void> {
		this.unmountReact();
	}

	mountReact(): void {
		this.unmountReact();
		this.contentEl.empty();
		this.contentEl.addClass("recipe-clipper");
		const host = this.contentEl.createDiv({ cls: "recipe-clipper-root" });
		this.reactRoot = createRoot(host);
		this.reactRoot.render(
			createElement(
				WrapperProvider,
				{ services: this.services },
				createElement(RecipeViewRoot),
			),
		);
	}

	unmountReact(): void {
		if (this.reactRoot) {
			this.reactRoot.unmount();
			this.reactRoot = null;
		}
		this.contentEl.empty();
	}
}
