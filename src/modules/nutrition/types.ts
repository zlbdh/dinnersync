import type { FoodState, Recipe } from "@/modules/recipe-import";

export type UnitConversion = {
  unit: string;
  gramsPerUnit: number;
  source: string;
};

export type WeightInput = {
  quantity: number | null;
  unit: string | null;
  sourceServings: number | null;
  targetServings: number;
  conversions?: readonly UnitConversion[];
};

export type ResolvedWeight = {
  resolved: true;
  sourceGrams: number;
  plannedGrams: number;
  original: Pick<WeightInput, "quantity" | "unit">;
  conversionSource: string;
};

export type UnresolvedWeight = {
  resolved: false;
  sourceGrams: null;
  plannedGrams: null;
  reason:
    | "invalid-quantity"
    | "invalid-source-servings"
    | "invalid-target-servings"
    | "invalid-unit"
    | "missing-volume-conversion"
    | "unsupported-unit"
    | "weight-overflow";
  original: Pick<WeightInput, "quantity" | "unit">;
};

export type WeightResolution = ResolvedWeight | UnresolvedWeight;

export type NutritionRecord = {
  id: string;
  canonicalName: string;
  aliases?: readonly string[];
  foodState: FoodState;
  kcalPer100g: number;
  sourceUrl: string;
  sourceVersion: string;
  accessedAt: string;
  unitConversions?: readonly UnitConversion[];
};

export type NutritionMatchKind =
  | "canonical-exact"
  | "alias-exact"
  | "normalized";

export type NutritionCandidate = {
  record: NutritionRecord;
  matchKind: NutritionMatchKind;
};

export type RecipeNutritionSummary = {
  recipeId: string;
  completeness: "complete" | "partial";
  knownKcal: number;
  estimatedKcal: number | null;
  unresolvedIngredientIds: string[];
};

export type NutritionSummary = {
  completeness: "complete" | "partial";
  knownMealKcal: number;
  knownKcalPerPerson: number;
  estimatedMealKcal: number | null;
  estimatedKcalPerPerson: number | null;
  targetDeltaPerPerson: number | null;
  unresolvedIngredientIds: string[];
  recipeSummaries: RecipeNutritionSummary[];
};

export type NutritionCalculationRequest = {
  recipes: readonly Recipe[];
  catalog: readonly NutritionRecord[];
  diners: number;
  targetKcalPerPerson: number | null;
};
