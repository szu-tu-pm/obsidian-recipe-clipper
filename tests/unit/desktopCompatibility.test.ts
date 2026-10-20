import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync("manifest.json", "utf8")) as {
	minAppVersion: string;
	isDesktopOnly: boolean;
};
const report = readFileSync("docs/eval-reports/desktop-compatibility.md", "utf8");
const ci = readFileSync(".github/workflows/ci.yml", "utf8");

const desktopRows = [
	"Windows 10 22H2 64-bit",
	"Windows 11 22H2 through 24H2",
	"macOS 14 Sonoma, Apple Silicon",
	"macOS 14 Sonoma, Intel",
	"macOS 15 Sequoia, Apple Silicon",
	"macOS 15 Sequoia, Intel",
	"macOS 16, Apple Silicon",
	"macOS 16, Intel",
];

describe("desktop compatibility", () => {
	it("keeps the plugin on desktop Obsidian 1.7.7 or newer", () => {
		expect(manifest.minAppVersion).toBe("1.7.7");
		expect(manifest.isDesktopOnly).toBe(true);
	});

	it("records Linux and mobile as out of scope and does not pass an OS that was not run", () => {
		for (const platform of desktopRows) {
			const row = report.split("\n").find((line) => line.startsWith(`| ${platform} |`));
			expect(row, platform).toBeDefined();
			expect(row).toContain("| Not run |");
			expect(row).not.toContain("| Pass |");
		}
		for (const platform of ["Linux", "Mobile"]) {
			const row = report.split("\n").find((line) => line.startsWith(`| ${platform} |`));
			expect(row, platform).toContain("| Out of scope |");
			expect(row).not.toContain("| Fail |");
		}
	});

	it("keeps CI on the build and the test suite rather than an Obsidian Linux run", () => {
		expect(ci).toContain("runs-on: ubuntu-latest");
		expect(ci).toContain("npm run build");
		expect(ci).toContain("npm run test:coverage");
		expect(report).toContain("It does not launch Obsidian");
	});
});
