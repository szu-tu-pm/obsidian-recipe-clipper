import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		// Types-only package; tests that load plugin code mock it with `vi.mock("obsidian")`.
		alias: { obsidian: fileURLToPath(new URL("./tests/helpers/obsidianStub.ts", import.meta.url)) },
	},
	test: {
		environment: "node",
		include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
		environmentMatchGlobs: [
			["**/*.test.tsx", "jsdom"],
			["tests/unit/extraction/**/*.test.ts", "jsdom"],
			["tests/evals/**/*.test.ts", "jsdom"],
		],
		coverage: {
			include: ["src/**/*.{ts,tsx}"],
			exclude: [
				"src/main.ts", // Obsidian Plugin lifecycle requires the desktop runtime.
				"src/settings.ts", // Obsidian settings controls require the desktop runtime.
				"src/wrapper/RecipeItemView.ts", // ItemView and WorkspaceLeaf require Obsidian APIs.
				"src/wrapper/RecipeViewRoot.tsx", // Notice is only available in the Obsidian runtime.
			],
			thresholds: {
				lines: 80,
				statements: 80,
				functions: 80,
				branches: 80,
				"src/domain/aggregation/**": {
					lines: 90,
					statements: 90,
					functions: 90,
					branches: 90,
				},
				"src/domain/extraction/**": {
					lines: 90,
					statements: 90,
					functions: 90,
					branches: 90,
				},
			},
		},
	},
});
