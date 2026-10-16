import { useEffect, useMemo, useRef, useState } from "react";
import {
	startImportSession,
	type ImportActivity,
	type ImportSession,
	type ImportSessionSnapshot,
} from "../domain/extraction/importSession";
import type { UrlExtractionResult } from "../domain/extraction/types";
import { selectExtractionCandidate } from "../domain/extraction/urlClipper";
import type { RecipeDocument } from "../domain/schema/recipeSchema";
import type { RecipeIndexEntry } from "../domain/vault/recipeIndexer";
import { usePluginServices, useRecipeIndex } from "../wrapper/WrapperContext";
import type { PluginServices } from "../wrapper/PluginServiceAdapter";
import { ImportProgressBanner } from "./ImportProgressBanner";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ImportReviewModal } from "./components/ImportReviewModal";
import { MultiRecipePickerModal } from "./components/MultiRecipePickerModal";
import { ratingBadge } from "./components/StarRating";
import { filterRecipes, type RatingFilter } from "./filterRecipes";
import { downloadSourceImage, ensureHttpsUrl, importRecipePage } from "./importRecipePage";
import { RecipeEditorModal } from "./RecipeEditorModal";
import { useEscapeToClose } from "./useEscapeToClose";

export function CollectionView({
	importPage = importRecipePage,
	downloadImage = (url: string) => downloadSourceImage(url),
	notify = () => undefined,
}: {
	importPage?: (
		url: string,
		services: PluginServices,
		signal: AbortSignal,
		report?: (phase: ImportActivity) => void,
	) => Promise<UrlExtractionResult>;
	downloadImage?: (url: string) => Promise<ArrayBuffer | null>;
	notify?: (message: string) => void;
} = {}): JSX.Element {
	const services = usePluginServices();
	const recipes = useRecipeIndex();
	const [query, setQuery] = useState("");
	const [rating, setRating] = useState<RatingFilter>("any");
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [editor, setEditor] = useState<RecipeDocument | null | "new">(null);
	const [pendingDelete, setPendingDelete] = useState<RecipeIndexEntry | null>(null);
	const [status, setStatus] = useState<string | null>(null);
	const [urlOpen, setUrlOpen] = useState(false);
	const [urlValue, setUrlValue] = useState("");
	const [review, setReview] = useState<UrlExtractionResult | null>(null);
	const [progress, setProgress] = useState<ImportSessionSnapshot | null>(null);
	const sessionRef = useRef<ImportSession | null>(null);
	const stopSession = useRef<(() => void) | null>(null);
	const importing = progress?.phase === "fetching" || progress?.phase === "extracting";

	const visible = useMemo(
		() => filterRecipes(recipes, query, rating),
		[recipes, query, rating],
	);

	function toggleSelected(id: string, checked: boolean): void {
		setSelected((current) => {
			const next = new Set(current);
			if (checked) {
				next.add(id);
			} else {
				next.delete(id);
			}
			return next;
		});
	}

	async function openEditor(id: string): Promise<void> {
		const loaded = await services.loadRecipe(id);
		if (!loaded.ok) {
			setStatus(loaded.message);
			return;
		}
		setEditor(loaded.recipe);
	}

	function openImport(): void {
		setUrlValue("");
		setUrlOpen(true);
	}

	function closeImport(): void {
		setUrlOpen(false);
	}

	function cancelImport(): void {
		sessionRef.current?.cancel();
	}

	useEffect(() => {
		return () => {
			sessionRef.current?.cancel();
			stopSession.current?.();
			stopSession.current = null;
			sessionRef.current = null;
		};
	}, []);

	useEffect(() => {
		if (!progress || progress.phase === "fetching" || progress.phase === "extracting") {
			return;
		}
		const finished = progress;
		stopSession.current?.();
		stopSession.current = null;
		sessionRef.current = null;
		setProgress(null);
		if (finished.phase === "cancelled" || !finished.result) {
			setStatus(finished.message);
			return;
		}
		setReview(finished.result);
		setStatus(null);
	}, [progress]);

	function startImport(): void {
		const url = ensureHttpsUrl(urlValue);
		if (!url || importing) {
			return;
		}
		if (url !== urlValue) {
			setUrlValue(url);
		}
		const session = startImportSession({
			url,
			run: (report, signal) => importPage(url, services, signal, report),
		});
		stopSession.current?.();
		sessionRef.current = session;
		stopSession.current = session.subscribe(() => {
			setProgress(session.snapshot());
		});
		setUrlOpen(false);
		setStatus(null);
		setProgress(session.snapshot());
	}

	async function confirmDelete(): Promise<void> {
		if (!pendingDelete) {
			return;
		}
		const id = pendingDelete.id;
		setPendingDelete(null);
		await services.deleteRecipe(id);
		setSelected((current) => {
			const next = new Set(current);
			next.delete(id);
			return next;
		});
		setStatus("Recipe deleted. Existing shopping lists were not changed.");
	}

	return (
		<div className="recipe-clipper-view recipe-clipper-collection">
			<header className="recipe-clipper-collection-header">
				<h4>Recipes</h4>
				<div className="recipe-clipper-row-actions">
					{recipes.length > 0 ? (
						<button type="button" onClick={openImport}>
							Import URL
						</button>
					) : null}
					<button type="button" className="mod-cta" onClick={() => setEditor("new")}>
						New recipe
					</button>
				</div>
			</header>

			<div className="recipe-clipper-toolbar">
				<label>
					Search recipes by title
					<input
						type="search"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Search titles"
					/>
				</label>
				<label>
					Filter by rating
					<select
						value={String(rating)}
						onChange={(event) => {
							const next = event.target.value;
							if (next === "any" || next === "unrated") {
								setRating(next);
								return;
							}
							setRating(Number(next) as RatingFilter);
						}}
					>
						<option value="any">Any rating</option>
						<option value="unrated">Unrated</option>
						<option value="1">1 star</option>
						<option value="2">2 stars</option>
						<option value="3">3 stars</option>
						<option value="4">4 stars</option>
						<option value="5">5 stars</option>
					</select>
				</label>
			</div>

			<div className="recipe-clipper-selection-bar">
				<p>
					{selected.size} selected for a future shopping list. Existing shopping lists
					are not changed from this view.
				</p>
				<button
					type="button"
					disabled
					title="Shopping list generation ships in Phase 2"
				>
					Generate shopping list
				</button>
			</div>

			{importing && progress ? (
				<ImportProgressBanner message={progress.message} onCancel={cancelImport} />
			) : null}

			{status ? (
				<p className="recipe-clipper-status" role="status">
					{status}
				</p>
			) : null}

			{recipes.length === 0 ? (
				<div className="recipe-clipper-empty">
					<p>No recipes yet.</p>
					<div className="recipe-clipper-row-actions">
						<button type="button" onClick={openImport}>
							Import URL
						</button>
						<button type="button" onClick={() => setEditor("new")}>
							Add manually
						</button>
					</div>
				</div>
			) : visible.length === 0 ? (
				<p className="recipe-clipper-empty">
					No recipes match this search. Create a manual recipe to get started.
				</p>
			) : (
				<ul className="recipe-clipper-recipe-list">
					{visible.map((recipe) => {
						const coverUrl = recipe.primaryImagePath
							? services.getImageUrl(recipe.primaryImagePath)
							: null;
						return (
							<li key={recipe.id} className="recipe-clipper-recipe-row">
								<label className="recipe-clipper-select">
									<input
										type="checkbox"
										checked={selected.has(recipe.id)}
										onChange={(event) =>
											toggleSelected(recipe.id, event.target.checked)
										}
									/>
									<span className="recipe-clipper-sr-only">
										Select {recipe.title} for shopping list
									</span>
								</label>
								{coverUrl ? (
									<img
										className="recipe-clipper-cover"
										src={coverUrl}
										alt=""
									/>
								) : (
									<div className="recipe-clipper-cover recipe-clipper-cover-empty">
										No cover
									</div>
								)}
								<div className="recipe-clipper-recipe-copy">
									<button
										type="button"
										className="recipe-clipper-title-button"
										onClick={() => void openEditor(recipe.id)}
									>
										{recipe.title}
									</button>
									<span className="recipe-clipper-rating-badge">
										{ratingBadge(recipe.rating)}
									</span>
								</div>
								<div className="recipe-clipper-row-actions">
									<button type="button" onClick={() => void openEditor(recipe.id)}>
										Edit
									</button>
									<button type="button" onClick={() => setPendingDelete(recipe)}>
										Delete
									</button>
								</div>
							</li>
						);
					})}
				</ul>
			)}

			{urlOpen ? (
				<ImportUrlDialog
					url={urlValue}
					busy={importing}
					onChange={setUrlValue}
					onCancel={closeImport}
					onSubmit={() => void startImport()}
				/>
			) : null}

			{review?.status === "needs-selection" ? (
				<MultiRecipePickerModal
					candidates={review.candidates}
					onCancel={() => setReview(null)}
					onSelect={(index) => setReview(selectExtractionCandidate(review, index))}
				/>
			) : null}

			{review && review.status !== "needs-selection" ? (
				<ImportReviewModal
					result={review}
					services={services}
					downloadImage={downloadImage}
					onClose={(notice) => {
						setReview(null);
						if (notice) {
							setStatus(notice);
							notify(notice);
						}
					}}
				/>
			) : null}

			{editor !== null ? (
				<RecipeEditorModal
					services={services}
					initial={editor === "new" ? null : editor}
					onClose={() => setEditor(null)}
				/>
			) : null}

			{pendingDelete ? (
				<ConfirmDialog
					title={`Delete ${pendingDelete.title}?`}
					message="This removes the recipe note and its attachments. Existing shopping lists are not changed."
					confirmLabel="Delete recipe"
					onCancel={() => setPendingDelete(null)}
					onConfirm={() => void confirmDelete()}
				/>
			) : null}
		</div>
	);
}

function ImportUrlDialog({
	url,
	busy,
	onChange,
	onCancel,
	onSubmit,
}: {
	url: string;
	busy: boolean;
	onChange: (value: string) => void;
	onCancel: () => void;
	onSubmit: () => void;
}): JSX.Element {
	useEscapeToClose(onCancel, !busy);

	return (
		<div className="recipe-clipper-modal-backdrop" role="presentation">
			<div
				className="recipe-clipper-modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby="recipe-import-url-title"
			>
				<h3 id="recipe-import-url-title">Import URL</h3>
				<form
					noValidate
					className="recipe-clipper-editor-form"
					onSubmit={(event) => {
						event.preventDefault();
						onSubmit();
					}}
				>
					<label>
						Recipe URL
						<input
							type="url"
							required
							value={url}
							autoFocus
							onChange={(event) => onChange(event.target.value)}
						/>
					</label>
					<div className="recipe-clipper-modal-actions">
						<button type="button" onClick={onCancel} disabled={busy}>
							Cancel
						</button>
						<button type="submit" className="mod-cta" disabled={busy}>
							Start import
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
