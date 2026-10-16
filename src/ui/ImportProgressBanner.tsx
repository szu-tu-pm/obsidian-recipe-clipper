export function ImportProgressBanner({
	message,
	onCancel,
}: {
	message: string;
	onCancel: () => void;
}): JSX.Element {
	return (
		<div className="recipe-clipper-import-progress" role="status">
			<p>{message}</p>
			<button type="button" onClick={onCancel}>
				Cancel import
			</button>
		</div>
	);
}
