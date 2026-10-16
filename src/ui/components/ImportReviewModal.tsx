import { useEffect, useId, useState } from "react";
import { formatSourceAttribution } from "../../domain/extraction/attributionExtractor";
import { findDuplicateSourceUrls } from "../../domain/extraction/urlClipper";
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
}: {
	result: ReviewResult;
	services: PluginServices;
	downloadImage: (url: string) => Promise<ArrayBuffer | null>;
	onClose: () => void;
}): JSX.Element {
	const headingId = useId();
	const draft =
		result.status === "extracted" ? result.candidate.draft : result.draft;
	const candidate = result.status === "extracted" ? result.candidate : null;
	const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const manual = result.status === "manual-fallback";
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
			const saved = await services.saveRecipe(draft);
			if (!saved) {
				setError("Could not save the recipe.");
				return;
			}
			const images = await attachConfirmedImages(
				saved,
				candidate?.candidateImages ?? [],
				selectedImages,
				services,
				downloadImage,
			);
			if (images.length > 0) {
				const withImages = await services.saveRecipe({
					...saved,
					frontmatter: { ...saved.frontmatter, images },
				});
				if (!withImages) {
					setError("The recipe was saved, but a confirmed image could not be stored.");
					return;
				}
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
				<h3 id={headingId}>{manual ? "Manual entry" : "Review import"}</h3>
				{manual ? (
					<p role="status">
						This import did not succeed ({result.reason}). The URL is kept so you can
						save a manual recipe. Nothing has been written yet.
					</p>
				) : (
					<p>Nothing is written to the vault until you save this review.</p>
				)}
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
						{draft.frontmatter.ingredients.map((ingredient) => (
							<li key={ingredient.id}>
								<span className="recipe-clipper-confidence">
									{confidenceLabel(ingredient.parseConfidence)}
								</span>
								<span>{ingredient.raw}</span>
							</li>
						))}
					</ul>
				)}
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
					<p className="recipe-clipper-error" role="alert">
						{error}
					</p>
				) : null}
				<div className="recipe-clipper-modal-actions">
					<button
						id="recipe-import-cancel"
						type="button"
						onClick={onClose}
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
): Promise<RecipeImage[]> {
	const images: RecipeImage[] = [];
	let index = 0;
	for (const image of candidates) {
		if (!selected.has(image.sourceUrl)) {
			continue;
		}
		const bytes = await downloadImage(image.sourceUrl);
		index += 1;
		if (!bytes) {
			continue;
		}
		const added = await services.addRecipeImage(
			saved.frontmatter.id,
			sourceImageFilename(image.sourceUrl, index - 1),
			bytes,
			images,
		);
		if (!added) {
			continue;
		}
		images.push({
			...added,
			alt: image.alt,
			sourceUrl: image.sourceUrl,
			isPrimary: images.length === 0,
		});
	}
	return images;
}
