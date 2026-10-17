import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
		environmentMatchGlobs: [
			["**/*.test.tsx", "jsdom"],
			["tests/unit/extraction/**/*.test.ts", "jsdom"],
			["tests/evals/**/*.test.ts", "jsdom"],
		],
		coverage: {
			include: [
				"src/domain/aggregation/**/*.ts",
				"src/domain/extraction/**/*.ts",
			],
			thresholds: {
				lines: 80,
				statements: 80,
				functions: 80,
				branches: 90,
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
