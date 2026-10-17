import { splitFrontmatter, wrapMarkdown, type YamlCodec } from "./recipeMarkdown";
import {
	AVAILABILITY_LABELS,
	formatMeasure,
	formatQuantity,
	parseShoppingListFrontmatter,
	type ShoppingListDocument,
	type ShoppingListFrontmatter,
} from "./shoppingListSchema";

export function serializeShoppingListBody(list: ShoppingListDocument): string {
	const lines: string[] = [`# ${list.frontmatter.title}`, "## Items"];
	if (list.frontmatter.items.length === 0) {
		lines.push("_No items yet._");
	}
	for (const item of list.frontmatter.items) {
		lines.push(`### ${item.name}`);
		lines.push(`- Availability: ${AVAILABILITY_LABELS[item.status]}`);
		lines.push(
			`- Required: ${formatMeasure(item.requiredQuantity, item.requiredQuantityMax, item.requiredUnit)}`,
		);
		if (item.remainingQuantity != null) {
			const unit = item.requiredUnit ? ` ${item.requiredUnit}` : "";
			lines.push(`- Remaining: ${formatQuantity(item.remainingQuantity)}${unit}`);
		} else if (item.ownedQuantity != null) {
			lines.push(`- On hand: ${formatMeasure(item.ownedQuantity, null, item.ownedUnit)}`);
		}
		const sources = item.sourceRefs.map((ref) => ref.recipeTitle || ref.recipeId);
		lines.push(`- Sources: ${sources.length > 0 ? sources.join(", ") : "Manual item"}`);
		lines.push(`- Merge: ${item.mergeRuleId} — ${item.mergeReason}`);
	}
	return `${lines.join("\n\n")}\n`;
}

export function serializeShoppingListFile(
	list: ShoppingListDocument,
	yaml: YamlCodec,
): string {
	const body = serializeShoppingListBody(list);
	const yamlText = yaml.stringify(
		JSON.parse(JSON.stringify(list.frontmatter)) as Record<string, unknown>,
	);
	return wrapMarkdown(yamlText, body);
}

export function parseShoppingListFile(
	markdown: string,
	yaml: YamlCodec,
	path?: string,
): ShoppingListDocument {
	const { yaml: yamlText } = splitFrontmatter(markdown);
	if (!yamlText) {
		throw new Error("Shopping list file is missing YAML frontmatter.");
	}
	const frontmatter: ShoppingListFrontmatter = parseShoppingListFrontmatter(yaml.parse(yamlText));
	return { frontmatter, path };
}
