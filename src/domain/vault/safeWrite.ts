import type { VaultPort } from "./vaultPort";

/** Thrown when a save would replace a file the user can still repair by hand. */
export class VaultFilePreservedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "VaultFilePreservedError";
	}
}

/**
 * Replace a text file, and put the previous bytes back if the write throws
 * after changing the vault. A new file that fails to finish is removed.
 */
export async function replaceTextFile(
	vault: VaultPort,
	path: string,
	next: string,
): Promise<void> {
	const existed = await vault.exists(path);
	const previous = existed ? await vault.read(path) : null;
	try {
		await vault.write(path, next);
	} catch (error) {
		await restoreTextFile(vault, path, previous);
		throw error;
	}
}

async function restoreTextFile(
	vault: VaultPort,
	path: string,
	previous: string | null,
): Promise<void> {
	try {
		if (previous !== null) {
			await vault.write(path, previous);
			return;
		}
		if (await vault.exists(path)) {
			await vault.remove(path);
		}
	} catch {
		// The caller still sees the original write failure.
	}
}
