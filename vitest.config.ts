import { defineConfig } from "vitest/config";

export default defineConfig({
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
