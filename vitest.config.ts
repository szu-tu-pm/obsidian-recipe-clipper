import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
		environmentMatchGlobs: [["**/*.test.tsx", "jsdom"]],
		coverage: {
			include: ["src/domain/aggregation/stage1LexicalParser.ts"],
			branches: 90,
		},
	},
});
