import { describe, expect, it, vi } from "vitest";
import { AttachmentError } from "../../src/domain/vault/attachmentManager";
import { DEFAULT_SETTINGS } from "../../src/pluginSettings";
import {
	PluginServiceAdapter,
	type PluginServiceHost,
	type RecipeWorkspace,
} from "../../src/wrapper/PluginServiceAdapter";

describe("PluginServiceAdapter image removal", () => {
	it("logs and surfaces an attachment deletion refusal to the UI caller", async () => {
		const refusal = new AttachmentError("Refusing unsafe image path");
		const workspace = {
			listRecipes: () => [],
			listPendingClips: () => [],
			removeImage: vi.fn().mockRejectedValue(refusal),
		} as unknown as RecipeWorkspace;
		const host: PluginServiceHost = {
			getSettings: () => ({ ...DEFAULT_SETTINGS }),
			openSettings: () => {},
			registerVaultListener: () => () => {},
			getResourcePath: () => null,
			logError: vi.fn(),
		};
		const adapter = new PluginServiceAdapter(host, workspace);
		const image = {
			path: "Notes/ImportantNote.md",
			alt: "",
			sourceUrl: null,
			isPrimary: true,
		};

		await expect(adapter.removeRecipeImage(image)).rejects.toBe(refusal);
		expect(host.logError).toHaveBeenCalledWith("Failed to remove recipe image", refusal);
	});
});
