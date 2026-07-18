import type { Ingredient, Recipe } from "@/modules/recipe-import";

import { indexNutritionCatalog } from "./catalog";
import type {
  NutritionCalculationRequest,
  NutritionRecord,
  NutritionSummary,
  RecipeNutritionSummary,
} from "./types";

const WEIGHT_TOLERANCE = 0.000_001;

function roundKcal(value: number) {
  return Math.round((value + Math.sign(value) * Number.EPSILON) * 100) / 100;
}

function isPositiveFinite(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function hasReliableWeight(recipe: Recipe, ingredient: Ingredient) {
  if (!isPositiveFinite(recipe.sourceServings)
    || !isPositiveFinite(recipe.targetServings)
    || !isPositiveFinite(ingredient.sourceGrams)
    || !isPositiveFinite(ingredient.plannedGrams)) {
    return false;
  }
  const expected = ingredient.sourceGrams
    * recipe.targetServings
    / recipe.sourceServings;
  return Math.abs(expected - ingredient.plannedGrams) <= WEIGHT_TOLERANCE;
}

function resolveIngredientKcal(
  recipe: Recipe,
  ingredient: Ingredient,
  catalog: ReadonlyMap<string, NutritionRecord>,
) {
  if (!hasReliableWeight(recipe, ingredient)
    || ingredient.nutritionMatchStatus !== "confirmed"
    || ingredient.foodState === null
    || typeof ingredient.nutritionRefId !== "string"
    || ingredient.nutritionRefId.trim() === "") {
    return null;
  }
  const record = catalog.get(ingredient.nutritionRefId);
  if (!record || record.foodState !== ingredient.foodState) return null;
  return (ingredient.plannedGrams as number) / 100 * record.kcalPer100g;
}

function calculateRecipe(
  recipe: Recipe,
  catalog: ReadonlyMap<string, NutritionRecord>,
) {
  let knownKcal = 0;
  const unresolvedIngredientIds: string[] = [];
  for (const ingredient of recipe.ingredients) {
    if (ingredient.status === "omitted") continue;
    if (ingredient.status !== "used") {
      unresolvedIngredientIds.push(ingredient.id);
      continue;
    }
    const ingredientKcal = resolveIngredientKcal(recipe, ingredient, catalog);
    if (ingredientKcal === null) unresolvedIngredientIds.push(ingredient.id);
    else knownKcal += ingredientKcal;
  }
  return { knownKcal, unresolvedIngredientIds };
}

function recipeSummary(
  recipe: Recipe,
  knownKcal: number,
  unresolvedIngredientIds: string[],
): RecipeNutritionSummary {
  const complete = unresolvedIngredientIds.length === 0;
  return {
    recipeId: recipe.id,
    completeness: complete ? "complete" : "partial",
    knownKcal: roundKcal(knownKcal),
    estimatedKcal: complete ? roundKcal(knownKcal) : null,
    unresolvedIngredientIds,
  };
}

export function calculateNutrition(
  request: NutritionCalculationRequest,
): NutritionSummary {
  if (!Number.isSafeInteger(request.diners) || request.diners <= 0) {
    throw new RangeError("diners must be a positive safe integer");
  }
  const catalog = indexNutritionCatalog(request.catalog);
  let knownMealKcalRaw = 0;
  const unresolvedIngredientIds: string[] = [];
  const recipeSummaries = request.recipes.map((recipe) => {
    const result = calculateRecipe(recipe, catalog);
    knownMealKcalRaw += result.knownKcal;
    unresolvedIngredientIds.push(...result.unresolvedIngredientIds);
    return recipeSummary(recipe, result.knownKcal, result.unresolvedIngredientIds);
  });

  const complete = unresolvedIngredientIds.length === 0;
  const knownMealKcal = roundKcal(knownMealKcalRaw);
  const knownKcalPerPerson = roundKcal(knownMealKcalRaw / request.diners);
  const estimatedMealKcal = complete ? knownMealKcal : null;
  const estimatedKcalPerPerson = complete ? knownKcalPerPerson : null;
  const targetDeltaPerPerson = complete && request.targetKcalPerPerson !== null
    ? roundKcal(knownMealKcalRaw / request.diners - request.targetKcalPerPerson)
    : null;

  return {
    completeness: complete ? "complete" : "partial",
    knownMealKcal,
    knownKcalPerPerson,
    estimatedMealKcal,
    estimatedKcalPerPerson,
    targetDeltaPerPerson,
    unresolvedIngredientIds,
    recipeSummaries,
  };
}
