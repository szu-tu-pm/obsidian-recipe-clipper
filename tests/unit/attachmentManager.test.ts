import { describe, expect, it, vi } from "vitest";
import {
	AttachmentError,
	AttachmentManager,
	isSafeAttachmentPath,
	MAX_RECIPE_IMAGES,
} from "../../src/domain/vault/attachmentManager";
import { InMemoryVault } from "../../src/domain/vault/inMemoryVault";
import type { ImageProcessor } from "../../src/domain/vault/vaultPort";

const dummyProcessor: ImageProcessor = {
	async downscaleToWebp(data: ArrayBuffer): Promise<ArrayBuffer | null> {
		return data;
	},
};

const nullProcessor: ImageProcessor = {
	async downscaleToWebp(): Promise<ArrayBuffer | null> {
		return null;
	},
};

function imageAt(path: string) {
	return { path, alt: "", sourceUrl: null, isPrimary: true };
}

describe("AttachmentManager", () => {
	it("accepts only image paths strictly beneath the case-sensitive attachment folder", () => {
		const folder = "Recipe Attachments";
		expect(isSafeAttachmentPath("Recipe Attachments/rec-123/img.webp", folder)).toBe(true);
		expect(isSafeAttachmentPath("Recipe Attachments/rec-123/img.png", folder)).toBe(true);
		expect(isSafeAttachmentPath("Recipe Attachments/rec-123/img.jpg", folder)).toBe(true);

		for (const unsafe of [
			"Recipe Attachments/../Secrets.png",
			"Recipe Attachments/rec-123/../../Secrets.png",
			"../Secrets.png",
			"/Recipe Attachments/rec-123/img.png",
			"C:/Recipe Attachments/rec-123/img.png",
			"Recipe Attachments\\rec-123\\img.png",
			"Recipe Attachments/rec-123\\img.png",
			"recipe attachments/rec-123/img.png",
			"Recipe Attachments-evil/img.png",
			"Recipe Attachments/./rec-123/img.png",
			"Recipe Attachments/%2e%2e/Secrets.png",
			"Recipe Attachments/rec-123/%2FSecrets.png",
			"Recipe Attachments",
			"Notes/MyRecipe.png",
			"",
		]) {
			expect(isSafeAttachmentPath(unsafe, folder), unsafe).toBe(false);
		}
	});

	it.each([
		["unrelated vault note", "Notes/ImportantNote.md"],
		["unrelated vault path", "Notes/ImportantNote.png"],
		["parent traversal", "Recipe Attachments/../ImportantNote.png"],
		["nested parent traversal", "Recipe Attachments/rec-1/../../ImportantNote.png"],
		["absolute path", "/Recipe Attachments/rec-1/ImportantNote.png"],
		["Windows absolute path", "C:/Recipe Attachments/rec-1/ImportantNote.png"],
		["backslash path", "Recipe Attachments\\rec-1\\ImportantNote.png"],
		["mixed separator path", "Recipe Attachments/rec-1\\ImportantNote.png"],
		["differently-cased folder", "recipe attachments/rec-1/ImportantNote.png"],
		["prefix sibling", "Recipe Attachments-evil/ImportantNote.png"],
		["current-directory segment", "Recipe Attachments/./rec-1/ImportantNote.png"],
		["percent-encoded traversal", "Recipe Attachments/%2e%2e/ImportantNote.png"],
		["percent-encoded separator", "Recipe Attachments/rec-1/%2FImportantNote.png"],
		["folder itself", "Recipe Attachments"],
		["empty path", ""],
	])("refuses a %s and leaves unrelated vault content intact", async (_case, unsafePath) => {
		const vault = new InMemoryVault();
		await vault.write("Notes/ImportantNote.md", "Do not delete");
		const manager = new AttachmentManager(vault, dummyProcessor, "Recipe Attachments");

		await expect(manager.removeImage(imageAt(unsafePath))).rejects.toThrow(AttachmentError);
		expect(await vault.exists("Notes/ImportantNote.md")).toBe(true);
		expect(await vault.read("Notes/ImportantNote.md")).toBe("Do not delete");
	});

	it("removes images safely when they reside in the managed attachments folder", async () => {
		const vault = new InMemoryVault();
		const manager = new AttachmentManager(vault, dummyProcessor, "Recipe Attachments");
		const imagePath = "Recipe Attachments/rec-1/photo.webp";
		await vault.writeBinary(imagePath, new Uint8Array([1, 2, 3]).buffer);

		expect(await vault.exists(imagePath)).toBe(true);

		await manager.removeImage(imageAt(imagePath));

		expect(await vault.exists(imagePath)).toBe(false);
	});

	it("does nothing when a legitimate managed image is already missing", async () => {
		const vault = new InMemoryVault();
		const remove = vi.spyOn(vault, "remove");
		const manager = new AttachmentManager(vault, dummyProcessor, "Recipe Attachments");

		await expect(
			manager.removeImage(imageAt("Recipe Attachments/rec-1/missing.webp")),
		).resolves.toBeUndefined();
		expect(remove).not.toHaveBeenCalled();
	});

	it("enforces image limit and file constraints in addImage", async () => {
		const vault = new InMemoryVault();
		const manager = new AttachmentManager(vault, dummyProcessor, "Recipe Attachments");
		const buffer = new Uint8Array([1, 2, 3]).buffer;

		// Rejects unsupported extension
		await expect(
			manager.addImage("rec-1", "bad.txt", buffer, []),
		).rejects.toThrow(AttachmentError);

		// Rejects when MAX_RECIPE_IMAGES reached
		const fullList = Array.from({ length: MAX_RECIPE_IMAGES }, (_, i) => ({
			path: `Recipe Attachments/rec-1/img${i}.webp`,
			alt: "",
			sourceUrl: null,
			isPrimary: i === 0,
		}));
		await expect(
			manager.addImage("rec-1", "extra.png", buffer, fullList),
		).rejects.toThrow(/at most 5 images/);

		// Adds image successfully with downscaling
		const added = await manager.addImage("rec-1", "test.jpg", buffer, []);
		expect(added.path).toContain("Recipe Attachments/rec-1/");
		expect(added.path.endsWith(".webp")).toBe(true);
		expect(added.isPrimary).toBe(true);
		expect(await vault.exists(added.path)).toBe(true);

		// Adds image without downscaling fallback
		const managerNullProc = new AttachmentManager(vault, nullProcessor, "Recipe Attachments");
		const addedJpg = await managerNullProc.addImage("rec-1", "plain.jpg", buffer, [added], {
			downscale: false,
		});
		expect(addedJpg.path.endsWith(".jpg")).toBe(true);
		expect(addedJpg.isPrimary).toBe(false);
	});

	it("inspects existing and missing images accurately", async () => {
		const vault = new InMemoryVault();
		const manager = new AttachmentManager(vault, dummyProcessor, "Recipe Attachments");
		const existingPath = "Recipe Attachments/rec-1/photo.webp";
		await vault.writeBinary(existingPath, new Uint8Array([1, 2, 3, 4]).buffer);

		const statuses = await manager.inspect([
			{ path: existingPath, alt: "Existing", sourceUrl: null, isPrimary: false },
			{ path: "Recipe Attachments/rec-1/missing.webp", alt: "Missing", sourceUrl: null, isPrimary: false },
		]);

		expect(statuses).toHaveLength(2);
		expect(statuses[0].missing).toBe(false);
		expect(statuses[0].bytes).toBe(4);
		expect(statuses[0].isPrimary).toBe(true);

		expect(statuses[1].missing).toBe(true);
		expect(statuses[1].bytes).toBeNull();
		expect(statuses[1].isPrimary).toBe(false);
	});
});
