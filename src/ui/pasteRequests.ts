/**
 * Lets the command palette ask the open recipe view to show the Paste recipe window. The request
 * is remembered until a view takes it, so it also works when the view is still opening.
 */
let pending = false;
const listeners = new Set<() => void>();

export function requestPasteRecipe(): void {
	pending = true;
	for (const listener of [...listeners]) {
		listener();
	}
}

/** Returns true once for each request. */
export function takePasteRequest(): boolean {
	const requested = pending;
	pending = false;
	return requested;
}

export function subscribePasteRequests(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
