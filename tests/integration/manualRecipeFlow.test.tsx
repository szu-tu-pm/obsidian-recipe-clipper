import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RecipeImage } from "../../src/domain/schema/recipeSchema";
import { DEFAULT_SETTINGS } from "../../src/pluginSettings";
import { CollectionView } from "../../src/ui/CollectionView";
import { WrapperProvider } from "../../src/wrapper/WrapperContext";
import { createMockPluginServices, seedRecipe } from "../helpers/mockPluginServices";

afterEach(() => {
	cleanup();
});

function renderCollection(
	services: ReturnType<typeof createMockPluginServices> = createMockPluginServices(),
) {
	render(
		<WrapperProvider services={services}>
			<CollectionView />
		</WrapperProvider>,
	);
	return services;
}

function chooseImage(filename: string): void {
	const file = new File([new Uint8Array([1, 2, 3, 4])], filename, { type: "image/png" });
	const input = document.getElementById("recipe-clipper-add-image") as HTMLInputElement;
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
}

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

	it("deletes images attached in the editor when cancel is pressed before save", async () => {
		const services = renderCollection();
		fireEvent.click(screen.getByRole("button", { name: "New recipe" }));
		fireEvent.change(screen.getByLabelText("Title"), {
			target: { value: "Unsaved Soup" },
		});
		chooseImage("soup.png");
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Remove image" })).toBeTruthy();
		});

		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

		await waitFor(() => {
			expect(screen.queryByRole("dialog", { name: "New recipe" })).toBeNull();
		});
		expect(services.listRecipes()).toHaveLength(0);
		expect(services.getImageUrl("Recipes/_attachments/soup.png")).toBeNull();
		expect(services.removedImages).toEqual(["Recipes/_attachments/soup.png"]);
	});

	it("keeps images that were already saved when a later edit is cancelled", async () => {
		const existing: RecipeImage = {
			path: "Recipes/_attachments/existing.png",
			alt: "Existing cover",
			sourceUrl: null,
			isPrimary: true,
		};
		const recipe = seedRecipe("Tomato Soup");
		recipe.frontmatter.images = [existing];
		const services = renderCollection(
			createMockPluginServices({ recipes: [recipe], settings: { ...DEFAULT_SETTINGS } }),
		);

		fireEvent.click(screen.getByRole("button", { name: "Edit" }));
		await waitFor(() => {
			expect(screen.getByDisplayValue("Tomato Soup")).toBeTruthy();
		});
		chooseImage("extra.png");
		await waitFor(() => {
			expect(screen.getAllByRole("button", { name: "Remove image" })).toHaveLength(2);
		});

		fireEvent.keyDown(window, { key: "Escape" });

		await waitFor(() => {
			expect(screen.queryByRole("dialog", { name: "Edit recipe" })).toBeNull();
		});
		expect(services.listRecipes()[0]?.primaryImagePath).toBe(existing.path);
		expect(services.listRecipes()[0]?.title).toBe("Tomato Soup");
		expect(services.removedImages).toEqual(["Recipes/_attachments/extra.png"]);
	});

	it("closes the delete confirmation with Escape and leaves the recipe in place", async () => {
		const recipe = seedRecipe("Keep Me");
		const services = renderCollection(
			createMockPluginServices({ recipes: [recipe], settings: { ...DEFAULT_SETTINGS } }),
		);

		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		expect(screen.getByRole("dialog", { name: "Delete Keep Me?" })).toBeTruthy();
		fireEvent.keyDown(window, { key: "Escape" });

		await waitFor(() => {
			expect(screen.queryByRole("dialog", { name: "Delete Keep Me?" })).toBeNull();
		});
		expect(services.listRecipes()).toHaveLength(1);
		expect(services.removedImages).toEqual([]);
	});
});

