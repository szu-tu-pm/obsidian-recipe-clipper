import type { DuplicateMatch } from "../../domain/extraction/types";

export function DuplicateUrlWarningBanner({
	matches,
}: {
	matches: DuplicateMatch[];
}): JSX.Element | null {
	if (matches.length === 0) {
		return null;
	}
	return (
		<div className="recipe-clipper-duplicate-warning" role="status">
			<p>
				This source URL is already saved. Confirming writes a new copy and does not
				replace the existing recipe.
			</p>
			<ul>
				{matches.map((match) => (
					<li key={match.id}>{match.path || match.sourceUrl}</li>
				))}
			</ul>
		</div>
	);
}
