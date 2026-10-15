import { useEffect, useId, useRef } from "react";

export function ConfirmDialog({
	title,
	message,
	confirmLabel,
	onConfirm,
	onCancel,
}: {
	title: string;
	message: string;
	confirmLabel: string;
	onConfirm: () => void;
	onCancel: () => void;
}): JSX.Element {
	const headingId = useId();
	const cancelRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		cancelRef.current?.focus();
	}, []);

	return (
		<div className="recipe-clipper-modal-backdrop" role="presentation" onClick={onCancel}>
			<div
				className="recipe-clipper-modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby={headingId}
				onClick={(event) => event.stopPropagation()}
			>
				<h3 id={headingId}>{title}</h3>
				<p>{message}</p>
				<div className="recipe-clipper-modal-actions">
					<button ref={cancelRef} type="button" onClick={onCancel}>
						Cancel
					</button>
					<button type="button" className="mod-warning" onClick={onConfirm}>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
