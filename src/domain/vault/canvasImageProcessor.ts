import type { ImageProcessor } from "./vaultPort";

export const canvasImageProcessor: ImageProcessor = {
	async downscaleToWebp(data, mime, maxPx, quality) {
		if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
			return null;
		}
		let bitmap: ImageBitmap;
		try {
			bitmap = await createImageBitmap(new Blob([data], { type: mime }));
		} catch {
			return null;
		}
		try {
			const longest = Math.max(bitmap.width, bitmap.height);
			const scale = longest > maxPx ? maxPx / longest : 1;
			if (scale === 1 && mime === "image/webp") {
				return null;
			}
			const canvas = document.createElement("canvas");
			canvas.width = Math.max(1, Math.round(bitmap.width * scale));
			canvas.height = Math.max(1, Math.round(bitmap.height * scale));
			const context = canvas.getContext("2d");
			if (!context) {
				return null;
			}
			context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
			const blob = await new Promise<Blob | null>((resolve) => {
				canvas.toBlob(resolve, "image/webp", quality);
			});
			if (!blob) {
				return null;
			}
			return blob.arrayBuffer();
		} finally {
			bitmap.close();
		}
	},
};
