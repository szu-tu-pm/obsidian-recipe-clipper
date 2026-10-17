import { useEffect, useId, useRef, useState } from "react";
import type { RecipeDocument } from "../domain/schema/recipeSchema";
import {
	applyTranslation,
	revertTranslation,
	TRANSLATION_LANGUAGES,
	translateWithOllama,
	translationBase,
	type TranslationLanguage,
	type TranslationText,
} from "../domain/translation/recipeTranslator";
import type { PluginServices } from "../wrapper/PluginServiceAdapter";
import { useEscapeToClose } from "./useEscapeToClose";

type Phase = "choose" | "translating" | "review" | "saving";

function SideBySide({
	label,
	original,
	translated,
}: {
	label: string;
	original: string;
	translated: string;
}): JSX.Element {
	return (
		<tr>
			<th scope="row">{label}</th>
			<td>{original}</td>
			<td>{translated}</td>
		</tr>
	);
}

/**
 * Translate a saved recipe with local Ollama. The result is shown next to the original
 * and nothing is written to the vault until the user accepts it.
 */
export function TranslateRecipeModal({
	services,
	recipe,
	onClose,
	fetchImpl,
}: {
	services: PluginServices;
	recipe: RecipeDocument;
	onClose: (notice?: string) => void;
	fetchImpl?: typeof fetch;
}): JSX.Element {
	const headingId = useId();
	const [language, setLanguage] = useState<TranslationLanguage>(
		TRANSLATION_LANGUAGES.find((item) => item !== recipe.frontmatter.translation?.language) ??
			TRANSLATION_LANGUAGES[0],
	);
	const [phase, setPhase] = useState<Phase>("choose");
	const [source, setSource] = useState<TranslationText>(() => translationBase(recipe).source);
	const [translation, setTranslation] = useState<TranslationText | null>(null);
	const [warnings, setWarnings] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	const controller = useRef<AbortController | null>(null);

	useEffect(() => {
		return () => controller.current?.abort();
	}, []);

	function close(notice?: string): void {
		controller.current?.abort();
		onClose(notice);
	}

	useEscapeToClose(() => close(), phase !== "saving");

	async function translate(): Promise<void> {
		const base = translationBase(recipe).source;
		setSource(base);
		setTranslation(null);
		setWarnings([]);
		setError(null);
		setPhase("translating");
		const abort = new AbortController();
		controller.current = abort;
		const settings = services.getSettings();
		const outcome = await translateWithOllama(base, language, {
			endpoint: settings.ollamaEndpoint,
			model: settings.ollamaModel,
			healthCheckMs: settings.ollamaHealthCheckMs,
			timeoutMs: settings.ollamaTimeoutMs,
			fetchImpl,
			signal: abort.signal,
		});
		if (controller.current !== abort) {
			return;
		}
		controller.current = null;
		if (outcome.status === "ready") {
			setTranslation(outcome.translation);
			setPhase("review");
			return;
		}
		setWarnings(outcome.warnings);
		setError(
			outcome.status === "cancelled"
				? "Translation cancelled. The recipe was not changed."
				: "Translation failed. The recipe was not changed.",
		);
		setPhase("choose");
	}

	function cancelTranslation(): void {
		controller.current?.abort();
	}

	/** Re-read the recipe so an accept never overwrites edits made while translating. */
	async function freshRecipe(): Promise<RecipeDocument | null> {
		const loaded = await services.loadRecipe(recipe.frontmatter.id);
		if (!loaded.ok) {
			setError(loaded.message);
			return null;
		}
		if (loaded.recipe.frontmatter.updatedAt !== recipe.frontmatter.updatedAt) {
			setError("The recipe changed while this dialog was open. Close it and try again.");
			return null;
		}
		return loaded.recipe;
	}

	async function save(build: (current: RecipeDocument) => RecipeDocument, notice: string) {
		setPhase("saving");
		setError(null);
		try {
			const current = await freshRecipe();
			if (!current) {
				return;
			}
			let next: RecipeDocument;
			try {
				next = build(current);
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : "Translation rejected.");
				return;
			}
			const saved = await services.saveRecipe(next);
			if (!saved) {
				setError("Could not save the recipe.");
				return;
			}
			onClose(notice);
		} finally {
			setPhase((value) => (value === "saving" ? (translation ? "review" : "choose") : value));
		}
	}

	function accept(): void {
		if (!translation) {
			return;
		}
		void save(
			(current) => applyTranslation(current, translation, language),
			`Recipe translated to ${language}. The original text is kept and can be restored.`,
		);
	}

	function discard(): void {
		setTranslation(null);
		setWarnings([]);
		setPhase("choose");
	}

	function revert(): void {
		void save((current) => revertTranslation(current), "Original recipe text restored.");
	}

	const translatedFrom = recipe.frontmatter.translation;
	const busy = phase === "translating" || phase === "saving";

	return (
		<div className="recipe-clipper-modal-backdrop" role="presentation">
			<div
				className="recipe-clipper-modal recipe-clipper-modal-wide recipe-clipper-translate"
				role="dialog"
				aria-modal="true"
				aria-labelledby={headingId}
			>
				<h3 id={headingId}>Translate recipe</h3>
				<p>
					Uses your local Ollama model. Numbers and units must stay exactly as written, and
					nothing is saved until you accept the translation.
				</p>
				{translatedFrom ? (
					<p role="status">
						Currently translated to {translatedFrom.language}. The original text is kept.
					</p>
				) : null}
				<label>
					Target language
					<select
						value={language}
						disabled={busy || phase === "review"}
						onChange={(event) => setLanguage(event.target.value as TranslationLanguage)}
					>
						{TRANSLATION_LANGUAGES.map((item) => (
							<option key={item} value={item}>
								{item}
							</option>
						))}
					</select>
				</label>
				{phase === "translating" ? <p role="status">Translating with local Ollama…</p> : null}
				{error ? (
					<p className="recipe-clipper-error" role="alert">
						{error}
					</p>
				) : null}
				{warnings.length > 0 ? (
					<ul className="recipe-clipper-review-warnings">
						{warnings.map((warning, index) => (
							<li key={`${warning}-${index}`}>{warning}</li>
						))}
					</ul>
				) : null}
				{translation ? (
					<table className="recipe-clipper-translation-table">
						<caption>Review the translation</caption>
						<thead>
							<tr>
								<th scope="col">Part</th>
								<th scope="col">Original</th>
								<th scope="col">{language}</th>
							</tr>
						</thead>
						<tbody>
							<SideBySide label="Title" original={source.title} translated={translation.title} />
							{source.ingredients.map((line, index) => (
								<SideBySide
									key={`ingredient-${index}`}
									label={`Ingredient ${index + 1}`}
									original={line}
									translated={translation.ingredients[index]}
								/>
							))}
							{source.instructions.map((line, index) => (
								<SideBySide
									key={`step-${index}`}
									label={`Step ${index + 1}`}
									original={line}
									translated={translation.instructions[index]}
								/>
							))}
						</tbody>
					</table>
				) : null}
				<div className="recipe-clipper-modal-actions">
					{phase === "translating" ? (
						<button type="button" onClick={cancelTranslation}>
							Cancel translation
						</button>
					) : (
						<button type="button" onClick={() => close()} disabled={busy}>
							Close
						</button>
					)}
					{translatedFrom && phase === "choose" ? (
						<button type="button" onClick={revert}>
							Restore original
						</button>
					) : null}
					{phase === "review" || (phase === "saving" && translation) ? (
						<>
							<button type="button" onClick={discard} disabled={busy}>
								Discard
							</button>
							<button type="button" className="mod-cta" onClick={accept} disabled={busy}>
								Accept translation
							</button>
						</>
					) : (
						<button
							type="button"
							className="mod-cta"
							onClick={() => void translate()}
							disabled={busy}
						>
							Translate
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
