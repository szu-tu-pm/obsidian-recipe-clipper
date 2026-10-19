// Render a review verdict (scripts/agents/review-schema.json) as a PR comment.
//
//   node scripts/agents/render-review.mjs <review.json> "<round>" "<reviewer>" [note]  >  comment.md
import { readFileSync } from "node:fs";

const [file, round, reviewer, note] = process.argv.slice(2);
const review = JSON.parse(readFileSync(file, "utf8"));
const verdict = review.verdict === "approve" ? "approve" : "request changes";

const lines = [`## Cross-review round ${round} (${reviewer}) — ${verdict}`, "", review.summary, ""];

if (review.unmet_criteria.length) {
	lines.push("**Unmet criteria**", ...review.unmet_criteria.map((c) => `- ${c}`), "");
}

for (const severity of ["blocker", "major", "minor"]) {
	const found = review.findings.filter((f) => f.severity === severity);
	if (!found.length) continue;
	lines.push(`**${severity[0].toUpperCase()}${severity.slice(1)}**`);
	for (const f of found) {
		const where = f.line ? `${f.file}:${f.line}` : f.file;
		lines.push(`- \`${where}\` — ${f.issue}`, `  - Fix: ${f.fix}`);
	}
	lines.push("");
}

if (note) lines.push(note);
process.stdout.write(lines.join("\n").trimEnd() + "\n");
