import { parseIngredientLine } from "../aggregation/stage1LexicalParser";
import {
	computeBodyHash,
	parseRecipeFrontmatter,
	type RecipeDocument,
	type RecipeFrontmatter,
} from "./recipeSchema";

export interface YamlCodec {
	parse(yaml: string): unknown;
	stringify(value: Record<string, unknown>): string;
}

const SOURCE_LINE =
	/^>\s*Source:\s*\[([^\]]*)\]\(([^)]*)\)(?:\s+by\s+(.*))?$/i;
const WIKI_IMAGE = /^!\[\[([^\]]+)\]\]$/;
const MD_IMAGE = /^!\[(.*?)\]\((.*?)\)$/;

export function splitFrontmatter(markdown: string): { yaml: string; body: string } {
	const normalized = markdown.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
	if (!normalized.startsWith("---\n") && normalized !== "---") {
		return { yaml: "", body: normalized.trimStart() };
	}
	const end = normalized.indexOf("\n---", 3);
	if (end === -1) {
		return { yaml: "", body: normalized };
	}
	const yaml = normalized.slice(4, end).trim();
	let body = normalized.slice(end + 4);
	if (body.startsWith("\n")) {
		body = body.slice(1);
	}
	return { yaml, body };
}

export function wrapMarkdown(yaml: string, body: string): string {
	const trimmedYaml = yaml.trimEnd();
	const trimmedBody = body.replace(/^\n+/, "").replace(/\s+$/, "");
	return `---\n${trimmedYaml}\n---\n\n${trimmedBody}\n`;
}

export function serializeRecipeBody(recipe: RecipeDocument): string {
	const { frontmatter, instructions, notes } = recipe;
	const lines: string[] = [`# ${frontmatter.title}`];

	if (frontmatter.sourceUrl || frontmatter.siteName || frontmatter.author) {
		const site = frontmatter.siteName || "Source";
		const url = frontmatter.sourceUrl || "";
		const author = frontmatter.author || "Unknown";
		lines.push(`> Source: [${site}](${url}) by ${author}`);
	}

	const primary =
		frontmatter.images.find((image) => image.isPrimary) ?? frontmatter.images[0];
	if (primary) {
		lines.push(`![[${primary.path}]]`);
	}

	lines.push("## Ingredients");
	if (frontmatter.ingredients.length === 0) {
		lines.push("_No ingredients yet._");
	} else {
		for (const ingredient of frontmatter.ingredients) {
			lines.push(`- ${ingredient.raw}`);
		}
	}

	lines.push("## Instructions");
	if (instructions.length === 0) {
		lines.push("_No instructions yet._");
	} else {
		instructions.forEach((step, index) => {
			lines.push(`${index + 1}. ${step}`);
		});
	}

	lines.push("## Notes");
	lines.push(notes.trim() || "_No notes yet._");

	return `${lines.join("\n\n")}\n`;
}

export function serializeRecipeFile(recipe: RecipeDocument, yaml: YamlCodec): string {
	const body = serializeRecipeBody(recipe);
	const { bodyHash: _ignored, ...rest } = recipe.frontmatter;
	const images = recipe.frontmatter.images.map((image, index) => ({
		...image,
		isPrimary: index === 0,
	}));
	const hash = computeBodyHash({ ...rest, images }, body);
	const frontmatter: RecipeFrontmatter = {
		...recipe.frontmatter,
		images,
		bodyHash: hash,
	};
	const yamlText = yaml.stringify(
		JSON.parse(JSON.stringify(frontmatter)) as Record<string, unknown>,
	);
	return wrapMarkdown(yamlText, body);
}

export function parseRecipeBody(body: string): {
	title: string | null;
	sourceUrl: string | null;
	siteName: string | null;
	author: string | null;
	primaryImagePath: string | null;
	ingredientLines: string[];
	instructions: string[];
	notes: string;
} {
	const lines = body.replace(/\r\n/g, "\n").split("\n");
	let title: string | null = null;
	let sourceUrl: string | null = null;
	let siteName: string | null = null;
	let author: string | null = null;
	let primaryImagePath: string | null = null;
	let section: "none" | "ingredients" | "instructions" | "notes" = "none";
	const ingredientLines: string[] = [];
	const instructions: string[] = [];
	const notes: string[] = [];

	for (const rawLine of lines) {
		const line = rawLine.trimEnd();
		const trimmed = line.trim();
		if (!title && trimmed.startsWith("# ")) {
			title = trimmed.slice(2).trim();
			continue;
		}
		const source = trimmed.match(SOURCE_LINE);
		if (source) {
			siteName = source[1]?.trim() || null;
			sourceUrl = source[2]?.trim() || null;
			author = source[3]?.trim() || null;
			continue;
		}
		const wiki = trimmed.match(WIKI_IMAGE);
		if (wiki && !primaryImagePath) {
			primaryImagePath = wiki[1]?.trim() || null;
			continue;
		}
		const mdImage = trimmed.match(MD_IMAGE);
		if (mdImage && !primaryImagePath) {
			primaryImagePath = mdImage[2]?.trim() || null;
			continue;
		}
		if (/^##\s+ingredients\s*$/i.test(trimmed)) {
			section = "ingredients";
			continue;
		}
		if (/^##\s+instructions\s*$/i.test(trimmed)) {
			section = "instructions";
			continue;
		}
		if (/^##\s+notes\s*$/i.test(trimmed)) {
			section = "notes";
			continue;
		}
		if (!trimmed) {
			continue;
		}
		if (section === "ingredients") {
			if (trimmed.startsWith("_") && trimmed.endsWith("_")) {
				continue;
			}
			ingredientLines.push(trimmed.replace(/^\s*[-*+]\s+/, "").replace(/^\d+\.\s+/, ""));
		} else if (section === "instructions") {
			if (trimmed.startsWith("_") && trimmed.endsWith("_")) {
				continue;
			}
			instructions.push(trimmed.replace(/^\d+\.\s+/, ""));
		} else if (section === "notes") {
			if (trimmed === "_No notes yet._") {
				continue;
			}
			notes.push(line);
		}
	}

	return {
		title,
		sourceUrl,
		siteName,
		author,
		primaryImagePath,
		ingredientLines,
		instructions,
		notes: notes.join("\n").trim(),
	};
}

export function parseRecipeFile(
	markdown: string,
	yaml: YamlCodec,
	path?: string,
): RecipeDocument {
	const { yaml: yamlText, body } = splitFrontmatter(markdown);
	if (!yamlText) {
		throw new Error("Recipe file is missing YAML frontmatter.");
	}
	const parsedYaml = yaml.parse(yamlText);
	const frontmatter = parseRecipeFrontmatter(parsedYaml);
	const parsedBody = parseRecipeBody(body);
	const { bodyHash, ...rest } = frontmatter;
	const currentHash = computeBodyHash(rest, body);
	const editedExternally = Boolean(bodyHash) && bodyHash !== currentHash;

	if (!editedExternally) {
		return {
			frontmatter,
			instructions: parsedBody.instructions,
			notes: parsedBody.notes,
			path,
			editedExternally: false,
		};
	}

	const merged: RecipeFrontmatter = {
		...frontmatter,
		title: parsedBody.title || frontmatter.title,
		sourceUrl: parsedBody.sourceUrl ?? frontmatter.sourceUrl,
		siteName: parsedBody.siteName ?? frontmatter.siteName,
		author: parsedBody.author ?? frontmatter.author,
		ingredients:
			parsedBody.ingredientLines.length > 0
				? parsedBody.ingredientLines.map(parseIngredientLine)
				: frontmatter.ingredients,
		updatedAt: new Date().toISOString(),
	};

	return {
		frontmatter: merged,
		instructions:
			parsedBody.instructions.length > 0 ? parsedBody.instructions : [],
		notes: parsedBody.notes,
		path,
		editedExternally: true,
	};
}
