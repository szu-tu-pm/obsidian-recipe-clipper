import { createContext, useContext, useSyncExternalStore, type PropsWithChildren } from "react";
import type { RecipeIndexEntry } from "../domain/vault/recipeIndexer";
import type { RecipePluginSettings } from "../pluginSettings";
import type { PluginServices } from "./PluginServiceAdapter";

const WrapperContext = createContext<PluginServices | null>(null);

export function WrapperProvider({
	services,
	children,
}: PropsWithChildren<{ services: PluginServices }>): JSX.Element {
	return (
		<WrapperContext.Provider value={services}>{children}</WrapperContext.Provider>
	);
}

export function usePluginServices(): PluginServices {
	const services = useContext(WrapperContext);
	if (!services) {
		throw new Error("usePluginServices must be used within WrapperProvider.");
	}
	return services;
}

export function usePluginSettings(): RecipePluginSettings {
	const services = usePluginServices();
	return useSyncExternalStore(
		(onStoreChange) => services.subscribeSettings(onStoreChange),
		() => services.getSettings(),
	);
}

export function useRecipeIndex(): RecipeIndexEntry[] {
	const services = usePluginServices();
	return useSyncExternalStore(
		(onStoreChange) => services.subscribeRecipes(onStoreChange),
		() => services.listRecipes(),
	);
}
