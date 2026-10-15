import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImageGalleryPicker } from "../../src/ui/components/ImageGalleryPicker";

describe("ImageGalleryPicker", () => {
	it("copies selected files before resetting the input", () => {
		const onAddFiles = vi.fn();
		render(
			<ImageGalleryPicker
				images={[]}
				resolveUrl={() => null}
				busy={false}
				error={null}
				onAddFiles={onAddFiles}
				onRemove={() => {}}
				onSetPrimary={() => {}}
				onAltChange={() => {}}
			/>,
		);
		const file = new File([new Uint8Array([1])], "food.png", { type: "image/png" });
		const input = document.getElementById("recipe-clipper-add-image") as HTMLInputElement;
		Object.defineProperty(input, "files", {
			configurable: true,
			value: {
				0: file,
				length: 1,
				item: () => file,
				*[Symbol.iterator]() {
					yield file;
				},
			},
		});
		fireEvent.change(input);
		expect(onAddFiles).toHaveBeenCalledTimes(1);
		expect(onAddFiles.mock.calls[0]?.[0]).toHaveLength(1);
	});
});
