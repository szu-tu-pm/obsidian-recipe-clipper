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
import {
	createShoppingListFromRecipes,
	replaceShoppingListContents,
	type ShoppingListDocument,
} from "../domain/schema/shoppingListSchema";
import type { RecipeIndexEntry } from "../domain/vault/recipeIndexer";
import {
	usePendingWebClips,
	usePluginServices,
	useRecipeIndex,
} from "../wrapper/WrapperContext";
import type { PluginServices } from "../wrapper/PluginServiceAdapter";
import { ImportProgressBanner } from "./ImportProgressBanner";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ImportReviewModal } from "./components/ImportReviewModal";
import { MultiRecipePickerModal } from "./components/MultiRecipePickerModal";
import { ratingBadge } from "./components/StarRating";
import { filterRecipes, type RatingFilter } from "./filterRecipes";
import { downloadSourceImage, ensureHttpsUrl, importRecipePage } from "./importRecipePage";
import { RecipeEditorModal } from "./RecipeEditorModal";
import { RegenerateListDialog, ShoppingListView } from "./ShoppingListView";
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
	const pendingClips = usePendingWebClips();
	const [query, setQuery] = useState("");
	const [rating, setRating] = useState<RatingFilter>("any");
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [editor, setEditor] = useState<RecipeDocument | null | "new">(null);
	const [pendingDelete, setPendingDelete] = useState<RecipeIndexEntry | null>(null);
	const [shoppingList, setShoppingList] = useState<ShoppingListDocument | null>(null);
	const [savedLists, setSavedLists] = useState<ShoppingListDocument[]>([]);
	const [regenerateOpen, setRegenerateOpen] = useState(false);
	const [generating, setGenerating] = useState(false);
	const [status, setStatus] = useState<string | null>(null);
	const [urlOpen, setUrlOpen] = useState(false);
	const [urlValue, setUrlValue] = useState("");
	const [review, setReview] = useState<UrlExtractionResult | null>(null);
	const [reviewSource, setReviewSource] = useState<"url" | "web-clip">("url");
	const [clipReview, setClipReview] = useState<{ path: string; revision: string } | null>(null);
	const [reviewKey, setReviewKey] = useState(0);
	const offeredClips = useRef<Set<string>>(new Set());
	const loadingClip = useRef(false);
	const reviewRef = useRef<UrlExtractionResult | null>(null);
	reviewRef.current = review;
	const [readyImport, setReadyImport] = useState<{
		result: UrlExtractionResult;
		message: string;
	} | null>(null);
	const [progress, setProgress] = useState<ImportSessionSnapshot | null>(null);
	const sessionRef = useRef<ImportSession | null>(null);
	const stopSession = useRef<(() => void) | null>(null);
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const saveRevision = useRef(0);
	const saveQueue = useRef(Promise.resolve());
	const pendingSave = useRef<{ list: ShoppingListDocument; revision: number } | null>(null);
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
		let cancelled = false;
		void services.listShoppingLists().then((lists) => {
			if (!cancelled) {
				setSavedLists(lists);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [services]);

	useEffect(() => {
		return () => {
			if (saveTimer.current && pendingSave.current) {
				clearTimeout(saveTimer.current);
				const pending = pendingSave.current;
				pendingSave.current = null;
				void services.saveShoppingList(pending.list);
			}
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
			setReadyImport(null);
			setStatus(finished.message);
			return;
		}
		setStatus(null);
		if (editor !== null) {
			setReadyImport({
				result: finished.result,
				message: finished.phase === "failed" ? finished.message : "Import ready",
			});
			return;
		}
		setReadyImport(null);
		setClipReview(null);
		setReviewSource("url");
		setReview(finished.result);
	}, [editor, progress]);

	async function openClipReview(path: string, reload = false): Promise<void> {
		if (loadingClip.current) {
			return;
		}
		loadingClip.current = true;
		offeredClips.current.add(path);
		try {
			const loaded = await services.loadClipReview(path);
			if (!loaded) {
				if (reload) {
					setReview(null);
					setClipReview(null);
				}
				setStatus(`The web clip ${path} could not be read. It still needs review.`);
				return;
			}
			if (reviewRef.current && !reload) {
				// Another review opened while the clip was loading. Offer the clip again later.
				offeredClips.current.delete(path);
				return;
			}
			setReviewSource("web-clip");
			setClipReview({ path: loaded.path, revision: loaded.revision });
			setReviewKey((key) => key + 1);
			setReview(loaded.review);
		} finally {
			loadingClip.current = false;
		}
	}

	// A new web clip opens its review once, when nothing else is open.
	// A cancelled clip stays listed as needing review instead of reopening.
	useEffect(() => {
		if (
			review ||
			editor !== null ||
			urlOpen ||
			progress ||
			readyImport ||
			pendingDelete ||
			shoppingList
		) {
			return;
		}
		const next = pendingClips.find((clip) => !offeredClips.current.has(clip.path));
		if (next) {
			void openClipReview(next.path);
		}
	}, [pendingClips, review, editor, urlOpen, progress, readyImport, pendingDelete, shoppingList]);

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
		setReadyImport(null);
		setUrlOpen(false);
		setStatus(null);
		setProgress(session.snapshot());
	}

	function openReadyImport(): void {
		if (!readyImport || editor !== null) {
			return;
		}
		setClipReview(null);
		setReviewSource("url");
		setReview(readyImport.result);
		setReadyImport(null);
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

	async function draftFromSelection(): Promise<ShoppingListDocument | null> {
		const loaded: RecipeDocument[] = [];
		for (const id of selected) {
			const result = await services.loadRecipe(id);
			if (!result.ok) {
				setStatus(result.message);
				return null;
			}
			loaded.push(result.recipe);
		}
		return createShoppingListFromRecipes(loaded);
	}

	async function writeShoppingList(next: ShoppingListDocument, revision: number): Promise<void> {
		const saved = await services.saveShoppingList(next);
		if (!saved) {
			if (saveRevision.current === revision) {
				setStatus("Could not save the shopping list.");
			}
			return;
		}
		if (saveRevision.current === revision) {
			setShoppingList((current) =>
				current?.frontmatter.id === saved.frontmatter.id ? saved : current,
			);
			setStatus(null);
		}
		setSavedLists(await services.listShoppingLists());
	}

	function scheduleShoppingListWrite(next: ShoppingListDocument, revision: number): void {
		saveQueue.current = saveQueue.current
			.then(() => writeShoppingList(next, revision))
			.catch(() => undefined);
	}

	function persistShoppingList(next: ShoppingListDocument, immediate = false): void {
		const revision = saveRevision.current + 1;
		saveRevision.current = revision;
		pendingSave.current = { list: next, revision };
		setShoppingList(next);
		if (saveTimer.current) {
			clearTimeout(saveTimer.current);
			saveTimer.current = null;
		}
		const start = (): void => {
			if (pendingSave.current?.revision === revision) {
				pendingSave.current = null;
			}
			scheduleShoppingListWrite(next, revision);
		};
		if (immediate) {
			start();
			return;
		}
		saveTimer.current = setTimeout(start, 300);
	}

	function flushShoppingList(): void {
		if (!saveTimer.current || !pendingSave.current) {
			return;
		}
		clearTimeout(saveTimer.current);
		saveTimer.current = null;
		const pending = pendingSave.current;
		pendingSave.current = null;
		scheduleShoppingListWrite(pending.list, pending.revision);
	}

	async function createShoppingList(): Promise<void> {
		setGenerating(true);
		try {
			const draft = await draftFromSelection();
			if (!draft) {
				return;
			}
			await persistShoppingList(draft, true);
			setRegenerateOpen(false);
		} finally {
			setGenerating(false);
		}
	}

	async function replaceShoppingList(): Promise<void> {
		if (!shoppingList) {
			return;
		}
		setGenerating(true);
		try {
			const draft = await draftFromSelection();
			if (!draft) {
				return;
			}
			await persistShoppingList(replaceShoppingListContents(shoppingList, draft), true);
			setRegenerateOpen(false);
		} finally {
			setGenerating(false);
		}
	}

	function requestGenerate(): void {
		if (selected.size === 0 || generating) {
			return;
		}
		flushShoppingList();
		if (shoppingList) {
			setRegenerateOpen(true);
			return;
		}
		void createShoppingList();
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

			{savedLists.length > 0 ? (
				<div className="recipe-clipper-saved-lists">
					<h5>Saved shopping lists</h5>
					<ul>
						{savedLists.map((list) => (
							<li key={list.frontmatter.id}>
								<button
									type="button"
									aria-label={`Open shopping list ${list.frontmatter.id}`}
									onClick={() => {
										void services.loadShoppingList(list.frontmatter.id).then((loaded) => {
											if (loaded.ok) {
												setShoppingList(loaded.list);
												return;
											}
											setStatus(loaded.message);
										});
									}}
								>
									{list.frontmatter.title}
								</button>
							</li>
						))}
					</ul>
				</div>
			) : null}

			<div className="recipe-clipper-selection-bar">
				<p>
					{selected.size} selected for a shopping list. Saved lists stay unchanged when
					recipes are edited or deleted.
				</p>
				<button
					type="button"
					disabled={selected.size === 0 || generating}
					onClick={requestGenerate}
				>
					Generate shopping list
				</button>
			</div>

			{importing && progress ? (
				<ImportProgressBanner message={progress.message} onCancel={cancelImport} />
			) : null}

			{readyImport && !review ? (
				<ImportProgressBanner
					message={
						editor !== null
							? "Import ready. Close the recipe editor to review it."
							: readyImport.message
					}
					onReview={openReadyImport}
					reviewDisabled={editor !== null}
				/>
			) : null}

			{pendingClips.length > 0 && !review ? (
				<div className="recipe-clipper-import-progress" role="status">
					<p>
						{pendingClips.length === 1
							? "1 web clip needs review before it is used as a recipe."
							: `${pendingClips.length} web clips need review before they are used as recipes.`}
					</p>
					<ul>
						{pendingClips.map((clip) => (
							<li key={clip.path}>
								<span>{clip.title}</span>{" "}
								<button
									type="button"
									aria-label={`Review web clip ${clip.title}`}
									disabled={editor !== null || importing}
									onClick={() => void openClipReview(clip.path)}
								>
									Review
								</button>
							</li>
						))}
					</ul>
				</div>
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
					key={reviewKey}
					result={review}
					services={services}
					downloadImage={downloadImage}
					source={reviewSource}
					saveDraft={
						reviewSource === "web-clip" && clipReview
							? (draft) =>
									services.saveClipReview(clipReview.path, clipReview.revision, draft)
							: undefined
					}
					onReload={
						reviewSource === "web-clip" && clipReview
							? () => void openClipReview(clipReview.path, true)
							: undefined
					}
					onClose={(notice) => {
						setReview(null);
						setClipReview(null);
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

			{shoppingList ? (
				<ShoppingListView
					list={shoppingList}
					refreshDisabled={selected.size === 0 || generating}
					onEdit={(next) => persistShoppingList(next)}
					onCommit={(next) => persistShoppingList(next, true)}
					onFlush={flushShoppingList}
					onRefresh={requestGenerate}
					onClose={() => {
						flushShoppingList();
						setShoppingList(null);
					}}
				/>
			) : null}

			{regenerateOpen ? (
				<RegenerateListDialog
					onCancel={() => setRegenerateOpen(false)}
					onCreateNew={() => {
						void createShoppingList();
					}}
					onReplace={() => {
						void replaceShoppingList();
					}}
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
