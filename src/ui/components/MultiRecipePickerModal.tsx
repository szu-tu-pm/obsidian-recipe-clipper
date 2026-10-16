import { useEffect, useId, useRef } from "react";
import type { ExtractionCandidate } from "../../domain/extraction/types";
import { useEscapeToClose } from "../useEscapeToClose";

export function MultiRecipePickerModal({
	candidates,
	onSelect,
	onCancel,
}: {
	candidates: ExtractionCandidate[];
	onSelect: (index: number) => void;
	onCancel: () => void;
}): JSX.Element {
	const headingId = useId();
	const cancelRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		cancelRef.current?.focus();
	}, []);

	useEscapeToClose(onCancel);

	return (
		<div className="recipe-clipper-modal-backdrop" role="presentation" onClick={onCancel}>
			<div
				className="recipe-clipper-modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby={headingId}
				onClick={(event) => event.stopPropagation()}
			>
				<h3 id={headingId}>Choose a recipe</h3>
				<p>This page has more than one recipe. Nothing is saved until you review the one you pick.</p>
				<ul className="recipe-clipper-picker-list">
					{candidates.map((candidate, index) => (
						<li key={candidate.draft.frontmatter.id}>
							<button type="button" onClick={() => onSelect(index)}>
								{candidate.title}
							</button>
							<span>
								{candidate.ingredientsRaw.length} ingredients, {candidate.instructions.length}{" "}
								steps
							</span>
						</li>
					))}
				</ul>
				<div className="recipe-clipper-modal-actions">
					<button ref={cancelRef} type="button" onClick={onCancel}>
						Cancel
					</button>
				</div>
			</div>
		</div>
	);
}
