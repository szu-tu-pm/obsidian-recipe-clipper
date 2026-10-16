import {
	createManualRecipe,
	type RecipeDocument,
	type RecipeImage,
} from "../../src/domain/schema/recipeSchema";
import type { RecipeIndexEntry } from "../../src/domain/vault/recipeIndexer";
import { DEFAULT_SETTINGS, type RecipePluginSettings } from "../../src/pluginSettings";
import type {
	PluginServices,
	VaultChangeListener,
} from "../../src/wrapper/PluginServiceAdapter";

export interface MockRecipeStore {
	recipes: RecipeDocument[];
	settings: RecipePluginSettings;
}

function indexEntry(recipe: RecipeDocument): RecipeIndexEntry {
	const primary =
		recipe.frontmatter.images.find((image) => image.isPrimary) ??
		recipe.frontmatter.images[0];
	return {
		id: recipe.frontmatter.id,
		path: recipe.path ?? `Recipes/${recipe.frontmatter.title}.md`,
		title: recipe.frontmatter.title,
		rating: recipe.frontmatter.rating,
		sourceUrl: recipe.frontmatter.sourceUrl,
		primaryImagePath: primary?.path ?? null,
		updatedAt: recipe.frontmatter.updatedAt,
		schemaVersion: recipe.frontmatter.schemaVersion,
	};
}

export interface MockPluginServices extends PluginServices {
	removedImages: string[];
}

export function createMockPluginServices(
	store: MockRecipeStore = { recipes: [], settings: { ...DEFAULT_SETTINGS } },
): MockPluginServices {
	const recipeListeners = new Set<() => void>();
	const settingsListeners = new Set<() => void>();
	const vaultListeners = new Set<VaultChangeListener>();
	const urls = new Map<string, string>();
	const removedImages: string[] = [];
	let recipeSnapshot: RecipeIndexEntry[] = store.recipes.map(indexEntry);

	function emitRecipes(): void {
		recipeSnapshot = store.recipes.map(indexEntry);
		for (const listener of recipeListeners) {
			listener();
		}
	}

	return {
		getSettings: () => store.settings,
		subscribeSettings: (listener) => {
			settingsListeners.add(listener);
			return () => settingsListeners.delete(listener);
		},
		subscribeVaultChanges: (listener) => {
			vaultListeners.add(listener);
			return () => vaultListeners.delete(listener);
		},
		subscribeRecipes: (listener) => {
			recipeListeners.add(listener);
			return () => recipeListeners.delete(listener);
		},
		listRecipes: () => recipeSnapshot,
		loadRecipe: async (id) => {
			const recipe = store.recipes.find((item) => item.frontmatter.id === id);
			if (!recipe) {
				return { ok: false, path: "", message: `Missing recipe ${id}`, raw: null };
			}
			return { ok: true, recipe };
		},
		saveRecipe: async (recipe) => {
			const saved: RecipeDocument = {
				...recipe,
				path: recipe.path ?? `Recipes/${recipe.frontmatter.title}.md`,
			};
			const index = store.recipes.findIndex(
				(item) => item.frontmatter.id === saved.frontmatter.id,
			);
			if (index === -1) {
				store.recipes.push(saved);
			} else {
				store.recipes[index] = saved;
			}
			emitRecipes();
			return saved;
		},
		deleteRecipe: async (id) => {
			store.recipes = store.recipes.filter((item) => item.frontmatter.id !== id);
			emitRecipes();
		},
		addRecipeImage: async (_recipeId, filename, _data, existing) => {
			if (existing.length >= 5) {
				return null;
			}
			const image: RecipeImage = {
				path: `Recipes/_attachments/${filename}`,
				alt: "",
				sourceUrl: null,
				isPrimary: existing.length === 0,
			};
			urls.set(image.path, `blob:${image.path}`);
			return image;
		},
		removeRecipeImage: async (image) => {
			urls.delete(image.path);
			removedImages.push(image.path);
		},
		getImageUrl: (path) => urls.get(path) ?? null,
		openSettings: () => {},
		removedImages,
	};
}

export function seedRecipe(title: string, overrides: Partial<RecipeDocument> = {}): RecipeDocument {
	const recipe = createManualRecipe(title);
	return {
		...recipe,
		...overrides,
		frontmatter: {
			...recipe.frontmatter,
			...overrides.frontmatter,
			title,
		},
	};
}

