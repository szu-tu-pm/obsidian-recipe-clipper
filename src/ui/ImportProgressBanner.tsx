export function ImportProgressBanner({
	message,
	onCancel,
	onReview,
	reviewDisabled = false,
}: {
	message: string;
	onCancel?: () => void;
	onReview?: () => void;
	reviewDisabled?: boolean;
}): JSX.Element {
	return (
		<div className="recipe-clipper-import-progress" role="status">
			<p>{message}</p>
			<div className="recipe-clipper-row-actions">
				{onReview ? (
					<button type="button" onClick={onReview} disabled={reviewDisabled}>
						Review recipe
					</button>
				) : null}
				{onCancel ? (
					<button type="button" onClick={onCancel}>
						Cancel import
					</button>
				) : null}
			</div>
		</div>
	);
}
