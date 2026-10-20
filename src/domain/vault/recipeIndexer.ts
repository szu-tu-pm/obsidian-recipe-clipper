import {
	joinVaultPath,
	safeParseRecipeFrontmatter,
	type RecipeFrontmatter,
} from "../schema/recipeSchema";
import type { CachedFrontmatter, FrontmatterCachePort } from "./vaultPort";

export interface IndexVaultEvent {
	kind: "create" | "modify" | "delete" | "rename" | "metadata";
	path: string;
	previousPath?: string;
}

export interface RecipeIndexEntry {
	id: string;
	path: string;
	title: string;
	rating: RecipeFrontmatter["rating"];
	sourceUrl: string | null;
	primaryImagePath: string | null;
	updatedAt: string;
	schemaVersion: number;
}

function isUnderFolder(path: string, folder: string): boolean {
	const prefix = joinVaultPath(folder);
	return path === prefix || path.startsWith(`${prefix}/`);
}

function isAttachmentPath(path: string, attachmentsFolder: string): boolean {
	return isUnderFolder(path, attachmentsFolder);
}

function isRecipeMarkdownPath(
	path: string,
	recipesFolder: string,
	attachmentsFolder: string,
): boolean {
	return (
		path.endsWith(".md") &&
		isUnderFolder(path, recipesFolder) &&
		!isAttachmentPath(path, attachmentsFolder)
	);
}

function entryFromFrontmatter(
	path: string,
	frontmatter: Record<string, unknown> | null,
): RecipeIndexEntry | null {
	const parsed = safeParseRecipeFrontmatter(frontmatter);
	if (!parsed.success) {
		return null;
	}
	const recipe = parsed.data;
	const primary =
		recipe.images.find((image) => image.isPrimary) ?? recipe.images[0] ?? null;
	return {
		id: recipe.id,
		path,
		title: recipe.title,
		rating: recipe.rating,
		sourceUrl: recipe.sourceUrl,
		primaryImagePath: primary?.path ?? null,
		updatedAt: recipe.updatedAt,
		schemaVersion: recipe.schemaVersion,
	};
}

export class RecipeIndexer {
	private readonly byId = new Map<string, RecipeIndexEntry>();
	private readonly byPath = new Map<string, RecipeIndexEntry>();

	constructor(
		private recipesFolder: string,
		private attachmentsFolder: string,
	) {}

	configure(recipesFolder: string, attachmentsFolder: string): void {
		this.recipesFolder = recipesFolder;
		this.attachmentsFolder = attachmentsFolder;
	}

	/** Recipe notes only. Attachment markdown under the recipes folder is not one. */
	isRecipeNotePath(path: string): boolean {
		return isRecipeMarkdownPath(path, this.recipesFolder, this.attachmentsFolder);
	}

	rebuild(rows: CachedFrontmatter[]): void {
		this.byId.clear();
		this.byPath.clear();
		for (const row of rows) {
			this.upsert(row.path, row.frontmatter);
		}
	}

	rebuildFromCache(cache: FrontmatterCachePort): void {
		this.rebuild(cache.listMarkdown(this.recipesFolder));
	}

	list(): RecipeIndexEntry[] {
		return [...this.byId.values()].sort((a, b) => a.title.localeCompare(b.title));
	}

	getById(id: string): RecipeIndexEntry | undefined {
		return this.byId.get(id);
	}

	getByPath(path: string): RecipeIndexEntry | undefined {
		return this.byPath.get(path);
	}

	applyVaultEvent(
		event: IndexVaultEvent,
		cache: FrontmatterCachePort,
	): void {
		if (event.kind === "rename" && event.previousPath) {
			this.rename(event.previousPath, event.path, cache.readFrontmatter(event.path));
			return;
		}
		if (event.kind === "delete") {
			this.removePath(event.path);
			return;
		}
		if (
			!isRecipeMarkdownPath(event.path, this.recipesFolder, this.attachmentsFolder)
		) {
			return;
		}
		this.upsert(event.path, cache.readFrontmatter(event.path));
	}

	private upsert(path: string, frontmatter: Record<string, unknown> | null): void {
		if (!isRecipeMarkdownPath(path, this.recipesFolder, this.attachmentsFolder)) {
			return;
		}
		const existing = this.byPath.get(path);
		const entry = entryFromFrontmatter(path, frontmatter);
		if (!entry) {
			this.removePath(path);
			return;
		}
		if (existing && existing.id !== entry.id) {
			this.byId.delete(existing.id);
		}
		this.byId.set(entry.id, entry);
		this.byPath.set(path, entry);
	}

	private rename(
		previousPath: string,
		nextPath: string,
		frontmatter: Record<string, unknown> | null,
	): void {
		const existing = this.byPath.get(previousPath);
		this.byPath.delete(previousPath);
		if (
			!isRecipeMarkdownPath(nextPath, this.recipesFolder, this.attachmentsFolder)
		) {
			if (existing) {
				this.byId.delete(existing.id);
			}
			return;
		}
		const entry = entryFromFrontmatter(nextPath, frontmatter) ??
			(existing ? { ...existing, path: nextPath } : null);
		if (!entry) {
			return;
		}
		this.byId.set(entry.id, entry);
		this.byPath.set(nextPath, entry);
	}

	private removePath(path: string): void {
		const existing = this.byPath.get(path);
		if (!existing) {
			return;
		}
		this.byPath.delete(path);
		if (this.byId.get(existing.id)?.path === path) {
			this.byId.delete(existing.id);
		}
	}
}
