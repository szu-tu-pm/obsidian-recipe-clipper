import { generateRecipeId, joinVaultPath, type RecipeImage } from "../schema/recipeSchema";
import type { ImageProcessor, VaultPort } from "./vaultPort";

export const MAX_RECIPE_IMAGES = 5;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_EDGE_PX = 2048;
export const WEBP_QUALITY = 0.85;
export const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "avif"] as const;

export type ImageExtension = (typeof IMAGE_EXTENSIONS)[number];

const MIME_BY_EXTENSION: Record<ImageExtension, string> = {
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
	avif: "image/avif",
};

export interface RecipeImageStatus extends RecipeImage {
	missing: boolean;
	bytes: number | null;
}

export class AttachmentError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AttachmentError";
	}
}

export function extensionOf(filename: string): string {
	const match = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
	return match?.[1] ?? "";
}

export function isAllowedImageExtension(ext: string): ext is ImageExtension {
	return (IMAGE_EXTENSIONS as readonly string[]).includes(ext);
}

export function isSafeAttachmentPath(imagePath: string, attachmentsFolder: string): boolean {
	if (!imagePath || typeof imagePath !== "string") {
		return false;
	}
	const cleanFolder = joinVaultPath(attachmentsFolder);
	const cleanPath = joinVaultPath(imagePath);
	if (!cleanFolder || !cleanPath) {
		return false;
	}
	const segments = cleanPath.split("/");
	if (segments.some((segment) => segment === ".." || segment === "." || segment === "")) {
		return false;
	}
	if (!cleanPath.startsWith(`${cleanFolder}/`)) {
		return false;
	}
	const ext = extensionOf(cleanPath);
	if (!isAllowedImageExtension(ext)) {
		return false;
	}
	return true;
}

export class AttachmentManager {
	constructor(
		private readonly vault: VaultPort,
		private readonly processor: ImageProcessor,
		private attachmentsFolder: string,
	) {}

	configure(attachmentsFolder: string): void {
		this.attachmentsFolder = attachmentsFolder;
	}

	folderFor(recipeId: string): string {
		return joinVaultPath(this.attachmentsFolder, recipeId);
	}

	async addImage(
		recipeId: string,
		filename: string,
		data: ArrayBuffer,
		existing: RecipeImage[],
		options: { downscale?: boolean; alt?: string; sourceUrl?: string | null } = {},
	): Promise<RecipeImage> {
		if (existing.length >= MAX_RECIPE_IMAGES) {
			throw new AttachmentError(`A recipe can have at most ${MAX_RECIPE_IMAGES} images.`);
		}
		if (data.byteLength > MAX_IMAGE_BYTES) {
			throw new AttachmentError(`Images must be ${MAX_IMAGE_BYTES / (1024 * 1024)} MB or smaller.`);
		}
		const ext = extensionOf(filename);
		if (!isAllowedImageExtension(ext)) {
			throw new AttachmentError(
				`Unsupported image type .${ext}. Use ${IMAGE_EXTENSIONS.join(", ")}.`,
			);
		}

		let bytes = data;
		let outExt: ImageExtension = ext;
		if (options.downscale !== false) {
			const converted = await this.processor.downscaleToWebp(
				data,
				MIME_BY_EXTENSION[ext],
				MAX_IMAGE_EDGE_PX,
				WEBP_QUALITY,
			);
			if (converted) {
				bytes = converted;
				outExt = "webp";
			}
		}
		if (bytes.byteLength > MAX_IMAGE_BYTES) {
			throw new AttachmentError("Downscaled image still exceeds the 10 MB limit.");
		}

		const folder = this.folderFor(recipeId);
		await this.vault.mkdir(folder);
		const path = joinVaultPath(folder, `${generateRecipeId().slice(4, 16)}.${outExt}`);
		await this.vault.writeBinary(path, bytes);
		return {
			path,
			alt: options.alt ?? "",
			sourceUrl: options.sourceUrl ?? null,
			isPrimary: existing.length === 0,
		};
	}

	async removeImage(image: RecipeImage): Promise<void> {
		if (!image?.path || typeof image.path !== "string") {
			throw new AttachmentError("Image path is required.");
		}
		if (!isSafeAttachmentPath(image.path, this.attachmentsFolder)) {
			throw new AttachmentError(
				`Refusing to delete image outside attachments folder: ${image.path}`,
			);
		}
		if (await this.vault.exists(image.path)) {
			await this.vault.remove(image.path);
		}
	}

	async inspect(images: RecipeImage[]): Promise<RecipeImageStatus[]> {
		const statuses: RecipeImageStatus[] = [];
		for (const [index, image] of images.entries()) {
			const exists = await this.vault.exists(image.path);
			let bytes: number | null = null;
			if (exists) {
				try {
					bytes = (await this.vault.readBinary(image.path)).byteLength;
				} catch {
					bytes = null;
				}
			}
			statuses.push({
				...image,
				isPrimary: index === 0,
				missing: !exists,
				bytes,
			});
		}
		return statuses;
	}
}
