import {
	createManualRecipe,
	type RecipeDocument,
	type RecipeImage,
} from "../../src/domain/schema/recipeSchema";
import {
	loadWebClipForReview,
	saveReviewedWebClip,
	type PendingWebClip,
} from "../../src/domain/extraction/webClipperIntake";
import type { VaultPort } from "../../src/domain/vault/vaultPort";
import { clipYamlCodec } from "./webClipperFixtures";
import type { ShoppingListDocument } from "../../src/domain/schema/shoppingListSchema";
import type { RecipeIndexEntry } from "../../src/domain/vault/recipeIndexer";
import { DEFAULT_SETTINGS, type RecipePluginSettings } from "../../src/pluginSettings";
import type {
	PluginServices,
	VaultChangeEvent,
	VaultChangeListener,
} from "../../src/wrapper/PluginServiceAdapter";

export interface MockRecipeStore {
	recipes: RecipeDocument[];
	settings: RecipePluginSettings;
	shoppingLists?: ShoppingListDocument[];
	/** Pending web clip notes, read and saved through the real intake functions. */
	clips?: Array<{ path: string; title: string; markdown: string }>;
	/** The next N clip writes store only half the text and then throw. */
	failClipWrites?: number;
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
	shoppingLists: ShoppingListDocument[];
	/** Deliver a vault event to every current subscriber, like the real adapter does. */
	emitVaultChange(event: VaultChangeEvent): void;
	vaultListenerCount(): number;
}

export function createMockPluginServices(
	store: MockRecipeStore = { recipes: [], settings: { ...DEFAULT_SETTINGS } },
): MockPluginServices {
	const recipeListeners = new Set<() => void>();
	const settingsListeners = new Set<() => void>();
	const vaultListeners = new Set<VaultChangeListener>();
	const urls = new Map<string, string>();
	const removedImages: string[] = [];
	const shoppingLists = store.shoppingLists ?? [];
	store.shoppingLists = shoppingLists;
	let recipeSnapshot: RecipeIndexEntry[] = store.recipes.map(indexEntry);
	const clipEntries = (): PendingWebClip[] =>
		(store.clips ?? []).map((clip) => ({ path: clip.path, title: clip.title }));
	let clipSnapshot = clipEntries();
	const clipVault: VaultPort = {
		read: async (path) => {
			const clip = store.clips?.find((item) => item.path === path);
			if (!clip) {
				throw new Error(`Missing clip ${path}`);
			}
			return clip.markdown;
		},
		write: async (path, content) => {
			const clip = store.clips?.find((item) => item.path === path);
			if (!clip) {
				throw new Error(`Missing clip ${path}`);
			}
			if (store.failClipWrites) {
				store.failClipWrites -= 1;
				clip.markdown = content.slice(0, Math.floor(content.length / 2));
				throw new Error("disk full");
			}
			clip.markdown = content;
		},
		exists: async (path) => Boolean(store.clips?.some((item) => item.path === path)),
		remove: async () => {},
		mkdir: async () => {},
		list: async () => [],
		readBinary: async () => new ArrayBuffer(0),
		writeBinary: async () => {},
	};

	function emitRecipes(): void {
		recipeSnapshot = store.recipes.map(indexEntry);
		clipSnapshot = clipEntries();
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
		listRecipeDiagnostics: async () => [],
		listPendingClips: () => clipSnapshot,
		loadClipReview: (path) =>
			loadWebClipForReview(
				clipVault,
				clipYamlCodec,
				path,
				recipeSnapshot.map((recipe) => ({
					id: recipe.id,
					sourceUrl: recipe.sourceUrl,
					path: recipe.path,
				})),
			),
		saveClipReview: async (path, revision, recipe) => {
			const outcome = await saveReviewedWebClip(clipVault, clipYamlCodec, path, revision, recipe);
			if (outcome.status === "saved") {
				store.clips = (store.clips ?? []).filter((clip) => clip.path !== path);
				store.recipes.push(outcome.recipe);
				emitRecipes();
			}
			return outcome;
		},
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
		saveShoppingList: async (list) => {
			const saved: ShoppingListDocument = {
				...list,
				path: list.path ?? `Shopping Lists/${list.frontmatter.title}.md`,
				frontmatter: {
					...list.frontmatter,
					updatedAt: new Date().toISOString(),
				},
			};
			const index = shoppingLists.findIndex(
				(item) => item.frontmatter.id === saved.frontmatter.id,
			);
			if (index === -1) {
				shoppingLists.push(saved);
			} else {
				shoppingLists[index] = saved;
			}
			return saved;
		},
		loadShoppingList: async (id) => {
			const list = shoppingLists.find((item) => item.frontmatter.id === id);
			if (!list) {
				return { ok: false, path: "", message: `Missing shopping list ${id}`, raw: null };
			}
			return { ok: true, list };
		},
		listShoppingLists: async () => [...shoppingLists],
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
		shoppingLists,
		emitVaultChange: (event) => {
			for (const listener of [...vaultListeners]) {
				listener(event);
			}
		},
		vaultListenerCount: () => vaultListeners.size,
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

