import { createManualRecipe } from "../schema/recipeSchema";
import type { UrlExtractionFallback, UrlExtractionResult } from "./types";

export type ImportActivity = "fetching" | "extracting";

export type ImportSessionPhase = ImportActivity | "ready" | "failed" | "cancelled";

export interface ImportSessionSnapshot {
	phase: ImportSessionPhase;
	url: string;
	message: string;
	result: UrlExtractionResult | null;
}

export interface ImportSession {
	snapshot(): ImportSessionSnapshot;
	cancel(): void;
	done: Promise<ImportSessionSnapshot>;
	subscribe(listener: () => void): () => void;
}

const ACTIVITY_MESSAGE: Record<ImportActivity, string> = {
	fetching: "Fetching the page…",
	extracting: "Reading the recipe…",
};

export function startImportSession(options: {
	url: string;
	run: (
		report: (phase: ImportActivity) => void,
		signal: AbortSignal,
	) => Promise<UrlExtractionResult>;
	now?: () => string;
}): ImportSession {
	const controller = new AbortController();
	const listeners = new Set<() => void>();
	let snapshot: ImportSessionSnapshot = {
		phase: "fetching",
		url: options.url,
		message: ACTIVITY_MESSAGE.fetching,
		result: null,
	};

	function publish(next: ImportSessionSnapshot): void {
		snapshot = next;
		for (const listener of listeners) {
			listener();
		}
	}

	function report(phase: ImportActivity): void {
		if (controller.signal.aborted) {
			return;
		}
		publish({
			phase,
			url: options.url,
			message: ACTIVITY_MESSAGE[phase],
			result: null,
		});
	}

	const done = new Promise<ImportSessionSnapshot>((resolve) => {
		queueMicrotask(() => {
			void finish(resolve);
		});
	});

	async function finish(resolve: (value: ImportSessionSnapshot) => void): Promise<void> {
		try {
			const result = await options.run(report, controller.signal);
			if (
				controller.signal.aborted ||
				(result.status === "manual-fallback" && result.reason === "cancelled")
			) {
				publish(cancelled(options.url));
			} else if (result.status === "manual-fallback") {
				publish({
					phase: "failed",
					url: options.url,
					message: fallbackMessage(result),
					result,
				});
			} else {
				publish({
					phase: "ready",
					url: options.url,
					message: "Review the import before saving.",
					result,
				});
			}
		} catch (error) {
			if (controller.signal.aborted || isAbortError(error)) {
				publish(cancelled(options.url));
			} else {
				const detail = error instanceof Error ? error.message : "The page could not be retrieved.";
				const message = `The page could not be retrieved (${detail}). The URL is kept so you can enter the recipe manually.`;
				publish({
					phase: "failed",
					url: options.url,
					message,
					result: inaccessibleImport(
						options.url,
						message,
						options.now?.() ?? new Date().toISOString(),
					),
				});
			}
		}
		resolve(snapshot);
	}

	return {
		snapshot: () => snapshot,
		cancel: () => {
			controller.abort();
		},
		done,
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

export function inaccessibleImport(
	url: string,
	message: string,
	now: string,
): UrlExtractionFallback {
	const draft = createManualRecipe("Untitled recipe");
	return {
		status: "manual-fallback",
		succeeded: false,
		reason: "inaccessible",
		draft: {
			...draft,
			frontmatter: {
				...draft.frontmatter,
				sourceUrl: url,
				importedAt: now,
				updatedAt: now,
				extractionMethod: "manual",
				ingredients: [],
			},
		},
		attribution: { sourceUrl: url, author: null, siteName: null },
		duplicates: [],
		warnings: [message],
	};
}

function cancelled(url: string): ImportSessionSnapshot {
	return {
		phase: "cancelled",
		url,
		message: "Import cancelled.",
		result: null,
	};
}

function fallbackMessage(result: UrlExtractionFallback): string {
	const ollama = result.warnings.find((warning) => warning.startsWith("Local Ollama"));
	if (ollama) {
		return `${ollama} The URL is kept so you can enter the recipe manually.`;
	}
	return `This import did not succeed (${result.reason}). The URL is kept so you can enter the recipe manually.`;
}

function isAbortError(error: unknown): boolean {
	return (
		(error instanceof DOMException && error.name === "AbortError") ||
		(error instanceof Error && error.name === "AbortError")
	);
}
