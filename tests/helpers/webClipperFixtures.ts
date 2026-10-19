import { readFileSync } from "node:fs";
import { join } from "node:path";
import { splitFrontmatter, type YamlCodec } from "../../src/domain/schema/recipeMarkdown";
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
	"string-steps-object-author",
	"mixed-steps-image-objects",
] as const;

export type FixtureName = (typeof FIXTURE_NAMES)[number];

export function loadTemplate(path = TEMPLATE_PATH): WebClipperTemplate {
	return JSON.parse(readFileSync(path, "utf8")) as WebClipperTemplate;
}

/** The template as first shipped in 733b270: bare array keys that keep only the first item. */
export const LEGACY_TEMPLATE_PATH = join(FIXTURE_DIR, "legacy-bare-keys.web-clipper.json");

export function loadClip(name: FixtureName): string {
	return readFileSync(join(FIXTURE_DIR, `${name}.md`), "utf8").replace(/\r\n/g, "\n");
}

export function loadSource(name: FixtureName): ClipSource {
	return JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.source.json`), "utf8")) as ClipSource;
}

/**
 * How the renderer prints an object or array that reaches plain text with no
 * filter that accepts it. The documentation does not say, so every fixture is
 * checked under all three and the intake must not depend on which one is real.
 */
export type UndocumentedObjectText = "empty" | "json" | "object-string";
export const OBJECT_TEXT_MODES: UndocumentedObjectText[] = ["empty", "json", "object-string"];

/** Thrown for template syntax the Web Clipper documentation does not describe. */
export class UndocumentedSyntaxError extends Error {}

const NO_VALUE = Symbol("no value");
type Value = unknown | typeof NO_VALUE;

function objectText(value: unknown, mode: UndocumentedObjectText): string {
	if (value === NO_VALUE || value == null) {
		return "";
	}
	if (typeof value !== "object") {
		return String(value);
	}
	if (mode === "json") {
		return JSON.stringify(value);
	}
	return mode === "object-string" ? "[object Object]" : "";
}

interface PathSegment {
	key: string;
	index: number | "*" | null;
}

function parsePath(path: string): PathSegment[] {
	const segments = path.split(".").map((part) => {
		const match = part.match(/^(@?[A-Za-z][\w]*)(?:\[(\d+|\*)\])?$/);
		if (!match) {
			throw new UndocumentedSyntaxError(`Undocumented schema path segment "${part}"`);
		}
		const index = match[2] == null ? null : match[2] === "*" ? "*" : Number(match[2]);
		return { key: match[1] as string, index };
	});
	// Documented: key, parent.child, arrayKey[index].property, arrayKey[*].property.
	// One indexed segment at most; nested indexes are not described.
	if (segments.filter((segment) => segment.index !== null).length > 1) {
		throw new UndocumentedSyntaxError(`Nested array indexes are not documented: ${path}`);
	}
	return segments;
}

function lookup(value: Value, segments: PathSegment[]): Value {
	let current: Value = value;
	for (let i = 0; i < segments.length; i++) {
		const segment = segments[i] as PathSegment;
		// Assumption, checked by the person-run Chrome clip: a key read from a value
		// of the wrong shape (a property of a string, or of an array) has no value.
		if (current === NO_VALUE || current == null || typeof current !== "object" || Array.isArray(current)) {
			return NO_VALUE;
		}
		const next = (current as Record<string, unknown>)[segment.key];
		if (next === undefined || next === null) {
			return NO_VALUE;
		}
		if (segment.index === null) {
			current = next;
			continue;
		}
		if (!Array.isArray(next)) {
			return NO_VALUE;
		}
		if (segment.index === "*") {
			const rest = segments.slice(i + 1);
			return next.map((item) => (rest.length === 0 ? item : lookup(item, rest)));
		}
		current = next[segment.index] ?? NO_VALUE;
	}
	return current;
}

function parseFilterArg(raw: string | undefined): string | undefined {
	if (raw == null) {
		return undefined;
	}
	const quoted = raw.match(/^"(.*)"$/s);
	return (quoted ? (quoted[1] as string) : raw).replace(/\\n/g, "\n");
}

function applyFilter(
	value: Value,
	filter: string,
	mode: UndocumentedObjectText,
): Value {
	const match = filter.match(/^([a-z_]+)(?::(.*))?$/s);
	if (!match) {
		throw new UndocumentedSyntaxError(`Unreadable filter "${filter}"`);
	}
	const name = match[1] as string;
	const arg = parseFilterArg(match[2]);
	if (value === NO_VALUE) {
		return NO_VALUE;
	}
	if (name === "first") {
		// "Returns the first element of an array as a string. If the input is not an array, it returns the input unchanged."
		return Array.isArray(value) ? objectText(value[0], mode) : value;
	}
	if (name === "join" || name === "list") {
		if (!Array.isArray(value)) {
			throw new UndocumentedSyntaxError(`${name} on a value that is not an array is not documented`);
		}
		const items = value.map((item) => objectText(item, mode));
		if (name === "join") {
			// "Combines elements of an array into a string." join:"\n" separates with a line break.
			return items.join(arg ?? ",");
		}
		// "Converts an array to a Markdown list." list:numbered for a numbered list.
		if (arg !== undefined && arg !== "numbered") {
			throw new UndocumentedSyntaxError(`list:${arg} is not documented here`);
		}
		return items
			.map((item, index) => (arg === "numbered" ? `${index + 1}. ${item}` : `- ${item}`).trimEnd())
			.join("\n");
	}
	throw new UndocumentedSyntaxError(`Filter "${name}" is not part of this emulation`);
}

/**
 * A stand-in for the Obsidian Web Clipper renderer that implements only what
 * these pages document, and throws on anything else:
 * - https://obsidian.md/help/web-clipper/variables
 *   `{{schema:@Type:key}}` returns the key's value, `parent.child` a nested
 *   property, a bare `arrayKey` the first item, `arrayKey[index].property` the
 *   item at an index, and `arrayKey[*].property` that property from all items.
 * - https://obsidian.md/help/web-clipper/filters
 *   `join`, `list` / `list:numbered` and `first`, chained left to right.
 *
 * Assumptions the documentation does not settle, each named where it is used:
 * `arrayKey[*]` with no property gives all items; a value of the wrong shape
 * has no value; an object reaching plain text prints per `mode`; text
 * properties are written double-quoted with quotes and newlines escaped, and
 * empty ones are left blank. The person-run Chrome clip is the real check.
 */
export function renderTemplate(
	template: WebClipperTemplate,
	source: ClipSource,
	mode: UndocumentedObjectText = "empty",
): string {
	const page: Record<string, string> = {
		url: source.page.url,
		title: source.page.title,
		site: source.page.site,
		author: source.page.author,
		date: source.page.date,
	};
	const recipe = source.recipe;
	const hasRecipe = Object.keys(recipe).length > 0;
	const fill = (text: string): string =>
		text.replace(/\{\{(.+?)\}\}/g, (_match, expression: string) => {
			const [head, ...filters] = expression.split("|").map((part) => part.trim());
			const key = head as string;
			let value: Value;
			let bare = false;
			const schema = key.match(/^schema:@Recipe:(.+)$/);
			if (schema) {
				const segments = parsePath(schema[1] as string);
				value = hasRecipe ? lookup(recipe, segments) : NO_VALUE;
				bare = segments.every((segment) => segment.index === null);
			} else if (key in page) {
				value = page[key] ? page[key] : NO_VALUE;
			} else {
				throw new UndocumentedSyntaxError(`Unknown template variable ${key}`);
			}
			// "{{schema:@Type:arrayKey}} returns the first item in an array."
			if (bare && Array.isArray(value)) {
				value = value.length > 0 ? value[0] : NO_VALUE;
			}
			for (const filter of filters) {
				value = applyFilter(value, filter, mode);
			}
			// An object, or an unfiltered [*] array, printed as text is not documented: see `mode`.
			return objectText(value, mode);
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
	const { yaml } = splitFrontmatter(markdown);
	if (!yaml) {
		return null;
	}
	try {
		return clipYamlCodec.parse(yaml) as Record<string, unknown>;
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
