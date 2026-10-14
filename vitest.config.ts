import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["tests/**/*.test.ts"],
		coverage: {
			include: ["src/domain/aggregation/stage1LexicalParser.ts"],
			branches: 90,
		},
	},
});
