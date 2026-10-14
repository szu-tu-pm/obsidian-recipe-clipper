import {
	parseRecipeFile,
	serializeRecipeFile,
	type YamlCodec,
} from "../schema/recipeMarkdown";
import {
	joinVaultPath,
	slugifyTitle,
	type RecipeDocument,
} from "../schema/recipeSchema";
import type { RecipeIndexer } from "./recipeIndexer";
import type { VaultPort } from "./vaultPort";

export type RecipeLoadResult =
	| { ok: true; recipe: RecipeDocument }
	| { ok: false; path: string; message: string; raw: string | null };

export class RecipeRepository {
	constructor(
		private readonly vault: VaultPort,
		private readonly yaml: YamlCodec,
		private readonly indexer: RecipeIndexer,
		private recipesFolder: string,
	) {}

	configure(recipesFolder: string): void {
		this.recipesFolder = recipesFolder;
	}

	async loadById(id: string): Promise<RecipeLoadResult> {
		const entry = this.indexer.getById(id);
		if (!entry) {
			return { ok: false, path: "", message: `Recipe ${id} is not in the index.`, raw: null };
		}
		return this.loadByPath(entry.path);
	}

	async loadByPath(path: string): Promise<RecipeLoadResult> {
		try {
			const raw = await this.vault.read(path);
			try {
				const recipe = parseRecipeFile(raw, this.yaml, path);
				return { ok: true, recipe };
			} catch (error) {
				return {
					ok: false,
					path,
					message: error instanceof Error ? error.message : "Invalid recipe Markdown.",
					raw,
				};
			}
		} catch (error) {
			return {
				ok: false,
				path,
				message: error instanceof Error ? error.message : "Unable to read recipe file.",
				raw: null,
			};
		}
	}

	async save(recipe: RecipeDocument): Promise<RecipeDocument> {
		await this.vault.mkdir(this.recipesFolder);
		const next: RecipeDocument = {
			...recipe,
			frontmatter: {
				...recipe.frontmatter,
				updatedAt: new Date().toISOString(),
			},
			editedExternally: false,
		};
		const path = recipe.path ?? (await this.nextPath(next.frontmatter.title, next.frontmatter.id));
		const markdown = serializeRecipeFile({ ...next, path }, this.yaml);
		await this.vault.write(path, markdown);
		return { ...next, path };
	}

	async remove(id: string): Promise<void> {
		const entry = this.indexer.getById(id);
		if (!entry) {
			return;
		}
		if (await this.vault.exists(entry.path)) {
			await this.vault.remove(entry.path);
		}
	}

	private async nextPath(title: string, id: string): Promise<string> {
		const slug = slugifyTitle(title);
		const preferred = joinVaultPath(this.recipesFolder, `${slug}.md`);
		if (!(await this.vault.exists(preferred))) {
			return preferred;
		}
		const existing = this.indexer.getByPath(preferred);
		if (existing?.id === id) {
			return preferred;
		}
		return joinVaultPath(this.recipesFolder, `${slug}-${id.slice(4, 10)}.md`);
	}
}
