import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createShoppingListFromRecipes } from "../../src/domain/schema/shoppingListSchema";
import { DEFAULT_SETTINGS } from "../../src/pluginSettings";
import { CollectionView } from "../../src/ui/CollectionView";
import { WrapperProvider } from "../../src/wrapper/WrapperContext";
import { createMockPluginServices, seedRecipe } from "../helpers/mockPluginServices";

afterEach(() => {
	cleanup();
});

function list(title: string) {
	const draft = createShoppingListFromRecipes([seedRecipe(title)]);
	return {
		...draft,
		path: `Shopping Lists/${title}.md`,
		frontmatter: { ...draft.frontmatter, id: `list_${title}`, title },
	};
}

function setup(titles: string[]) {
	const services = createMockPluginServices({
		recipes: [seedRecipe("Soup")],
		settings: { ...DEFAULT_SETTINGS },
		shoppingLists: titles.map(list),
	});
	const view = render(
		<WrapperProvider services={services}>
			<CollectionView />
		</WrapperProvider>,
	);
	return { services, ...view };
}

describe("saved shopping lists follow the lists folder", () => {
	it("drops a list whose file was deleted outside the plugin", async () => {
		const { services } = setup(["Monday", "Friday"]);
		await screen.findByRole("button", { name: "Open shopping list list_Monday" });

		services.shoppingLists.splice(0, 1);
		await act(async () => {
			services.emitVaultChange({ kind: "delete", path: "Shopping Lists/Monday.md" });
		});

		await waitFor(() =>
			expect(screen.queryByRole("button", { name: "Open shopping list list_Monday" })).toBeNull(),
		);
		expect(screen.getByRole("button", { name: "Open shopping list list_Friday" })).toBeTruthy();
	});

	it("shows a list file added outside the plugin", async () => {
		const { services } = setup(["Monday"]);
		await screen.findByRole("button", { name: "Open shopping list list_Monday" });

		services.shoppingLists.push(list("Saturday"));
		await act(async () => {
			services.emitVaultChange({ kind: "create", path: "Shopping Lists/Saturday.md" });
		});

		expect(
			await screen.findByRole("button", { name: "Open shopping list list_Saturday" }),
		).toBeTruthy();
	});

	it("shows the new title after a rename inside the folder", async () => {
		const { services } = setup(["Monday"]);
		await screen.findByText("Monday");

		services.shoppingLists[0] = {
			...services.shoppingLists[0],
			frontmatter: { ...services.shoppingLists[0].frontmatter, title: "Weekday" },
		};
		await act(async () => {
			services.emitVaultChange({
				kind: "rename",
				path: "Shopping Lists/Weekday.md",
				previousPath: "Shopping Lists/Monday.md",
			});
		});

		expect(await screen.findByText("Weekday")).toBeTruthy();
		expect(screen.queryByText("Monday")).toBeNull();
	});

	it("handles a file moved out of the folder and one moved in", async () => {
		const { services } = setup(["Monday"]);
		await screen.findByText("Monday");

		const moved = services.shoppingLists.splice(0, 1);
		await act(async () => {
			services.emitVaultChange({
				kind: "rename",
				path: "Archive/Monday.md",
				previousPath: "Shopping Lists/Monday.md",
			});
		});
		await waitFor(() => expect(screen.queryByText("Monday")).toBeNull());

		services.shoppingLists.push(...moved);
		await act(async () => {
			services.emitVaultChange({
				kind: "rename",
				path: "Shopping Lists/Monday.md",
				previousPath: "Archive/Monday.md",
			});
		});
		expect(await screen.findByText("Monday")).toBeTruthy();
	});

	it("ignores events for paths outside the lists folder", async () => {
		const { services } = setup(["Monday"]);
		await screen.findByText("Monday");

		let reads = 0;
		const original = services.listShoppingLists;
		services.listShoppingLists = async () => {
			reads += 1;
			return original();
		};
		await act(async () => {
			services.emitVaultChange({ kind: "modify", path: "Recipes/Soup.md" });
			services.emitVaultChange({ kind: "delete", path: "Shopping Lists Old/x.md" });
			services.emitVaultChange({ kind: "rename", path: "Notes/b.md", previousPath: "Notes/a.md" });
			services.emitVaultChange({ kind: "metadata", path: "Shopping Lists/Monday.md" });
		});
		expect(reads).toBe(0);
	});

	it("unsubscribes from vault changes when the view unmounts", async () => {
		const { services, unmount } = setup(["Monday"]);
		await screen.findByText("Monday");
		expect(services.vaultListenerCount()).toBe(1);

		unmount();
		expect(services.vaultListenerCount()).toBe(0);
	});

	it("shows a visible message when a listed file has gone and then drops the entry", async () => {
		const { services } = setup(["Monday"]);
		await screen.findByText("Monday");

		// The file vanished but no vault event reached the view.
		services.shoppingLists.splice(0, 1);
		fireEvent.click(screen.getByRole("button", { name: "Open shopping list list_Monday" }));

		const message = await screen.findByRole("status");
		expect(message.textContent).toContain('The shopping list "Monday" could not be opened');
		await waitFor(() => expect(screen.queryByText("Monday")).toBeNull());
	});
});
