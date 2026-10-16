import { Notice } from "obsidian";
import { CollectionView } from "../ui/CollectionView";

export function RecipeViewRoot(): JSX.Element {
	return <CollectionView notify={(message) => new Notice(message)} />;
}
