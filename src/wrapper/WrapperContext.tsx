import { createContext, useContext, type PropsWithChildren } from "react";
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
