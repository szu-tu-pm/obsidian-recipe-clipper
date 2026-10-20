import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		// Types-only package; tests that load plugin code mock it with `vi.mock("obsidian")`.
		alias: { obsidian: fileURLToPath(new URL("./tests/helpers/obsidianStub.ts", import.meta.url)) },
	},
	test: {
		// Vitest 3+ dropped `environmentMatchGlobs`; each environment is now a project.
		projects: [
			{
				extends: true,
				test: {
					name: "node",
					environment: "node",
					include: ["tests/**/*.test.ts"],
					exclude: ["tests/unit/extraction/**", "tests/evals/**"],
				},
			},
			{
				extends: true,
				test: {
					name: "jsdom",
					environment: "jsdom",
					include: ["tests/**/*.test.tsx", "tests/unit/extraction/**/*.test.ts", "tests/evals/**/*.test.ts"],
				},
			},
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
