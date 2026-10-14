import {
	normalizePath,
	parseYaml,
	stringifyYaml,
	TFile,
	TFolder,
	type MetadataCache,
	type Vault,
} from "obsidian";
import { joinVaultPath } from "../schema/recipeSchema";
import type { YamlCodec } from "../schema/recipeMarkdown";
import type { CachedFrontmatter, FrontmatterCachePort, VaultPort } from "./vaultPort";

export const obsidianYamlCodec: YamlCodec = {
	parse: (yaml) => parseYaml(yaml) ?? {},
	stringify: (value) => stringifyYaml(value).trimEnd(),
};

export function createObsidianVaultPort(vault: Vault): VaultPort {
	return {
		read: async (path) => {
			const file = requireFile(vault, path);
			return vault.read(file);
		},
		write: async (path, content) => {
			const normalized = normalizePath(path);
			const existing = vault.getAbstractFileByPath(normalized);
			if (existing instanceof TFile) {
				await vault.modify(existing, content);
				return;
			}
			await ensureParent(vault, normalized);
			await vault.create(normalized, content);
		},
		exists: async (path) => vault.getAbstractFileByPath(normalizePath(path)) !== null,
		remove: async (path) => {
			const file = vault.getAbstractFileByPath(normalizePath(path));
			if (file) {
				await vault.delete(file);
			}
		},
		mkdir: async (path) => {
			await ensureParent(vault, `${normalizePath(path)}/_`);
		},
		list: async (folder) => {
			const abstract = vault.getAbstractFileByPath(normalizePath(folder));
			if (!(abstract instanceof TFolder)) {
				return [];
			}
			return abstract.children.map((child) => child.path);
		},
		readBinary: async (path) => {
			const file = requireFile(vault, path);
			return vault.readBinary(file);
		},
		writeBinary: async (path, data) => {
			const normalized = normalizePath(path);
			const existing = vault.getAbstractFileByPath(normalized);
			if (existing instanceof TFile) {
				await vault.modifyBinary(existing, data);
				return;
			}
			await ensureParent(vault, normalized);
			await vault.createBinary(normalized, data);
		},
	};
}

export function createObsidianFrontmatterCache(
	vault: Vault,
	metadataCache: MetadataCache,
	attachmentsFolder: string,
): FrontmatterCachePort {
	const attachments = joinVaultPath(attachmentsFolder);
	return {
		listMarkdown: (folder) => {
			const prefix = joinVaultPath(folder);
			const rows: CachedFrontmatter[] = [];
			for (const file of vault.getMarkdownFiles()) {
				if (!(file.path === prefix || file.path.startsWith(`${prefix}/`))) {
					continue;
				}
				if (file.path === attachments || file.path.startsWith(`${attachments}/`)) {
					continue;
				}
				rows.push({
					path: file.path,
					frontmatter: metadataCache.getFileCache(file)?.frontmatter ?? null,
				});
			}
			return rows;
		},
		readFrontmatter: (path) => {
			const file = vault.getAbstractFileByPath(normalizePath(path));
			if (!(file instanceof TFile)) {
				return null;
			}
			return metadataCache.getFileCache(file)?.frontmatter ?? null;
		},
	};
}

function requireFile(vault: Vault, path: string): TFile {
	const file = vault.getAbstractFileByPath(normalizePath(path));
	if (!(file instanceof TFile)) {
		throw new Error(`Missing vault file: ${path}`);
	}
	return file;
}

async function ensureParent(vault: Vault, path: string): Promise<void> {
	const parts = normalizePath(path).split("/");
	parts.pop();
	if (parts.length === 0) {
		return;
	}
	let current = "";
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (!vault.getAbstractFileByPath(current)) {
			await vault.createFolder(current);
		}
	}
}
