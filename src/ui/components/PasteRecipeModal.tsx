import { useEffect, useId, useRef, useState } from "react";
import {
	assistantNameForLink,
	extractPastedRecipe,
	extractPastedRecipeWithModel,
	type PastedRecipeInput,
} from "../../domain/extraction/pastedTextExtractor";
import type { UrlExtractionSuccess } from "../../domain/extraction/types";
import type { PluginServices } from "../../wrapper/PluginServiceAdapter";
import { useEscapeToClose } from "../useEscapeToClose";

/**
 * Paste recipe text from an AI chat, an email, a message or a note. The text is parsed on this
 * computer; the result opens in the review screen and nothing is written until the user saves.
 */
export function PasteRecipeModal({
	services,
	onCancel,
	onParsed,
	fetchImpl,
}: {
	services: PluginServices;
	onCancel: () => void;
	onParsed: (result: UrlExtractionSuccess) => void;
	/** Used only for the optional local Ollama model. */
	fetchImpl?: typeof fetch;
}): JSX.Element {
	const headingId = useId();
	const [text, setText] = useState("");
	const [link, setLink] = useState("");
	const [aiWritten, setAiWritten] = useState(false);
	const [assistant, setAssistant] = useState("");
	const [askModel, setAskModel] = useState(false);
	const [busy, setBusy] = useState(false);
	const nameEdited = useRef(false);
	const controller = useRef<AbortController | null>(null);

	useEscapeToClose(cancel);

	useEffect(() => {
		return () => controller.current?.abort();
	}, []);

	function changeLink(value: string): void {
		setLink(value);
		const known = assistantNameForLink(value);
		if (known && !nameEdited.current) {
			setAssistant(known);
		}
	}

	function cancel(): void {
		controller.current?.abort();
		onCancel();
	}

	async function submit(): Promise<void> {
		if (busy || !text.trim()) {
			return;
		}
		const input: PastedRecipeInput = {
			text,
			sourceLink: link,
			generatedBy: aiWritten ? assistant.trim() || "AI assistant" : null,
			existingRecipes: services.listRecipes().map((recipe) => ({
				id: recipe.id,
				sourceUrl: recipe.sourceUrl,
				path: recipe.path,
			})),
		};
		if (!askModel) {
			onParsed(extractPastedRecipe(input));
			return;
		}
		const settings = services.getSettings();
		const abort = new AbortController();
		controller.current = abort;
		setBusy(true);
		try {
			const { result, cancelled } = await extractPastedRecipeWithModel(input, {
				endpoint: settings.ollamaEndpoint,
				model: settings.ollamaModel,
				lightweightModel: settings.ollamaLightweightModel,
				healthCheckMs: settings.ollamaHealthCheckMs,
				timeoutMs: settings.ollamaTimeoutMs,
				fetchImpl,
				signal: abort.signal,
			});
			if (!cancelled && !abort.signal.aborted) {
				onParsed(result);
			}
		} finally {
			controller.current = null;
			setBusy(false);
		}
	}

	return (
		<div className="recipe-clipper-modal-backdrop" role="presentation">
			<div
				className="recipe-clipper-modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby={headingId}
			>
				<h3 id={headingId}>Paste recipe</h3>
				<p>
					Paste a recipe from an AI chat, an email, a message or a note. It is read on this
					computer and shown for review. Nothing is saved until you confirm.
				</p>
				<form
					noValidate
					className="recipe-clipper-editor-form"
					onSubmit={(event) => {
						event.preventDefault();
						void submit();
					}}
				>
					<label>
						Recipe text
						<textarea
							rows={12}
							autoFocus
							value={text}
							onChange={(event) => setText(event.target.value)}
						/>
					</label>
					<label>
						Source link (optional)
						<input
							type="text"
							value={link}
							onChange={(event) => changeLink(event.target.value)}
						/>
					</label>
					<label>
						<input
							type="checkbox"
							checked={aiWritten}
							onChange={(event) => setAiWritten(event.target.checked)}
						/>
						Written by an AI assistant
					</label>
					<label>
						Assistant name
						<input
							type="text"
							value={assistant}
							onChange={(event) => {
								nameEdited.current = true;
								setAssistant(event.target.value);
							}}
						/>
					</label>
					<label>
						<input
							type="checkbox"
							checked={askModel}
							onChange={(event) => setAskModel(event.target.checked)}
						/>
						If there is no Ingredients or Instructions section, ask my local Ollama model
						to extract the recipe
					</label>
					{busy ? <p role="status">Asking the local model...</p> : null}
					<div className="recipe-clipper-modal-actions">
						<button type="button" onClick={cancel}>
							Cancel
						</button>
						<button type="submit" className="mod-cta" disabled={busy || !text.trim()}>
							Review recipe
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
