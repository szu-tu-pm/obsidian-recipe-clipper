import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttachmentError } from "../../src/domain/vault/attachmentManager";
import { RecipeEditorModal } from "../../src/ui/RecipeEditorModal";
import { createMockPluginServices, seedRecipe } from "../helpers/mockPluginServices";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("RecipeEditorModal image removal", () => {
	it("shows a deletion refusal and keeps the image in the editor", async () => {
		const path = "Notes/ImportantNote.md";
		const recipe = seedRecipe("Protected image reference");
		recipe.frontmatter.images = [
			{ path, alt: "Unsafe reference", sourceUrl: null, isPrimary: true },
		];
		const services = createMockPluginServices();
		vi.spyOn(services, "removeRecipeImage").mockRejectedValue(
			new AttachmentError(`Refusing to delete image outside attachments folder: ${path}`),
		);

		render(<RecipeEditorModal services={services} initial={recipe} onClose={() => {}} />);
		fireEvent.click(screen.getByRole("button", { name: "Remove image" }));

		expect((await screen.findByRole("alert")).textContent).toContain(
			"Refusing to delete image outside attachments folder",
		);
		await waitFor(() =>
			expect(
				(screen.getByRole("button", { name: "Remove image" }) as HTMLButtonElement).disabled,
			).toBe(false),
		);
		expect(screen.getByText("1 of 5 attached. Local files only, 10 MB each.")).toBeTruthy();
	});
});
