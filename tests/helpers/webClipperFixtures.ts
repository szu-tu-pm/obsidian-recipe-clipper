import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { YamlCodec } from "../../src/domain/schema/recipeMarkdown";
import { InMemoryVault } from "../../src/domain/vault/inMemoryVault";
import type { CachedFrontmatter } from "../../src/domain/vault/vaultPort";

const ROOT = join(__dirname, "..", "..");
export const FIXTURE_DIR = join(ROOT, "tests", "fixtures", "web-clipper");
export const TEMPLATE_PATH = join(ROOT, "clipper", "recipe.web-clipper.json");

export interface WebClipperTemplate {
	schemaVersion: string;
	name: string;
	behavior: string;
	noteNameFormat: string;
	path: string;
	triggers: string[];
	properties: Array<{ name: string; value: string; type: string }>;
	noteContentFormat: string;
}

export interface ClipSource {
	category: string;
	page: { url: string; title: string; site: string; author: string; date: string };
	recipe: Record<string, unknown>;
}

export const FIXTURE_NAMES = [
	"complete-howtostep",
	"partial-string-steps",
	"no-schema",
	"sections-relative-image",
	"repeat-url",
] as const;

export type FixtureName = (typeof FIXTURE_NAMES)[number];

export function loadTemplate(): WebClipperTemplate {
	return JSON.parse(readFileSync(TEMPLATE_PATH, "utf8")) as WebClipperTemplate;
}

export function loadClip(name: FixtureName): string {
	return readFileSync(join(FIXTURE_DIR, `${name}.md`), "utf8");
}

export function loadSource(name: FixtureName): ClipSource {
	return JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.source.json`), "utf8")) as ClipSource;
}

/**
 * A small stand-in for the Web Clipper renderer, covering only what the template
 * uses: plain page variables and unfiltered `{{schema:@Recipe:key}}` lookups.
 * Arrays and objects become JSON text, text properties are written double-quoted
 * with quotes and newlines escaped, and empty values are left blank. The real
 * clipper in Chrome is a person-run check; this keeps the fixtures honest to the
 * template file in CI.
 */
export function renderTemplate(template: WebClipperTemplate, source: ClipSource): string {
	const page: Record<string, string> = {
		url: source.page.url,
		title: source.page.title,
		site: source.page.site,
		author: source.page.author,
		date: source.page.date,
	};
	const fill = (text: string): string =>
		text.replace(/\{\{([^}|]+)\}\}/g, (_match, expression: string) => {
			const key = expression.trim();
			const schema = key.match(/^schema:@Recipe:(.+)$/);
			if (schema) {
				const value = source.recipe[schema[1] as string];
				if (value == null) {
					return "";
				}
				return typeof value === "object" ? JSON.stringify(value) : String(value);
			}
			if (!(key in page)) {
				throw new Error(`Unknown template variable ${key}`);
			}
			return page[key] ?? "";
		});
	const lines = template.properties.map((property) => {
		const value = fill(property.value);
		if (!value.trim()) {
			return `${property.name}:`;
		}
		if (property.type === "number") {
			return `${property.name}: ${value}`;
		}
		const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
		return `${property.name}: "${escaped}"`;
	});
	return `---\n${lines.join("\n")}\n---\n${fill(template.noteContentFormat)}`;
}

/**
 * Parses the flat `key: value` YAML the clipper writes, and the JSON frontmatter
 * the test repository writes. Not a general YAML parser.
 */
export const clipYamlCodec: YamlCodec = {
	parse(yaml) {
		const trimmed = yaml.trim();
		if (trimmed.startsWith("{")) {
			return JSON.parse(trimmed);
		}
		const result: Record<string, unknown> = {};
		for (const line of trimmed.split("\n")) {
			const match = line.match(/^([A-Za-z][\w-]*):(?:\s(.*))?$/);
			if (!match) {
				throw new Error(`Unsupported YAML line: ${line}`);
			}
			const key = match[1] as string;
			const value = (match[2] ?? "").trim();
			if (!value) {
				result[key] = null;
			} else if (value.startsWith('"')) {
				result[key] = JSON.parse(value);
			} else if (/^-?\d+(?:\.\d+)?$/.test(value)) {
				result[key] = Number(value);
			} else {
				result[key] = value;
			}
		}
		return result;
	},
	stringify: (value) => JSON.stringify(value, null, 2),
};

function frontmatterOf(markdown: string): Record<string, unknown> | null {
	if (!markdown.startsWith("---\n")) {
		return null;
	}
	const end = markdown.indexOf("\n---", 3);
	if (end === -1) {
		return null;
	}
	try {
		return clipYamlCodec.parse(markdown.slice(4, end)) as Record<string, unknown>;
	} catch {
		return null;
	}
}

/** InMemoryVault whose frontmatter cache also reads clipper YAML, like Obsidian's metadataCache. */
export class ClipVault extends InMemoryVault {
	private readonly texts = new Map<string, string>();

	override async write(path: string, content: string): Promise<void> {
		this.texts.set(path, content);
		await super.write(path, content);
	}

	override async remove(path: string): Promise<void> {
		this.texts.delete(path);
		await super.remove(path);
	}

	override listMarkdown(folder: string): CachedFrontmatter[] {
		return [...this.texts.entries()]
			.filter(([path]) => path.startsWith(`${folder}/`) && path.endsWith(".md"))
			.map(([path, markdown]) => ({ path, frontmatter: frontmatterOf(markdown) }));
	}

	override readFrontmatter(path: string): Record<string, unknown> | null {
		const markdown = this.texts.get(path);
		return markdown == null ? null : frontmatterOf(markdown);
	}
}
