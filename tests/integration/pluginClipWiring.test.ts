import { afterEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => {
	class TFile {
		constructor(public path: string) {}
	}
	class TFolder {
		children: unknown[] = [];
		constructor(public path: string) {}
	}
	class Plugin {
		readonly registered: Array<{ source: string; name: string }> = [];
		constructor(
			public app: unknown,
			public manifest: { id: string },
		) {}
		registerEvent(ref: { source: string; name: string }): void {
			this.registered.push(ref);
		}
		registerView(): void {}
		addSettingTab(): void {}
		addRibbonIcon(): void {}
		addCommand(): void {}
		async loadData(): Promise<null> {
			return null;
		}
		async saveData(): Promise<void> {}
	}
	return { TFile, TFolder, Plugin };
});

vi.mock("obsidian", () => ({
	Plugin: fakes.Plugin,
	TFile: fakes.TFile,
	TFolder: fakes.TFolder,
	ItemView: class {},
	PluginSettingTab: class {},
	Setting: class {},
	Notice: class {},
	normalizePath: (path: string) => path.replace(/\/+/g, "/").replace(/^\/+|\/+$/g, ""),
	parseYaml: (text: string) => JSON.parse(text),
	stringifyYaml: (value: unknown) => JSON.stringify(value),
}));

import RecipePlugin from "../../src/main";

type Frontmatter = Record<string, unknown> | null;
type Handler = (...args: unknown[]) => unknown;

const CLIP = { schemaVersion: 2, type: "recipe-clip", title: "Black Bean Chili" };

function createApp(initial: Record<string, Frontmatter>) {
	const files = new Map<string, InstanceType<typeof fakes.TFile>>();
	const frontmatter = new Map<string, Frontmatter>();
	const folders = new Set<string>();
	const cacheHandlers: Array<{ source: string; name: string; cb: Handler }> = [];
	const layoutCallbacks: Array<() => void> = [];
	const add = (path: string, value: Frontmatter) => {
		const file = new fakes.TFile(path);
		files.set(path, file);
		frontmatter.set(path, value);
		return file;
	};
	for (const [path, value] of Object.entries(initial)) {
		add(path, value);
	}
	const app = {
		vault: {
			getMarkdownFiles: () => [...files.values()],
			getAbstractFileByPath: (path: string) =>
				files.get(path) ?? (folders.has(path) ? new fakes.TFolder(path) : null),
			createFolder: async (path: string) => {
				folders.add(path);
			},
			read: async () => "",
			on: (name: string) => ({ source: "vault", name }),
			offref: () => {},
			getResourcePath: () => "",
		},
		metadataCache: {
			getFileCache: (file: { path: string }) => {
				const value = frontmatter.get(file.path);
				return value === undefined ? null : { frontmatter: value ?? undefined };
			},
			on: (name: string, cb: Handler) => {
				const ref = { source: "metadataCache", name, cb };
				cacheHandlers.push(ref);
				return ref;
			},
			offref: (ref: unknown) => {
				const index = cacheHandlers.indexOf(ref as (typeof cacheHandlers)[number]);
				if (index !== -1) {
					cacheHandlers.splice(index, 1);
				}
			},
		},
		workspace: {
			layoutReady: false,
			onLayoutReady: (cb: () => void) => {
				layoutCallbacks.push(cb);
			},
			getLeavesOfType: () => [],
		},
	};
	return {
		app,
		cacheHandlers,
		add,
		trigger(name: string, ...args: unknown[]) {
			for (const handler of [...cacheHandlers]) {
				if (handler.name === name) {
					handler.cb(...args);
				}
			}
		},
		async layoutReady() {
			app.workspace.layoutReady = true;
			for (const cb of layoutCallbacks) {
				cb();
			}
			await flush();
		},
		/** The `changed` event Obsidian sends once a new file's frontmatter is parsed. */
		parsed(path: string, value: Frontmatter) {
			const file = add(path, value);
			this.trigger("changed", file, "", { frontmatter: value ?? undefined });
		},
	};
}

async function flush(): Promise<void> {
	for (let i = 0; i < 5; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

async function load(initial: Record<string, Frontmatter>) {
	const env = createApp(initial);
	const opened = vi.spyOn(RecipePlugin.prototype, "activateView").mockResolvedValue();
	const plugin = new RecipePlugin(env.app as never, { id: "obsidian-recipe-clipper" } as never);
	await plugin.onload();
	return { env, plugin, opened };
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("plugin web-clip wiring", () => {
	it("opens the review view once for a clip already in the vault, after the layout is ready", async () => {
		const { env, opened } = await load({ "Recipes/Black Bean Chili 2026.md": CLIP });
		env.trigger("resolved");
		expect(opened).not.toHaveBeenCalled();

		await env.layoutReady();
		expect(opened).toHaveBeenCalledTimes(1);

		env.trigger("resolved");
		env.trigger("resolved");
		env.trigger("changed", new fakes.TFile("Recipes/Black Bean Chili 2026.md"), "", { frontmatter: CLIP });
		await flush();
		expect(opened).toHaveBeenCalledTimes(1);
	});

	it("opens the view once when a new clip's frontmatter is parsed", async () => {
		const { env, opened } = await load({});
		await env.layoutReady();
		expect(opened).not.toHaveBeenCalled();

		env.parsed("Recipes/Flatbread 2026.md", CLIP);
		expect(opened).toHaveBeenCalledTimes(1);

		env.trigger("changed", new fakes.TFile("Recipes/Flatbread 2026.md"), "", { frontmatter: CLIP });
		env.trigger("resolved");
		env.trigger("resolved");
		await flush();
		expect(opened).toHaveBeenCalledTimes(1);

		env.parsed("Recipes/Second 2026.md", CLIP);
		expect(opened).toHaveBeenCalledTimes(2);
	});

	it("ignores recipes, unrelated notes, malformed frontmatter and clips outside the recipes folder", async () => {
		const { env, opened } = await load({
			"Recipes/chili.md": { schemaVersion: 2, type: "recipe" },
			"Inbox/clip.md": CLIP,
			"Recipes/_attachments/clip.md": CLIP,
			"Recipes/broken.md": null,
		});
		await env.layoutReady();
		env.parsed("Recipes/notes.md", { tags: ["food"] });
		env.parsed("Recipes/empty.md", null);
		env.parsed("Elsewhere/clip.md", CLIP);
		env.trigger("changed", new fakes.TFile("Recipes/odd.md"), "", {});
		env.trigger("resolved");
		await flush();
		expect(opened).not.toHaveBeenCalled();
	});

	it("opens a clip whose frontmatter is only parsed after the layout is ready, on resolved", async () => {
		const { env, opened } = await load({ "Recipes/Late 2026.md": null });
		await env.layoutReady();
		expect(opened).not.toHaveBeenCalled();
		// Obsidian finishes its first metadata pass: the cache now has the clip's frontmatter.
		env.add("Recipes/Late 2026.md", CLIP);
		env.trigger("resolved");
		expect(opened).toHaveBeenCalledTimes(1);
		env.trigger("resolved");
		expect(opened).toHaveBeenCalledTimes(1);
	});

	it("does not open anything before the layout is ready", async () => {
		const { env, opened } = await load({});
		env.parsed("Recipes/Early 2026.md", CLIP);
		env.trigger("resolved");
		expect(opened).not.toHaveBeenCalled();
		await env.layoutReady();
		expect(opened).toHaveBeenCalledTimes(1);
	});

	it("registers its own metadata listeners, and without them a new clip opens nothing", async () => {
		const { env, plugin, opened } = await load({});
		const registered = (plugin as unknown as { registered: Array<{ source: string; name: string }> })
			.registered.filter((ref) => ref.source === "metadataCache")
			.map((ref) => ref.name)
			.sort();
		expect(registered).toEqual(["changed", "resolved"]);

		await env.layoutReady();
		env.parsed("Recipes/Seen 2026.md", CLIP);
		expect(opened).toHaveBeenCalledTimes(1);
		// Mutation: drop the listeners the plugin registered, as if the registration were removed.
		for (const ref of (plugin as unknown as { registered: unknown[] }).registered) {
			env.app.metadataCache.offref(ref);
		}
		env.parsed("Recipes/Unseen 2026.md", CLIP);
		env.trigger("resolved");
		await flush();
		// The count stays at 1: the second clip is only noticed through those listeners.
		expect(opened).toHaveBeenCalledTimes(1);
	});
});
