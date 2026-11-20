export interface RecipeFields {
  title: string;
  publisher?: string;
  authors?: string[];
  credit?: string;
  yield?: { servings?: number; text?: string };
  timing?: {
    prepMinutes?: number;
    cookMinutes?: number;
    totalMinutes?: number;
    passive?: { activity: string; durationText: string }[];
  };
  ingredients: string[];
  steps: string[];
  notes?: string[];
}

export interface RecipeVariation {
  key: string;
  title: string;
  ingredients: string[];
  steps: string[];
}

export interface RecipeDraftData {
  key: string;
  url: string;
  fields: RecipeFields;
  variations: RecipeVariation[];
  unassigned?: { ingredients: string[]; steps: string[] };
  timingConflict?: { listedMinutes: number; minimumMinutes: number; step: string };
}

export interface RecipeDraft extends RecipeDraftData {
  id: string;
  revision: number;
  selectedVariations: string[];
  reviewedUnassigned: boolean;
}

export interface RecipeApproval {
  id: string;
  revision: number;
  fields: RecipeFields;
  selectedVariations: string[];
  reviewedUnassigned: boolean;
}

export interface RecipeExport {
  schemaVersion: 1;
  recipes: {
    key: string;
    title: string;
    source: { url: string; publisher?: string; authors?: string[]; credit?: string };
    yield?: RecipeFields['yield'];
    timing?: RecipeFields['timing'];
    ingredients: string[];
    steps: string[];
    notes?: string[];
    variations?: RecipeVariation[];
  }[];
}
