import type { YamlCodec } from "../schema/recipeMarkdown";
import {
	parseShoppingListFile,
	serializeShoppingListFile,
} from "../schema/shoppingListMarkdown";
import { joinVaultPath } from "../schema/recipeSchema";
import {
	shoppingListSlug,
	type ShoppingListDocument,
} from "../schema/shoppingListSchema";
import { replaceTextFile, VaultFilePreservedError } from "./safeWrite";
import type { VaultPort } from "./vaultPort";

export type ShoppingListLoadResult =
	| { ok: true; list: ShoppingListDocument }
	| { ok: false; path: string; message: string; raw: string | null };

export class ShoppingListRepository {
	private readonly paths = new Map<string, string>();

	constructor(
		private readonly vault: VaultPort,
		private readonly yaml: YamlCodec,
		private folder: string,
	) {}

	configure(folder: string): void {
		this.folder = folder;
		this.paths.clear();
	}

	async save(list: ShoppingListDocument): Promise<ShoppingListDocument> {
		await this.vault.mkdir(this.folder);
		const next: ShoppingListDocument = {
			...list,
			frontmatter: {
				...list.frontmatter,
				updatedAt: new Date().toISOString(),
			},
		};
		const path = await this.nextPath(next);
		await this.refuseUnreadableTarget(path, next.frontmatter.id);
		const markdown = serializeShoppingListFile({ ...next, path }, this.yaml);
		await replaceTextFile(this.vault, path, markdown);
		this.paths.set(next.frontmatter.id, path);
		return { ...next, path };
	}

	async list(): Promise<ShoppingListDocument[]> {
		const paths = (await this.vault.list(this.folder)).filter((path) => path.endsWith(".md"));
		const lists: ShoppingListDocument[] = [];
		for (const path of paths) {
			const loaded = await this.loadByPath(path);
			if (loaded.ok) {
				lists.push(loaded.list);
			}
		}
		lists.sort((a, b) => b.frontmatter.updatedAt.localeCompare(a.frontmatter.updatedAt));
		return lists;
	}

	async loadById(id: string): Promise<ShoppingListLoadResult> {
		const known = this.paths.get(id);
		if (known) {
			const loaded = await this.loadByPath(known);
			if (loaded.ok && loaded.list.frontmatter.id === id) {
				return loaded;
			}
		}
		const paths = (await this.vault.list(this.folder)).filter((path) => path.endsWith(".md"));
		for (const path of paths) {
			const loaded = await this.loadByPath(path);
			if (!loaded.ok) {
				continue;
			}
			this.paths.set(loaded.list.frontmatter.id, path);
			if (loaded.list.frontmatter.id === id) {
				return loaded;
			}
		}
		return {
			ok: false,
			path: "",
			message: `Shopping list ${id} was not found.`,
			raw: null,
		};
	}

	async loadByPath(path: string): Promise<ShoppingListLoadResult> {
		try {
			const raw = await this.vault.read(path);
			try {
				const list = parseShoppingListFile(raw, this.yaml, path);
				this.paths.set(list.frontmatter.id, path);
				return { ok: true, list };
			} catch (error) {
				return {
					ok: false,
					path,
					message: error instanceof Error ? error.message : "Invalid shopping list Markdown.",
					raw,
				};
			}
		} catch (error) {
			return {
				ok: false,
				path,
				message: error instanceof Error ? error.message : "Unable to read shopping list file.",
				raw: null,
			};
		}
	}

	private async refuseUnreadableTarget(path: string, listId: string): Promise<void> {
		if (!(await this.vault.exists(path))) {
			return;
		}
		const current = await this.loadByPath(path);
		if (!current.ok) {
			throw new VaultFilePreservedError(`Left ${path} unchanged. ${current.message}`);
		}
		if (current.list.frontmatter.id !== listId) {
			throw new VaultFilePreservedError(
				`Left ${path} unchanged. It belongs to a different shopping list.`,
			);
		}
	}

	private async nextPath(list: ShoppingListDocument): Promise<string> {
		if (list.path) {
			return list.path;
		}
		const preferred = joinVaultPath(
			this.folder,
			`${shoppingListSlug(list.frontmatter.title, list.frontmatter.createdAt)}.md`,
		);
		if (!(await this.vault.exists(preferred))) {
			return preferred;
		}
		const existing = await this.loadByPath(preferred);
		if (existing.ok && existing.list.frontmatter.id === list.frontmatter.id) {
			return preferred;
		}
		return joinVaultPath(
			this.folder,
			`${shoppingListSlug(list.frontmatter.title, list.frontmatter.createdAt)}-${list.frontmatter.id.slice(5, 11)}.md`,
		);
	}
}
