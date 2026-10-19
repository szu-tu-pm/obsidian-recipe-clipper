import { useState } from "react";
import type { RecipeImage } from "../../domain/schema/recipeSchema";
import { MAX_RECIPE_IMAGES } from "../../domain/vault/attachmentManager";

function GalleryPhoto({ url, alt }: { url: string | null; alt: string }): JSX.Element {
	const [missing, setMissing] = useState(false);
	if (!url || missing) {
		return <div className="recipe-clipper-gallery-missing">Missing file</div>;
	}
	return <img src={url} alt={alt} onError={() => setMissing(true)} />;
}

export function ImageGalleryPicker({
	images,
	resolveUrl,
	busy,
	error,
	onAddFiles,
	onRemove,
	onSetPrimary,
	onAltChange,
}: {
	images: RecipeImage[];
	resolveUrl: (path: string) => string | null;
	busy: boolean;
	error: string | null;
	onAddFiles: (files: ArrayLike<File>) => void;
	onRemove: (path: string) => void;
	onSetPrimary: (path: string) => void;
	onAltChange: (path: string, alt: string) => void;
}): JSX.Element {
	const remaining = MAX_RECIPE_IMAGES - images.length;

	return (
		<fieldset className="recipe-clipper-gallery" disabled={busy}>
			<legend>Images (up to {MAX_RECIPE_IMAGES})</legend>
			<p className="recipe-clipper-hint">
				{images.length} of {MAX_RECIPE_IMAGES} attached. Local files only, 10 MB each.
			</p>
			<label className="recipe-clipper-file-label" htmlFor="recipe-clipper-add-image">
				Add image
				<input
					id="recipe-clipper-add-image"
					type="file"
					accept="image/png,image/jpeg,image/webp,image/avif"
					multiple
					disabled={remaining <= 0}
					onChange={(event) => {
						const selected = Array.from(event.currentTarget.files ?? []);
						event.currentTarget.value = "";
						if (selected.length > 0) {
							onAddFiles(selected);
						}
					}}
				/>
			</label>
			{error ? (
				<p className="recipe-clipper-error" role="alert">
					{error}
				</p>
			) : null}
			<ul className="recipe-clipper-gallery-list">
				{images.map((image) => {
					const url = resolveUrl(image.path);
					return (
						<li key={image.path} className="recipe-clipper-gallery-item">
							<GalleryPhoto url={url} alt={image.alt || "Recipe photo"} />
							<label>
								Alt text
								<input
									type="text"
									value={image.alt}
									onChange={(event) => onAltChange(image.path, event.target.value)}
								/>
							</label>
							<div className="recipe-clipper-gallery-actions">
								<button
									type="button"
									aria-pressed={image.isPrimary}
									onClick={() => onSetPrimary(image.path)}
								>
									{image.isPrimary ? "Primary cover" : "Use as cover"}
								</button>
								<button type="button" onClick={() => onRemove(image.path)}>
									Remove image
								</button>
							</div>
						</li>
					);
				})}
			</ul>
		</fieldset>
	);
}
