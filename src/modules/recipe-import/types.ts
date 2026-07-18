import type { ResourceRequirement } from "@/shared";

export type EvidenceSpan = {
  start: number;
  end: number;
  text: string;
};

export type ReviewValue<T> = {
  value: T;
  provenance: "source" | "inferred";
  evidence: EvidenceSpan | null;
  inferenceReason: string | null;
  confidence: number;
  status: "needs-review" | "confirmed";
};

export type FoodState = "raw" | "cooked" | "other";
export type OvenOperation = "preheat" | "cook" | "temperature-change";

export type IngredientDraft = {
  id: string;
  sourceText: string;
  name: ReviewValue<string>;
  quantity: ReviewValue<number | null>;
  unit: ReviewValue<string | null>;
  foodState: ReviewValue<FoodState | null>;
};

export type CookingStepDraft = {
  id: string;
  sourceText: string;
  instruction: ReviewValue<string>;
  durationMinutes: ReviewValue<number>;
  mode: ReviewValue<"active" | "passive">;
  dependsOn: ReviewValue<string[]>;
  resources: ReviewValue<ResourceRequirement[]>;
  ovenOperation: ReviewValue<OvenOperation | null>;
  ovenTemperatureC: ReviewValue<number | null>;
  isTerminal: ReviewValue<boolean>;
};

export type RecipeDraft = {
  id: string;
  sourceText: string;
  name: ReviewValue<string>;
  sourceServings: ReviewValue<number | null>;
  ingredients: IngredientDraft[];
  steps: CookingStepDraft[];
};

export type Ingredient = {
  id: string;
  sourceText: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  foodState: FoodState | null;
  sourceGrams: number | null;
  plannedGrams: number | null;
  nutritionRefId: string | null;
  nutritionMatchStatus: "confirmed" | "unresolved";
  status: "used" | "omitted";
};

export type CookingStep = {
  id: string;
  recipeId: string;
  sourceText: string;
  instruction: string;
  durationMinutes: number;
  mode: "active" | "passive";
  dependsOn: string[];
  resources: ResourceRequirement[];
  ovenOperation: OvenOperation | null;
  ovenTemperatureC: number | null;
  isTerminal: boolean;
};

export type Recipe = {
  id: string;
  name: string;
  sourceText: string;
  sourceServings: number | null;
  targetServings: number;
  ingredients: Ingredient[];
  steps: CookingStep[];
};

export type ReviewIssue = {
  path: string;
  code: string;
  message: string;
};

export type IngredientReviewDecision = {
  ingredientId: string;
  status: "used" | "omitted" | null;
  sourceGrams: number | null;
  plannedGrams: number | null;
  nutritionRefId: string | null;
  nutritionMatchStatus: "confirmed" | "unresolved";
};

export type RecipeReviewState = {
  draft: RecipeDraft;
  targetServings: number;
  ingredientDecisions: IngredientReviewDecision[];
};

export type ReviewFieldTarget =
  | { scope: "recipe"; field: "name" | "sourceServings" }
  | {
    scope: "ingredient";
    id: string;
    field: "name" | "quantity" | "unit" | "foodState";
  }
  | {
    scope: "step";
    id: string;
    field: keyof Pick<CookingStepDraft,
      | "instruction"
      | "durationMinutes"
      | "mode"
      | "dependsOn"
      | "resources"
      | "ovenOperation"
      | "ovenTemperatureC"
      | "isTerminal">;
  };

export type RecipeReviewAction =
  | { type: "confirm-field"; target: ReviewFieldTarget }
  | { type: "edit-field"; target: ReviewFieldTarget; value: unknown; reason?: string }
  | { type: "set-target-servings"; value: number }
  | {
    type: "set-ingredient-status";
    ingredientId: string;
    status: "used" | "omitted";
  }
  | {
    type: "confirm-nutrition";
    ingredientId: string;
    nutritionRefId: string;
    sourceGrams: number;
    plannedGrams: number;
  };
