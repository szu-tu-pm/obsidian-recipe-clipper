import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderMarkdown, runEvaluation, type EvaluationReport } from "./runner";

const PROJECT_ROOT = process.cwd();
export const HELD_OUT_ROOT = resolve(PROJECT_ROOT, "tests/evals/held-out");
const REPORT_ROOT = resolve(PROJECT_ROOT, "docs/eval-reports");

export function renderHeldOutMarkdown(report: EvaluationReport, coverageNote: string): string {
	return `${renderMarkdown(report, "Held-Out v1 Evaluation Report")}
## Coverage

The held-out script does not remeasure coverage. \`npm run test:coverage\` enforces the thresholds in \`vitest.config.mts\`: 80% lines, statements, functions, and branches overall, and 90% for those four metrics under \`src/domain/aggregation\` and \`src/domain/extraction\`. CI runs that command on every pull request.

${coverageNote}

## What this corpus leaves out

This run does not call Ollama. Tier 2 pages are DOM recipe cards only. The Loom walkthrough is recorded by a person against a vault that contains only these public fixtures.

If \`workingTreeDirty\` is \`true\`, this file was written before the code commit. Regenerate it on that clean commit before treating the recorded SHA as the baseline.
`;
}

export async function runHeldOutEvaluation(): Promise<EvaluationReport> {
	return runEvaluation({ fixtureRoot: HELD_OUT_ROOT });
}

function coverageNoteFromSummary(): string {
	const summaryPath = resolve(PROJECT_ROOT, "coverage/coverage-summary.json");
	try {
		const summary = JSON.parse(readFileSync(summaryPath, "utf8")) as {
			total: CoverageCounts;
			[path: string]: CoverageCounts;
		};
		const total = summary.total;
		const aggregation = findCoverage(summary, "src/domain/aggregation");
		const extraction = findCoverage(summary, "src/domain/extraction");
		if (!aggregation || !extraction) {
			return "A coverage summary was present, but it did not include the aggregation and extraction scopes.";
		}
		return [
			"| Scope | Lines | Statements | Functions | Branches | Threshold | Result |",
			"| --- | ---: | ---: | ---: | ---: | ---: | :---: |",
			coverageRow("Overall", total, 80),
			coverageRow("src/domain/aggregation", aggregation, 90),
			coverageRow("src/domain/extraction", extraction, 90),
		].join("\n");
	} catch {
		return "No `coverage/coverage-summary.json` was present when this report was written. Run `npm run test:coverage` and regenerate the report to fill the measured rates.";
	}
}

interface CoverageMetric {
	total: number;
	covered: number;
	pct: number;
}

interface CoverageCounts {
	lines: CoverageMetric;
	statements: CoverageMetric;
	functions: CoverageMetric;
	branches: CoverageMetric;
}

function findCoverage(
	summary: Record<string, CoverageCounts>,
	prefix: string,
): CoverageCounts | null {
	const rows = Object.entries(summary).filter(([filePath]) => filePath.replace(/\\/g, "/").includes(`${prefix}/`));
	if (rows.length === 0) {
		return null;
	}
	return {
		lines: sumMetric(rows, "lines"),
		statements: sumMetric(rows, "statements"),
		functions: sumMetric(rows, "functions"),
		branches: sumMetric(rows, "branches"),
	};
}

function sumMetric(
	rows: Array<[string, CoverageCounts]>,
	key: keyof CoverageCounts,
): CoverageMetric {
	const total = rows.reduce((sum, [, row]) => sum + row[key].total, 0);
	const covered = rows.reduce((sum, [, row]) => sum + row[key].covered, 0);
	return { total, covered, pct: total === 0 ? 0 : (covered / total) * 100 };
}

function coverageRow(scope: string, counts: CoverageCounts, threshold: number): string {
	const rates = [counts.lines.pct, counts.statements.pct, counts.functions.pct, counts.branches.pct];
	const passed = rates.every((rate) => rate >= threshold);
	return `| ${scope} | ${rates[0].toFixed(1)}% | ${rates[1].toFixed(1)}% | ${rates[2].toFixed(1)}% | ${rates[3].toFixed(1)}% | ${threshold}% | ${passed ? "PASS" : "FAIL"} |`;
}

async function main(): Promise<void> {
	const report = await runHeldOutEvaluation();
	mkdirSync(REPORT_ROOT, { recursive: true });
	writeFileSync(resolve(REPORT_ROOT, "held-out-v1-report.md"), renderHeldOutMarkdown(report, coverageNoteFromSummary()));
	writeFileSync(resolve(REPORT_ROOT, "held-out-v1-report.json"), `${JSON.stringify(report, null, "\t")}\n`);
	if (!report.passed) {
		process.exitCode = 1;
	}
}

if (
	process.argv
		.slice(1)
		.some((argument) => argument.replace(/\\/g, "/").endsWith("tests/evals/heldOut.ts"))
) {
	void main();
}
