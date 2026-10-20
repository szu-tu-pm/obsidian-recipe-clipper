import { describe, expect, it } from "vitest";
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

describe("AttachmentManager", () => {
	it("correctly identifies safe vs unsafe attachment paths", () => {
		const folder = "Recipe Attachments";
		expect(isSafeAttachmentPath("Recipe Attachments/rec-123/img.webp", folder)).toBe(true);
		expect(isSafeAttachmentPath("Recipe Attachments/rec-123/img.png", folder)).toBe(true);
		expect(isSafeAttachmentPath("Recipe Attachments/rec-123/img.jpg", folder)).toBe(true);

		// Traversal attempts
		expect(isSafeAttachmentPath("Recipe Attachments/../Secrets.md", folder)).toBe(false);
		expect(isSafeAttachmentPath("Recipe Attachments/rec-123/../../Secrets.md", folder)).toBe(false);
		expect(isSafeAttachmentPath("../Secrets.md", folder)).toBe(false);

		// Outside folder
		expect(isSafeAttachmentPath("Notes/MyRecipe.md", folder)).toBe(false);
		expect(isSafeAttachmentPath("OtherFolder/photo.webp", folder)).toBe(false);

		// Disallowed extensions
		expect(isSafeAttachmentPath("Recipe Attachments/rec-123/script.sh", folder)).toBe(false);
		expect(isSafeAttachmentPath("Recipe Attachments/rec-123/recipe.md", folder)).toBe(false);
		expect(isSafeAttachmentPath("Recipe Attachments/rec-123/data.json", folder)).toBe(false);

		// Empty / invalid
		expect(isSafeAttachmentPath("", folder)).toBe(false);
	});

	it("prevents removeImage from deleting files outside the attachments folder", async () => {
		const vault = new InMemoryVault();
		await vault.write("Notes/ImportantNote.md", "Do not delete");
		await vault.write("Recipes/Pasta.md", "Pasta content");

		const manager = new AttachmentManager(vault, dummyProcessor, "Recipe Attachments");

		// Attempt to delete note outside attachments folder
		await expect(
			manager.removeImage({
				path: "Notes/ImportantNote.md",
				alt: "",
				sourceUrl: null,
				isPrimary: true,
			}),
		).rejects.toThrow(AttachmentError);

		// Verify note was NOT deleted
		expect(await vault.exists("Notes/ImportantNote.md")).toBe(true);
		expect(await vault.read("Notes/ImportantNote.md")).toBe("Do not delete");

		// Attempt path traversal
		await expect(
			manager.removeImage({
				path: "Recipe Attachments/../Recipes/Pasta.md",
				alt: "",
				sourceUrl: null,
				isPrimary: true,
			}),
		).rejects.toThrow(AttachmentError);

		expect(await vault.exists("Recipes/Pasta.md")).toBe(true);
	});

	it("removes images safely when they reside in the managed attachments folder", async () => {
		const vault = new InMemoryVault();
		const manager = new AttachmentManager(vault, dummyProcessor, "Recipe Attachments");
		const imagePath = "Recipe Attachments/rec-1/photo.webp";
		await vault.writeBinary(imagePath, new Uint8Array([1, 2, 3]).buffer);

		expect(await vault.exists(imagePath)).toBe(true);

		await manager.removeImage({
			path: imagePath,
			alt: "Test photo",
			sourceUrl: null,
			isPrimary: true,
		});

		expect(await vault.exists(imagePath)).toBe(false);
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
