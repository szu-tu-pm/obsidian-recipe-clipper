import { joinVaultPath } from "../schema/recipeSchema";
import type { YamlCodec } from "../schema/recipeMarkdown";
import type { CachedFrontmatter, FrontmatterCachePort, VaultPort } from "./vaultPort";

export class InMemoryVault implements VaultPort, FrontmatterCachePort {
	private readonly files = new Map<string, string | ArrayBuffer>();

	async read(path: string): Promise<string> {
		const value = this.files.get(path);
		if (typeof value !== "string") {
			throw new Error(`Missing text file: ${path}`);
		}
		return value;
	}

	async write(path: string, content: string): Promise<void> {
		this.files.set(path, content);
	}

	async exists(path: string): Promise<boolean> {
		if (this.files.has(path)) {
			return true;
		}
		const prefix = `${path}/`;
		for (const key of this.files.keys()) {
			if (key.startsWith(prefix)) {
				return true;
			}
		}
		return false;
	}

	async remove(path: string): Promise<void> {
		this.files.delete(path);
	}

	async mkdir(_path: string): Promise<void> {}

	async list(folder: string): Promise<string[]> {
		const prefix = `${folder}/`;
		return [...this.files.keys()].filter((path) => path.startsWith(prefix) || path === folder);
	}

	async readBinary(path: string): Promise<ArrayBuffer> {
		const value = this.files.get(path);
		if (value instanceof ArrayBuffer) {
			return value;
		}
		throw new Error(`Missing binary file: ${path}`);
	}

	async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
		this.files.set(path, data);
	}

	listMarkdown(folder: string): CachedFrontmatter[] {
		const prefix = joinVaultPath(folder);
		return [...this.files.entries()]
			.filter(([path, value]) => typeof value === "string" && path.startsWith(prefix) && path.endsWith(".md"))
			.map(([path, value]) => ({
				path,
				frontmatter: this.frontmatterFromMarkdown(String(value)),
			}));
	}

	readFrontmatter(path: string): Record<string, unknown> | null {
		const value = this.files.get(path);
		if (typeof value !== "string") {
			return null;
		}
		return this.frontmatterFromMarkdown(value);
	}

	private frontmatterFromMarkdown(markdown: string): Record<string, unknown> | null {
		if (!markdown.startsWith("---\n")) {
			return null;
		}
		const end = markdown.indexOf("\n---", 3);
		if (end === -1) {
			return null;
		}
		try {
			return jsonYamlCodec.parse(markdown.slice(4, end)) as Record<string, unknown>;
		} catch {
			return null;
		}
	}
}

export const jsonYamlCodec: YamlCodec = {
	parse: (yaml) => JSON.parse(yaml),
	stringify: (value) => JSON.stringify(value, null, 2),
};
