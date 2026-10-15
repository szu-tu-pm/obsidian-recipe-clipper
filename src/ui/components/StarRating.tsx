import type { RecipeRating } from "../../domain/schema/recipeSchema";

const STARS = [1, 2, 3, 4, 5] as const;

export function StarRating({
	value,
	onChange,
	label = "Rating",
}: {
	value: RecipeRating;
	onChange: (next: RecipeRating) => void;
	label?: string;
}): JSX.Element {
	return (
		<fieldset className="recipe-clipper-stars">
			<legend>{label}</legend>
			<button
				type="button"
				className="recipe-clipper-star-option"
				aria-pressed={value == null}
				onClick={() => onChange(null)}
			>
				Unrated
			</button>
			{STARS.map((star) => {
				const filled = value != null && star <= value;
				return (
					<button
						key={star}
						type="button"
						className="recipe-clipper-star-option"
						aria-pressed={value === star}
						aria-label={`${star} star${star === 1 ? "" : "s"}`}
						onClick={() => onChange(star)}
					>
						<span aria-hidden="true">{filled ? "★" : "☆"}</span>
						<span className="recipe-clipper-star-count">{star}</span>
					</button>
				);
			})}
		</fieldset>
	);
}

export function ratingBadge(rating: RecipeRating): string {
	if (rating == null) {
		return "Unrated";
	}
	return `${rating} star${rating === 1 ? "" : "s"}`;
}
