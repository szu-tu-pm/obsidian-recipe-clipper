import { useEffect, useId, useState } from "react";
import { formatSourceAttribution } from "../../domain/extraction/attributionExtractor";
import {
	applyIngredientChoices,
	type IngredientChoice,
	type IngredientDisagreement,
} from "../../domain/extraction/ingredientDisagreement";
import { findDuplicateSourceUrls } from "../../domain/extraction/urlClipper";
import {
	applyWebClipCorrections,
	correctionsFromDraft,
	type WebClipCorrections,
	type WebClipSaveOutcome,
} from "../../domain/extraction/webClipperIntake";
import type {
	CandidateImage,
	UrlExtractionFallback,
	UrlExtractionSuccess,
} from "../../domain/extraction/types";
import type { RecipeDocument, RecipeImage } from "../../domain/schema/recipeSchema";
import type { PluginServices } from "../../wrapper/PluginServiceAdapter";
import { sourceImageFilename } from "../importRecipePage";
import { useEscapeToClose } from "../useEscapeToClose";
import { DuplicateUrlWarningBanner } from "./DuplicateUrlWarningBanner";

type ReviewResult = UrlExtractionSuccess | UrlExtractionFallback;

function blank(value: string | null | undefined): string {
	const trimmed = value?.trim() ?? "";
	return trimmed.length > 0 ? trimmed : "Not on the page";
}

function confidenceLabel(value: string | null): string {
	return value ?? "unparsed";
}

export function ImportReviewModal({
	result,
	services,
	downloadImage,
	onClose,
	source = "url",
	saveDraft,
	onReload,
}: {
	result: ReviewResult;
	services: PluginServices;
	downloadImage: (url: string) => Promise<ArrayBuffer | null>;
	onClose: (notice?: string) => void;
	/** A web clip is already a note in the vault; its review lets the user correct fields before saving. */
	source?: "url" | "web-clip";
	/** Replaces `services.saveRecipe` for the first write, e.g. a guarded web-clip save. */
	saveDraft?: (draft: RecipeDocument) => Promise<WebClipSaveOutcome>;
	/** Offered when `saveDraft` reports that the note changed under the review. */
	onReload?: () => void;
}): JSX.Element {
	const headingId = useId();
	const draft =
		result.status === "extracted" ? result.candidate.draft : result.draft;
	const candidate = result.status === "extracted" ? result.candidate : null;
	const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [changed, setChanged] = useState(false);
	const manual = result.status === "manual-fallback";
	const webClip = source === "web-clip";
	const disagreements = candidate?.ingredientDisagreements ?? [];
	const flagged = new Set(disagreements.map((item) => item.index));
	const [choices, setChoices] = useState<Map<IngredientDisagreement, IngredientChoice>>(
		() => new Map(),
	);
	const [corrections, setCorrections] = useState<WebClipCorrections>(() =>
		correctionsFromDraft(draft),
	);
	const duplicates = findDuplicateSourceUrls(
		draft.frontmatter.sourceUrl,
		services.listRecipes(),
	);

	useEscapeToClose(() => {
		if (!busy) {
			onClose();
		}
	}, !busy);

	useEffect(() => {
		document.getElementById("recipe-import-cancel")?.focus();
	}, []);

	function toggleImage(url: string, checked: boolean): void {
		setSelectedImages((current) => {
			const next = new Set(current);
			if (checked) {
				next.add(url);
			} else {
				next.delete(url);
			}
			return next;
		});
	}

	async function confirm(): Promise<void> {
		if (busy) {
			return;
		}
		setBusy(true);
		setError(null);
		try {
			const chosen = applyIngredientChoices(draft, disagreements, choices);
			const toSave = webClip ? applyWebClipCorrections(chosen, corrections) : chosen;
			let saved: RecipeDocument | null;
			if (saveDraft) {
				const outcome = await saveDraft(toSave);
				if (outcome.status !== "saved") {
					setChanged(outcome.status === "changed");
					setError(outcome.message);
					return;
				}
				saved = outcome.recipe;
			} else {
				saved = await services.saveRecipe(toSave);
			}
			if (!saved) {
				setError("Could not save the recipe.");
				return;
			}
			const attached = await attachConfirmedImages(
				saved,
				candidate?.candidateImages ?? [],
				selectedImages,
				services,
				downloadImage,
			);
			if (attached.images.length > 0) {
				const withImages = await services.saveRecipe({
					...saved,
					frontmatter: { ...saved.frontmatter, images: attached.images },
				});
				if (!withImages) {
					onClose("The recipe was saved, but a confirmed image could not be stored.");
					return;
				}
			}
			if (attached.failed > 0) {
				onClose("The recipe was saved, but the remote image could not be downloaded.");
				return;
			}
			onClose();
		} finally {
			setBusy(false);
		}
	}

	const sourceLine = formatSourceAttribution({
		sourceUrl: draft.frontmatter.sourceUrl,
		author: draft.frontmatter.author,
		siteName: draft.frontmatter.siteName,
	});

	return (
		<div className="recipe-clipper-modal-backdrop" role="presentation">
			<div
				className="recipe-clipper-modal recipe-clipper-review"
				role="dialog"
				aria-modal="true"
				aria-labelledby={headingId}
			>
				<h3 id={headingId}>
					{webClip ? "Review web clip" : manual ? "Manual entry" : "Review import"}
				</h3>
				{webClip ? (
					<p role="status">
						{manual ? "This clip has no schema.org recipe data. " : ""}This web clip needs review. It is not used as a recipe, or offered for
						shopping lists, until you save this review. Missing fields stay empty.
					</p>
				) : manual ? (
					<p role="status">
						This import did not succeed ({result.reason}). The URL is kept so you can
						save a manual recipe. Nothing has been written yet.
					</p>
				) : (
					<p>Nothing is written to the vault until you save this review.</p>
				)}
				{result.warnings.length > 0 ? (
					<ul className="recipe-clipper-review-warnings">
						{result.warnings.map((warning, index) => (
							<li key={`${warning}-${index}`}>{warning}</li>
						))}
					</ul>
				) : null}
				<DuplicateUrlWarningBanner matches={duplicates} />
				{sourceLine ? <p className="recipe-clipper-source-line">{sourceLine}</p> : null}
				<dl className="recipe-clipper-review-fields">
					<div>
						<dt>Title</dt>
						<dd>{draft.frontmatter.title}</dd>
					</div>
					<div>
						<dt>Author</dt>
						<dd>{blank(draft.frontmatter.author)}</dd>
					</div>
					<div>
						<dt>Site</dt>
						<dd>{blank(draft.frontmatter.siteName)}</dd>
					</div>
					<div>
						<dt>Source URL</dt>
						<dd>{blank(draft.frontmatter.sourceUrl)}</dd>
					</div>
					<div>
						<dt>Servings</dt>
						<dd>{blank(draft.frontmatter.servings?.raw)}</dd>
					</div>
					<div>
						<dt>Cooking methods</dt>
						<dd>
							{draft.frontmatter.cookingMethods.length > 0
								? draft.frontmatter.cookingMethods.join(", ")
								: "Not on the page"}
						</dd>
					</div>
				</dl>
				<h4>Ingredients</h4>
				{draft.frontmatter.ingredients.length === 0 ? (
					<p>Not on the page</p>
				) : (
					<ul className="recipe-clipper-review-ingredients">
						{draft.frontmatter.ingredients.map((ingredient, position) => (
							<li key={ingredient.id}>
								{flagged.has(position) ? (
									<span className="recipe-clipper-mismatch-flag">Differs from the page</span>
								) : null}
								<span className="recipe-clipper-confidence">
									{confidenceLabel(ingredient.parseConfidence)}
								</span>
								<span>{ingredient.raw}</span>
							</li>
						))}
					</ul>
				)}
				{disagreements.length > 0 ? (
					<fieldset className="recipe-clipper-ingredient-disagreements">
						<legend>Ingredients that differ from the visible page</legend>
						<p>
							The page&apos;s structured data and its visible ingredient list say different
							things. The structured text is kept unless you pick the visible one.
						</p>
						{disagreements.map((item, position) => {
							const picked = choices.get(item) ?? "structured";
							const name = `ingredient-disagreement-${position}`;
							const pick = (choice: IngredientChoice) =>
								setChoices((current) => new Map(current).set(item, choice));
							return (
								<div key={position} className="recipe-clipper-disagreement">
									<label>
										<input
											type="radio"
											name={name}
											checked={picked === "structured"}
											onChange={() => pick("structured")}
										/>
										Structured data: <span>{item.structured ?? "Not in the structured data"}</span>
									</label>
									<label>
										<input
											type="radio"
											name={name}
											checked={picked === "visible"}
											onChange={() => pick("visible")}
										/>
										Visible on page: <span>{item.visible ?? "Not on the visible page"}</span>
									</label>
								</div>
							);
						})}
					</fieldset>
				) : null}
				<h4>Instructions</h4>
				{draft.instructions.length === 0 ? (
					<p>Not on the page</p>
				) : (
					<ol>
						{draft.instructions.map((step, index) => (
							<li key={`${index}-${step}`}>{step}</li>
						))}
					</ol>
				)}
				{webClip ? (
					<div className="recipe-clipper-editor-form">
						<h4>Correct before saving</h4>
						<label>
							Ingredients (one per line)
							<textarea
								rows={8}
								value={corrections.ingredientsText}
								onChange={(event) =>
									setCorrections({ ...corrections, ingredientsText: event.target.value })
								}
							/>
						</label>
						<label>
							Instructions (one per line)
							<textarea
								rows={8}
								value={corrections.instructionsText}
								onChange={(event) =>
									setCorrections({ ...corrections, instructionsText: event.target.value })
								}
							/>
						</label>
						<label>
							Cooking methods (comma separated)
							<input
								type="text"
								value={corrections.cookingMethodsText}
								onChange={(event) =>
									setCorrections({ ...corrections, cookingMethodsText: event.target.value })
								}
							/>
						</label>
					</div>
				) : null}
				<h4>Source images</h4>
				{(candidate?.candidateImages.length ?? 0) === 0 ? (
					<p>Not on the page</p>
				) : (
					<ul className="recipe-clipper-review-images">
						{candidate?.candidateImages.map((image) => (
							<li key={image.sourceUrl}>
								<label>
									<input
										type="checkbox"
										checked={selectedImages.has(image.sourceUrl)}
										onChange={(event) =>
											toggleImage(image.sourceUrl, event.target.checked)
										}
									/>
									Download this image into the vault
								</label>
								<span>{image.alt || image.sourceUrl}</span>
							</li>
						))}
					</ul>
				)}
				{error ? (
					<div className="recipe-clipper-error" role="alert">
						<p>{error}</p>
						{changed && onReload ? (
							<button type="button" onClick={onReload} disabled={busy}>
								Reload clip
							</button>
						) : null}
					</div>
				) : null}
				<div className="recipe-clipper-modal-actions">
					<button
						id="recipe-import-cancel"
						type="button"
						onClick={() => onClose()}
						disabled={busy}
					>
						Cancel
					</button>
					<button type="button" className="mod-cta" onClick={() => void confirm()} disabled={busy}>
						{manual ? "Save manual entry" : "Save recipe"}
					</button>
				</div>
			</div>
		</div>
	);
}

async function attachConfirmedImages(
	saved: RecipeDocument,
	candidates: CandidateImage[],
	selected: Set<string>,
	services: PluginServices,
	downloadImage: (url: string) => Promise<ArrayBuffer | null>,
): Promise<{ images: RecipeImage[]; failed: number }> {
	const images: RecipeImage[] = [];
	let failed = 0;
	let index = 0;
	for (const image of candidates) {
		if (!selected.has(image.sourceUrl)) {
			continue;
		}
		index += 1;
		let bytes: ArrayBuffer | null = null;
		try {
			bytes = await downloadImage(image.sourceUrl);
		} catch {
			bytes = null;
		}
		if (!bytes) {
			failed += 1;
			continue;
		}
		const added = await services.addRecipeImage(
			saved.frontmatter.id,
			sourceImageFilename(image.sourceUrl, index - 1),
			bytes,
			images,
		);
		if (!added) {
			failed += 1;
			continue;
		}
		images.push({
			...added,
			alt: image.alt,
			sourceUrl: image.sourceUrl,
			isPrimary: images.length === 0,
		});
	}
	return { images, failed };
}
