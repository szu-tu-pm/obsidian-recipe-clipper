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
	subscribeSettings(listener: () => void): () => void;
	subscribeVaultChanges(listener: VaultChangeListener): () => void;
	openSettings(): void;
}

export interface PluginServiceHost {
	getSettings(): RecipePluginSettings;
	openSettings(): void;
	registerVaultListener(listener: VaultChangeListener): () => void;
	logError(message: string, error?: unknown): void;
}

function copySettings(settings: RecipePluginSettings): RecipePluginSettings {
	return { ...settings };
}

export class PluginServiceAdapter implements PluginServices {
	private readonly vaultListeners = new Set<VaultChangeListener>();
	private readonly settingsListeners = new Set<() => void>();
	private settingsSnapshot: RecipePluginSettings;
	private unsubscribeHost: (() => void) | null = null;
	private disposed = false;

	constructor(private readonly host: PluginServiceHost) {
		this.settingsSnapshot = this.readSettingsFromHost();
		this.unsubscribeHost = host.registerVaultListener((event) => {
			this.emitVaultChange(event);
		});
	}

	getSettings(): RecipePluginSettings {
		return this.settingsSnapshot;
	}

	subscribeSettings(listener: () => void): () => void {
		if (this.disposed) {
			return () => {};
		}
		this.settingsListeners.add(listener);
		return () => {
			this.settingsListeners.delete(listener);
		};
	}

	subscribeVaultChanges(listener: VaultChangeListener): () => void {
		if (this.disposed) {
			return () => {};
		}
		this.vaultListeners.add(listener);
		return () => {
			this.vaultListeners.delete(listener);
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

	notifySettingsChanged(): void {
		if (this.disposed) {
			return;
		}
		this.settingsSnapshot = this.readSettingsFromHost();
		for (const listener of [...this.settingsListeners]) {
			try {
				listener();
			} catch (error) {
				this.host.logError("Settings listener failed", error);
			}
		}
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.vaultListeners.clear();
		this.settingsListeners.clear();
		this.unsubscribeHost?.();
		this.unsubscribeHost = null;
		this.settingsSnapshot = copySettings(DEFAULT_SETTINGS);
	}

	private readSettingsFromHost(): RecipePluginSettings {
		try {
			return copySettings(this.host.getSettings());
		} catch (error) {
			this.host.logError("Failed to read plugin settings", error);
			return copySettings(DEFAULT_SETTINGS);
		}
	}

	private emitVaultChange(event: VaultChangeEvent): void {
		if (this.disposed) {
			return;
		}
		for (const listener of [...this.vaultListeners]) {
			try {
				listener(event);
			} catch (error) {
				this.host.logError("Vault change listener failed", error);
			}
		}
	}
}
