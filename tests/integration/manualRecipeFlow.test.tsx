import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/pluginSettings";
import { CollectionView } from "../../src/ui/CollectionView";
import { WrapperProvider } from "../../src/wrapper/WrapperContext";
import { createMockPluginServices, seedRecipe } from "../helpers/mockPluginServices";

afterEach(() => {
	cleanup();
});

describe("manual recipe flow", () => {
	it("creates, rates, attaches an image, saves, reopens, edits rating, and removes the image", async () => {
		const services = createMockPluginServices();
		render(
			<WrapperProvider services={services}>
				<CollectionView />
			</WrapperProvider>,
		);

		fireEvent.click(screen.getByRole("button", { name: "New recipe" }));
		fireEvent.change(screen.getByLabelText("Title"), {
			target: { value: "Weeknight Pasta" },
		});
		fireEvent.change(screen.getByLabelText("Ingredients (one per line)"), {
			target: { value: "8 oz pasta\nsalt to taste" },
		});
		fireEvent.change(screen.getByLabelText("Instructions (one step per line)"), {
			target: { value: "Boil water\nCook pasta" },
		});
		fireEvent.click(screen.getByRole("button", { name: "4 stars" }));

		const file = new File([new Uint8Array([1, 2, 3, 4])], "pasta.png", {
			type: "image/png",
		});
		const input = document.getElementById(
			"recipe-clipper-add-image",
		) as HTMLInputElement;
		expect(input).toBeInstanceOf(HTMLInputElement);
		Object.defineProperty(input, "files", {
			configurable: true,
			value: {
				0: file,
				length: 1,
				item: (index: number) => (index === 0 ? file : null),
				*[Symbol.iterator]() {
					yield file;
				},
			},
		});
		fireEvent.change(input);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Remove image" })).toBeTruthy();
		});

		fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Weeknight Pasta" })).toBeTruthy();
			expect(document.querySelector(".recipe-clipper-rating-badge")?.textContent).toBe(
				"4 stars",
			);
		});

		fireEvent.click(screen.getByRole("button", { name: "Weeknight Pasta" }));
		await waitFor(() => {
			expect(screen.getByDisplayValue("Weeknight Pasta")).toBeTruthy();
		});

		fireEvent.click(screen.getByRole("button", { name: "Unrated" }));
		fireEvent.click(screen.getByRole("button", { name: "Remove image" }));
		await waitFor(() => {
			expect(screen.queryByRole("button", { name: "Remove image" })).toBeNull();
		});
		fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
		await waitFor(() => {
			expect(screen.queryByRole("dialog", { name: "Edit recipe" })).toBeNull();
		});

		await waitFor(() => {
			expect(document.querySelector(".recipe-clipper-rating-badge")?.textContent).toBe(
				"Unrated",
			);
		});
		expect(services.listRecipes()[0]?.primaryImagePath).toBeNull();
		expect(services.listRecipes()[0]?.rating).toBeNull();
	});

	it("asks before delete and does not mention rewriting shopping lists as a side effect", async () => {
		const recipe = seedRecipe("Keep Lists");
		const services = createMockPluginServices({
			recipes: [recipe],
			settings: { ...DEFAULT_SETTINGS },
		});
		render(
			<WrapperProvider services={services}>
				<CollectionView />
			</WrapperProvider>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		expect(
			screen.getByText(
				"This removes the recipe note and its attachments. Existing shopping lists are not changed.",
			),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Delete recipe" }));
		await waitFor(() => {
			expect(services.listRecipes()).toHaveLength(0);
		});
	});
});

