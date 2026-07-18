import {
  parseRecipeDraft,
} from "@/modules/recipe-import";
import type {
  IngredientReviewDecision,
  RecipeDraft,
  RecipeReviewState,
} from "@/modules/recipe-import";
import { parseIsoInstant } from "@/shared";

import type { DinnerPlanSettings } from "./types";

const SETTINGS_KEYS = [
  "diners",
  "availableFrom",
  "serveAt",
  "targetKcalPerPerson",
  "kitchen",
  "serveToleranceMinutes",
] as const;
const KITCHEN_KEYS = ["cooks", "ovens", "burners"] as const;
const REVIEW_KEYS = ["draft", "targetServings", "ingredientDecisions"] as const;
const DECISION_KEYS = [
  "ingredientId",
  "status",
  "sourceGrams",
  "plannedGrams",
  "nutritionRefId",
  "nutritionMatchStatus",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function validDinnerPlanSettings(
  value: unknown,
): value is DinnerPlanSettings {
  if (!isRecord(value) || !exactKeys(value, SETTINGS_KEYS)
    || !positiveSafeInteger(value.diners)
    || typeof value.availableFrom !== "string"
    || typeof value.serveAt !== "string"
    || !parseIsoInstant(value.availableFrom).ok
    || !parseIsoInstant(value.serveAt).ok
    || (value.targetKcalPerPerson !== null
      && !positiveFinite(value.targetKcalPerPerson))
    || value.serveToleranceMinutes !== 5
    || !isRecord(value.kitchen)
    || !exactKeys(value.kitchen, KITCHEN_KEYS)) return false;
  return value.kitchen.cooks === 1
    && value.kitchen.ovens === 1
    && (value.kitchen.burners === 1 || value.kitchen.burners === 2);
}

function validDecision(
  value: unknown,
  ingredients: ReadonlyMap<string, RecipeDraft["ingredients"][number]>,
): value is IngredientReviewDecision {
  if (!isRecord(value) || !exactKeys(value, DECISION_KEYS)
    || typeof value.ingredientId !== "string"
    || !ingredients.has(value.ingredientId)
    || (value.status !== null && value.status !== "used" && value.status !== "omitted")
    || (value.nutritionMatchStatus !== "confirmed"
      && value.nutritionMatchStatus !== "unresolved")) return false;
  if (value.nutritionMatchStatus === "unresolved") {
    return value.sourceGrams === null
      && value.plannedGrams === null
      && value.nutritionRefId === null;
  }
  return value.status === "used"
    && positiveFinite(value.sourceGrams)
    && positiveFinite(value.plannedGrams)
    && typeof value.nutritionRefId === "string"
    && value.nutritionRefId.trim() !== ""
    && ingredients.get(value.ingredientId)?.foodState.value !== null;
}

function validReviewState(value: unknown): value is RecipeReviewState {
  if (!isRecord(value) || !exactKeys(value, REVIEW_KEYS)
    || !positiveSafeInteger(value.targetServings)
    || !Array.isArray(value.ingredientDecisions)) return false;
  const parsed = parseRecipeDraft(value.draft);
  if (!parsed.ok) return false;
  const ingredientIds = parsed.value.ingredients.map((ingredient) => ingredient.id);
  if (new Set(ingredientIds).size !== ingredientIds.length
    || value.ingredientDecisions.length !== ingredientIds.length) return false;
  const ingredients = new Map(parsed.value.ingredients.map((ingredient) => [
    ingredient.id,
    ingredient,
  ]));
  const seen = new Set<string>();
  for (const decision of value.ingredientDecisions) {
    if (!validDecision(decision, ingredients) || seen.has(decision.ingredientId)) {
      return false;
    }
    seen.add(decision.ingredientId);
  }
  return ingredientIds.every((id) => seen.has(id));
}

export function validRecipeReviewStates(
  value: unknown,
): value is RecipeReviewState[] {
  return Array.isArray(value) && value.every(validReviewState);
}
