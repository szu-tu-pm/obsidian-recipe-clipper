import { useEffect, useMemo, useRef, useState } from "react";
import { reconcileIngredientLines } from "../domain/schema/recipeMarkdown";
import {
	createManualRecipe,
	type RecipeDocument,
	type RecipeImage,
	type RecipeRating,
} from "../domain/schema/recipeSchema";
import { ImageGalleryPicker } from "./components/ImageGalleryPicker";
import { StarRating } from "./components/StarRating";
import { useEscapeToClose } from "./useEscapeToClose";
import type { PluginServices } from "../wrapper/PluginServiceAdapter";

export function RecipeEditorModal({
	services,
	initial,
	onClose,
}: {
	services: PluginServices;
	initial: RecipeDocument | null;
	onClose: () => void;
}): JSX.Element {
	const [recipe, setRecipe] = useState<RecipeDocument>(
		() => initial ?? createManualRecipe(""),
	);
	const [title, setTitle] = useState(recipe.frontmatter.title);
	const [servingsRaw, setServingsRaw] = useState(recipe.frontmatter.servings?.raw ?? "");
	const [servingsAmount, setServingsAmount] = useState(
		recipe.frontmatter.servings?.amount != null
			? String(recipe.frontmatter.servings.amount)
			: "",
	);
	const [ingredientsText, setIngredientsText] = useState(
		recipe.frontmatter.ingredients.map((item) => item.raw).join("\n"),
	);
	const [instructionsText, setInstructionsText] = useState(recipe.instructions.join("\n"));
	const [methodsText, setMethodsText] = useState(recipe.frontmatter.cookingMethods.join(", "));
	const [notes, setNotes] = useState(recipe.notes);
	const [rating, setRating] = useState<RecipeRating>(recipe.frontmatter.rating);
	const [images, setImages] = useState<RecipeImage[]>(recipe.frontmatter.images);
	const [error, setError] = useState<string | null>(null);
	const [imageError, setImageError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const sessionUploads = useRef<RecipeImage[]>([]);
	const closingRef = useRef(false);
	const servicesRef = useRef(services);
	servicesRef.current = services;

	const heading = initial ? "Edit recipe" : "New recipe";

	useEffect(() => {
		return () => {
			const pending = sessionUploads.current.splice(0);
			for (const image of pending) {
				void servicesRef.current.removeRecipeImage(image);
			}
		};
	}, []);

	async function discardSessionUploads(): Promise<void> {
		const pending = sessionUploads.current.splice(0);
		await Promise.all(pending.map((image) => services.removeRecipeImage(image)));
	}

	async function requestClose(): Promise<void> {
		if (busy || closingRef.current) {
			return;
		}
		closingRef.current = true;
		try {
			await discardSessionUploads();
		} finally {
			onClose();
		}
	}

	useEscapeToClose(() => {
		void requestClose();
	}, !busy);

	async function readFileBytes(file: File): Promise<ArrayBuffer> {
		if (typeof file.arrayBuffer === "function") {
			return file.arrayBuffer();
		}
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result as ArrayBuffer);
			reader.onerror = () => reject(reader.error ?? new Error("Could not read image."));
			reader.readAsArrayBuffer(file);
		});
	}

	const imageUrls = useMemo(() => {
		const urls: Record<string, string> = {};
		for (const image of images) {
			const url = services.getImageUrl(image.path);
			if (url) {
				urls[image.path] = url;
			}
		}
		return urls;
	}, [images, services]);

	function updateImages(next: RecipeImage[]): void {
		setImages(
			next.map((image, index) => ({
				...image,
				isPrimary: index === 0,
			})),
		);
	}

	async function addFiles(files: ArrayLike<File>): Promise<void> {
		setImageError(null);
		setBusy(true);
		try {
			let current = [...images];
			for (const file of Array.from(files)) {
				const data = await readFileBytes(file);
				const added = await services.addRecipeImage(
					recipe.frontmatter.id,
					file.name,
					data,
					current,
				);
				if (!added) {
					setImageError(`Could not attach ${file.name}.`);
					break;
				}
				sessionUploads.current.push(added);
				current = [...current, added];
			}
			updateImages(current);
		} catch (caught) {
			setImageError(caught instanceof Error ? caught.message : "Could not attach images.");
		} finally {
			setBusy(false);
		}
	}

	async function removeImage(path: string): Promise<void> {
		const target = images.find((image) => image.path === path);
		if (!target) {
			return;
		}
		setBusy(true);
		try {
			await services.removeRecipeImage(target);
			sessionUploads.current = sessionUploads.current.filter((image) => image.path !== path);
			updateImages(images.filter((image) => image.path !== path));
		} finally {
			setBusy(false);
		}
	}

	async function save(): Promise<void> {
		const trimmedTitle = title.trim();
		if (!trimmedTitle) {
			setError("Title is required.");
			return;
		}
		const amount = servingsAmount.trim() ? Number(servingsAmount) : null;
		if (servingsAmount.trim() && (!Number.isFinite(amount) || (amount ?? 0) <= 0)) {
			setError("Servings amount must be a positive number.");
			return;
		}
		// Keep an unchanged line's parsed ingredient (id and identity), ignoring case and
		// whitespace, instead of re-parsing its text. A translated line would otherwise
		// lose the identity it kept from the original language.
		const ingredients = reconcileIngredientLines(
			ingredientsText
				.split(/\n/)
				.map((line) => line.replace(/^\s*[-*+]\s+/, "").trim())
				.filter(Boolean),
			recipe.frontmatter.ingredients,
		);
		const instructions = instructionsText
			.split(/\n/)
			.map((line) => line.replace(/^\s*\d+[.)]\s+/, "").trim())
			.filter(Boolean);
		const cookingMethods = methodsText
			.split(/,/)
			.map((item) => item.trim())
			.filter(Boolean);

		const next: RecipeDocument = {
			...recipe,
			notes,
			instructions,
			frontmatter: {
				...recipe.frontmatter,
				title: trimmedTitle,
				updatedAt: new Date().toISOString(),
				servings: servingsRaw.trim()
					? { raw: servingsRaw.trim(), amount }
					: null,
				cookingMethods,
				rating,
				images,
				ingredients,
			},
		};

		setBusy(true);
		setError(null);
		try {
			const saved = await services.saveRecipe(next);
			if (!saved) {
				setError("Could not save the recipe.");
				return;
			}
			sessionUploads.current = [];
			setRecipe(saved);
			onClose();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Could not save the recipe.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="recipe-clipper-modal-backdrop" role="presentation">
			<div
				className="recipe-clipper-modal recipe-clipper-editor"
				role="dialog"
				aria-modal="true"
				aria-labelledby="recipe-editor-title"
			>
				<h3 id="recipe-editor-title">{heading}</h3>
				<form
					className="recipe-clipper-editor-form"
					onSubmit={(event) => {
						event.preventDefault();
						void save();
					}}
				>
					<label>
						Title
						<input
							type="text"
							required
							value={title}
							onChange={(event) => setTitle(event.target.value)}
						/>
					</label>
					<div className="recipe-clipper-editor-row">
						<label>
							Servings
							<input
								type="text"
								placeholder="4 servings"
								value={servingsRaw}
								onChange={(event) => setServingsRaw(event.target.value)}
							/>
						</label>
						<label>
							Servings amount
							<input
								type="number"
								min={1}
								step="any"
								value={servingsAmount}
								onChange={(event) => setServingsAmount(event.target.value)}
							/>
						</label>
					</div>
					<label>
						Ingredients (one per line)
						<textarea
							rows={6}
							value={ingredientsText}
							onChange={(event) => setIngredientsText(event.target.value)}
						/>
					</label>
					<label>
						Instructions (one step per line)
						<textarea
							rows={6}
							value={instructionsText}
							onChange={(event) => setInstructionsText(event.target.value)}
						/>
					</label>
					<label>
						Cooking methods (comma separated)
						<input
							type="text"
							value={methodsText}
							onChange={(event) => setMethodsText(event.target.value)}
						/>
					</label>
					<label>
						Notes
						<textarea
							rows={3}
							value={notes}
							onChange={(event) => setNotes(event.target.value)}
						/>
					</label>
					<StarRating value={rating} onChange={setRating} />
					<ImageGalleryPicker
						images={images}
						resolveUrl={(path) => imageUrls[path] ?? services.getImageUrl(path)}
						busy={busy}
						error={imageError}
						onAddFiles={(files) => void addFiles(files)}
						onRemove={(path) => void removeImage(path)}
						onSetPrimary={(path) => {
							const selected = images.find((image) => image.path === path);
							if (!selected) {
								return;
							}
							updateImages([
								selected,
								...images.filter((image) => image.path !== path),
							]);
						}}
						onAltChange={(path, alt) => {
							updateImages(
								images.map((image) =>
									image.path === path ? { ...image, alt } : image,
								),
							);
						}}
					/>
					{error ? (
						<p className="recipe-clipper-error" role="alert">
							{error}
						</p>
					) : null}
					<div className="recipe-clipper-modal-actions">
						<button type="button" onClick={() => void requestClose()} disabled={busy}>
							Cancel
						</button>
						<button type="submit" className="mod-cta" disabled={busy}>
							Save recipe
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
