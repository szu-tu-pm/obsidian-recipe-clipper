import type { IngredientDisagreement } from "./ingredientDisagreement";
import type { ExtractionMethod, RecipeDocument, RecipeIngredient } from "../schema/recipeSchema";

export interface CandidateImage {
	sourceUrl: string;
	alt: string;
}

export type MachineExtractionMethod = Exclude<ExtractionMethod, "manual">;

/** Fields copied from a page. Missing values stay null or empty. */
export interface ExtractedFields {
	title: string | null;
	ingredientsRaw: string[];
	instructions: string[];
	servingsRaw: string | null;
	prepTimeMinutes: number | null;
	cookTimeMinutes: number | null;
	totalTimeMinutes: number | null;
	cookingMethods: string[];
	author: string | null;
	siteName: string | null;
	sourceUrl: string | null;
	images: CandidateImage[];
	extractionMethod: MachineExtractionMethod;
}

export interface Attribution {
	sourceUrl: string | null;
	author: string | null;
	siteName: string | null;
}

export interface ExtractionCandidate {
	title: string;
	ingredientsRaw: string[];
	ingredients: RecipeIngredient[];
	instructions: string[];
	servings: { raw: string; amount: number | null } | null;
	prepTimeMinutes: number | null;
	cookTimeMinutes: number | null;
	totalTimeMinutes: number | null;
	cookingMethods: string[];
	candidateImages: CandidateImage[];
	attribution: Attribution;
	extractionMethod: MachineExtractionMethod;
	/** Ingredients where the structured data and the page's visible list differ. Empty when they agree or there is no visible list. */
	ingredientDisagreements: IngredientDisagreement[];
	draft: RecipeDocument;
}

export interface DuplicateMatch {
	id: string;
	sourceUrl: string;
	path?: string;
}

export interface ExistingSourceRecipe {
	id: string;
	sourceUrl: string | null;
	path?: string;
}

export type FallbackReason =
	| "inaccessible"
	| "video-only"
	| "paywalled"
	| "unparsed"
	| "cancelled";

export interface UrlExtractionSuccess {
	status: "extracted";
	succeeded: true;
	candidate: ExtractionCandidate;
	candidates: ExtractionCandidate[];
	duplicates: DuplicateMatch[];
	warnings: string[];
}

export interface UrlExtractionSelection {
	status: "needs-selection";
	succeeded: false;
	candidates: ExtractionCandidate[];
	duplicates: DuplicateMatch[];
	warnings: string[];
}

export interface UrlExtractionFallback {
	status: "manual-fallback";
	succeeded: false;
	reason: FallbackReason;
	draft: RecipeDocument;
	attribution: Attribution;
	duplicates: DuplicateMatch[];
	warnings: string[];
}

export type UrlExtractionResult =
	| UrlExtractionSuccess
	| UrlExtractionSelection
	| UrlExtractionFallback;

export function hasExtractedContent(fields: {
	ingredientsRaw: string[];
	instructions: string[];
}): boolean {
	return fields.ingredientsRaw.length > 0 || fields.instructions.length > 0;
}

export function isCompleteExtraction(fields: {
	ingredientsRaw: string[];
	instructions: string[];
}): boolean {
	return fields.ingredientsRaw.length > 0 && fields.instructions.length > 0;
}
