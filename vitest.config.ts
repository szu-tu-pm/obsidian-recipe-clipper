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
		],
		coverage: {
			include: ["src/domain/aggregation/**/*.ts"],
			branches: 90,
		},
	},
});
