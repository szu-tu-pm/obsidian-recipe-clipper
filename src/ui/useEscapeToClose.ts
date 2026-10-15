import { useEffect, useRef } from "react";

const dismissStack: Array<() => void> = [];

/**
 * Closes the topmost modal when Escape is pressed.
 * Later mounts sit above earlier ones, so a confirm dialog opened over the
 * editor handles the key and leaves the editor in place.
 */
export function useEscapeToClose(onClose: () => void, enabled = true): void {
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	useEffect(() => {
		if (!enabled) {
			return;
		}

		const dismiss = (): void => {
			onCloseRef.current();
		};
		dismissStack.push(dismiss);

		function onKeyDown(event: KeyboardEvent): void {
			if (event.key !== "Escape" || dismissStack[dismissStack.length - 1] !== dismiss) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			dismiss();
		}

		window.addEventListener("keydown", onKeyDown, true);
		return () => {
			window.removeEventListener("keydown", onKeyDown, true);
			const index = dismissStack.lastIndexOf(dismiss);
			if (index >= 0) {
				dismissStack.splice(index, 1);
			}
		};
	}, [enabled]);
}
