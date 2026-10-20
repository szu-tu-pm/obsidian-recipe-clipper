import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function getSourceFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			files.push(...getSourceFiles(full));
		} else if (/\.(ts|tsx)$/.test(entry)) {
			files.push(full);
		}
	}
	return files;
}

function hasObsidianImport(filePath: string): boolean {
	const content = readFileSync(filePath, "utf8");
	return /from\s+["']obsidian["']/.test(content) || /require\(["']obsidian["']\)/.test(content);
}

describe("ADR-001 architectural import boundaries", () => {
	it("ensures React UI in src/ui never imports obsidian directly", () => {
		const uiFiles = getSourceFiles("src/ui");
		expect(uiFiles.length).toBeGreaterThan(0);
		for (const file of uiFiles) {
			const importsObsidian = hasObsidianImport(file);
			expect(importsObsidian, `File ${file} must not import obsidian`).toBe(false);
		}
	});

	it("ensures core domain logic never imports obsidian", () => {
		const domainFolders = [
			"src/domain/aggregation",
			"src/domain/extraction",
			"src/domain/schema",
			"src/domain/translation",
		];
		for (const folder of domainFolders) {
			const files = getSourceFiles(folder);
			expect(files.length).toBeGreaterThan(0);
			for (const file of files) {
				const importsObsidian = hasObsidianImport(file);
				expect(importsObsidian, `Domain file ${file} must not import obsidian`).toBe(false);
			}
		}
	});

	it("restricts obsidian imports in src/domain/vault to obsidianVault.ts only", () => {
		const vaultFiles = getSourceFiles("src/domain/vault");
		expect(vaultFiles.length).toBeGreaterThan(0);
		for (const file of vaultFiles) {
			const importsObsidian = hasObsidianImport(file);
			const isAllowed = file.replace(/\\/g, "/").endsWith("src/domain/vault/obsidianVault.ts");
			if (importsObsidian) {
				expect(isAllowed, `Unexpected obsidian import in ${file}`).toBe(true);
			}
		}
	});
});
