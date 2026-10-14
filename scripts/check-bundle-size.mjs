import { statSync } from "fs";

const MAX_BYTES = 500 * 1024;
const path = "main.js";
const { size } = statSync(path);

if (size >= MAX_BYTES) {
	console.error(
		`${path} is ${(size / 1024).toFixed(1)} KB, which exceeds the 500 KB uncompressed budget.`,
	);
	process.exit(1);
}

console.log(`${path}: ${(size / 1024).toFixed(1)} KB (limit 500 KB)`);
