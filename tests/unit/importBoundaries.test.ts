import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// The only modules allowed to import `obsidian`. Keep in sync with docs/adr/001-react-obsidian-wrapper.md.
const ALLOWED_OBSIDIAN_IMPORTERS = [
	"src/domain/vault/obsidianVault.ts",
	"src/main.ts",
	"src/settings.ts",
	"src/wrapper/RecipeItemView.ts",
	"src/wrapper/RecipeViewRoot.tsx",
	"src/wrapper/createObsidianPluginHost.ts",
];

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

export function hasObsidianImport(filePath: string): boolean {
	const content = readFileSync(filePath, "utf8");
	return (
		/from\s+["']obsidian["']/.test(content) ||
		/import\s+["']obsidian["']/.test(content) ||
		/require\s*\(\s*["']obsidian["']\s*\)/.test(content) ||
		/import\s*\(\s*["']obsidian["']\s*\)/.test(content)
	);
}

/** Repo-relative, forward-slash paths of every file under `<root>/src` that imports obsidian. */
function findObsidianImporters(root: string): string[] {
	return getSourceFiles(join(root, "src"))
		.filter(hasObsidianImport)
		.map((file) => relative(root, file).replace(/\\/g, "/"))
		.sort();
}

/** The gate the real-tree test and the mutation tests share: importers not on the allowlist. */
function unexpectedImporters(root: string): string[] {
	return findObsidianImporters(root).filter((file) => !ALLOWED_OBSIDIAN_IMPORTERS.includes(file));
}

describe("ADR-001 architectural import boundaries", () => {
	it("ensures React UI in src/ui never imports obsidian directly", () => {
		const uiFiles = getSourceFiles("src/ui");
		expect(uiFiles.length).toBeGreaterThan(0);
		for (const file of uiFiles) {
			expect(hasObsidianImport(file), `File ${file} must not import obsidian`).toBe(false);
		}
	});

	it("ensures core domain logic never imports obsidian", () => {
		for (const folder of ["aggregation", "extraction", "schema", "translation"]) {
			const files = getSourceFiles(`src/domain/${folder}`);
			expect(files.length).toBeGreaterThan(0);
			for (const file of files) {
				expect(hasObsidianImport(file), `Domain file ${file} must not import obsidian`).toBe(false);
			}
		}
	});

	it("lets exactly the allowed modules import obsidian", () => {
		expect(unexpectedImporters(".")).toEqual([]);
		// Exact match also catches an allowlist entry that no longer imports obsidian.
		expect(findObsidianImporters(".")).toEqual([...ALLOWED_OBSIDIAN_IMPORTERS].sort());
	});

	describe("the gate fails on a violation", () => {
		const tempRoots: string[] = [];
		afterEach(() => {
			for (const root of tempRoots.splice(0)) {
				rmSync(root, { recursive: true, force: true });
			}
		});

		function scratchTree(extra: Record<string, string>): string {
			const root = mkdtempSync(join(tmpdir(), "adr001-"));
			tempRoots.push(root);
			const files: Record<string, string> = {
				"src/main.ts": 'import { Plugin } from "obsidian";\n',
				...extra,
			};
			for (const [path, content] of Object.entries(files)) {
				mkdirSync(dirname(join(root, path)), { recursive: true });
				writeFileSync(join(root, path), content);
			}
			return root;
		}

		it("passes a tree with only allowed importers", () => {
			expect(unexpectedImporters(scratchTree({ "src/domain/schema/ok.ts": "export const a = 1;\n" }))).toEqual([]);
		});

		it.each([
			["src/domain/schema/leak.ts", 'import { TFile } from "obsidian";\n'],
			["src/ui/Leak.tsx", 'import { Notice } from "obsidian";\n'],
			["src/domain/vault/other.ts", 'export type { Vault } from "obsidian";\n'],
			["src/ui/Side.ts", 'import "obsidian";\n'],
			["src/wrapper/PluginServiceAdapter.ts", 'const o = require("obsidian");\n'],
		])("reports a new importer at %s", (path, content) => {
			expect(unexpectedImporters(scratchTree({ [path]: content }))).toEqual([path]);
		});
	});
});
