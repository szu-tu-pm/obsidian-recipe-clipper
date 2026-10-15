import { useMemo, useState } from "react";
import type { RecipeDocument } from "../domain/schema/recipeSchema";
import type { RecipeIndexEntry } from "../domain/vault/recipeIndexer";
import { usePluginServices, useRecipeIndex } from "../wrapper/WrapperContext";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ratingBadge } from "./components/StarRating";
import { filterRecipes, type RatingFilter } from "./filterRecipes";
import { RecipeEditorModal } from "./RecipeEditorModal";

export function CollectionView(): JSX.Element {
	const services = usePluginServices();
	const recipes = useRecipeIndex();
	const [query, setQuery] = useState("");
	const [rating, setRating] = useState<RatingFilter>("any");
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [editor, setEditor] = useState<RecipeDocument | null | "new">(null);
	const [pendingDelete, setPendingDelete] = useState<RecipeIndexEntry | null>(null);
	const [status, setStatus] = useState<string | null>(null);

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
				<button type="button" className="mod-cta" onClick={() => setEditor("new")}>
					New recipe
				</button>
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

			{status ? (
				<p className="recipe-clipper-status" role="status">
					{status}
				</p>
			) : null}

			{visible.length === 0 ? (
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
