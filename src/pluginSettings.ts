export interface RecipePluginSettings {
	recipesFolder: string;
	shoppingListsFolder: string;
	attachmentsFolder: string;
	ollamaEndpoint: string;
	ollamaModel: string;
	ollamaLightweightModel: string;
	ollamaTimeoutMs: number;
	ollamaHealthCheckMs: number;
}

export const DEFAULT_SETTINGS: RecipePluginSettings = {
	recipesFolder: "Recipes",
	shoppingListsFolder: "Shopping Lists",
	attachmentsFolder: "Recipes/_attachments",
	ollamaEndpoint: "http://127.0.0.1:11434",
	ollamaModel: "qwen2.5:7b-instruct",
	ollamaLightweightModel: "llama3.2:3b-instruct",
	ollamaTimeoutMs: 25_000,
	ollamaHealthCheckMs: 1_500,
};
