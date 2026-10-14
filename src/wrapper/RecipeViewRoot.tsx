import { useEffect, useState } from "react";
import { usePluginServices } from "./WrapperContext";

export function RecipeViewRoot(): JSX.Element {
	const services = usePluginServices();
	const settings = services.getSettings();
	const [lastEvent, setLastEvent] = useState("Listening for vault changes…");

	useEffect(() => {
		return services.subscribeVaultChanges((event) => {
			const suffix = event.previousPath ? ` (from ${event.previousPath})` : "";
			setLastEvent(`${event.kind}: ${event.path}${suffix}`);
		});
	}, [services]);

	return (
		<div className="recipe-clipper-view">
			<h4>Recipe Manager</h4>
			<p className="recipe-clipper-view-note">
				Collection, capture, and shopping-list UI land in later Phase 1–2 tasks.
				React views talk to Obsidian only through PluginServiceAdapter.
			</p>
			<dl className="recipe-clipper-view-meta">
				<div>
					<dt>Recipes folder</dt>
					<dd>{settings.recipesFolder}</dd>
				</div>
				<div>
					<dt>Shopping lists folder</dt>
					<dd>{settings.shoppingListsFolder}</dd>
				</div>
			</dl>
			<p className="recipe-clipper-view-note" aria-live="polite">
				{lastEvent}
			</p>
			<button type="button" className="mod-cta" onClick={() => services.openSettings()}>
				Open settings
			</button>
		</div>
	);
}
