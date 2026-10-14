import { DEFAULT_SETTINGS, type RecipePluginSettings } from "../settings";

export type VaultChangeKind = "create" | "modify" | "delete" | "rename" | "metadata";

export interface VaultChangeEvent {
	kind: VaultChangeKind;
	path: string;
	previousPath?: string;
}

export type VaultChangeListener = (event: VaultChangeEvent) => void;

export interface PluginServices {
	getSettings(): RecipePluginSettings;
	subscribeVaultChanges(listener: VaultChangeListener): () => void;
	openSettings(): void;
}

export interface PluginServiceHost {
	getSettings(): RecipePluginSettings;
	openSettings(): void;
	registerVaultListener(listener: VaultChangeListener): () => void;
	logError(message: string, error?: unknown): void;
}

export class PluginServiceAdapter implements PluginServices {
	private readonly listeners = new Set<VaultChangeListener>();
	private unsubscribeHost: (() => void) | null = null;
	private disposed = false;

	constructor(private readonly host: PluginServiceHost) {
		this.unsubscribeHost = host.registerVaultListener((event) => {
			this.emit(event);
		});
	}

	getSettings(): RecipePluginSettings {
		if (this.disposed) {
			return { ...DEFAULT_SETTINGS };
		}
		try {
			return this.host.getSettings();
		} catch (error) {
			this.host.logError("Failed to read plugin settings", error);
			return { ...DEFAULT_SETTINGS };
		}
	}

	subscribeVaultChanges(listener: VaultChangeListener): () => void {
		if (this.disposed) {
			return () => {};
		}
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	openSettings(): void {
		if (this.disposed) {
			return;
		}
		try {
			this.host.openSettings();
		} catch (error) {
			this.host.logError("Failed to open plugin settings", error);
		}
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.listeners.clear();
		this.unsubscribeHost?.();
		this.unsubscribeHost = null;
	}

	private emit(event: VaultChangeEvent): void {
		if (this.disposed) {
			return;
		}
		for (const listener of [...this.listeners]) {
			try {
				listener(event);
			} catch (error) {
				this.host.logError("Vault change listener failed", error);
			}
		}
	}
}
