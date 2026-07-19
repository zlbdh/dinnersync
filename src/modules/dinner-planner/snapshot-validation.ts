import {
  parseRecipeDraft,
} from "@/modules/recipe-import";
import type {
  IngredientReviewDecision,
  RecipeDraft,
  RecipeReviewState,
} from "@/modules/recipe-import";
import { parseIsoInstant } from "@/shared";

import type { DinnerPlanSettings, DinnerPlannerState } from "./types";

const MAX_PLANNER_REVIEW_STATES = 3;
const MAX_PLANNER_SOURCE_CHARS = 24_000;
const VALIDATED_RESTORE = Symbol("dinner-planner-validated-restore");

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
  if (!Array.isArray(value) || value.length > MAX_PLANNER_REVIEW_STATES) return false;
  // Hydrated states must preserve identities used by review keys and flattened scheduling.
  const recipeIds = new Set<string>();
  const stepIds = new Set<string>();
  let sourceChars = 0;
  for (const entry of value) {
    if (!validReviewState(entry) || recipeIds.has(entry.draft.id)) return false;
    sourceChars += entry.draft.sourceText.length;
    if (sourceChars > MAX_PLANNER_SOURCE_CHARS) return false;
    for (const step of entry.draft.steps) {
      if (stepIds.has(step.id)) return false;
      stepIds.add(step.id);
    }
    recipeIds.add(entry.draft.id);
  }
  return true;
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasLinkedSession(state: DinnerPlannerState) {
  return state.plan !== null
    && state.plan.schedule.feasible
    && state.session !== null
    && sameJson(state.session.request, state.plan.scheduleRequest)
    && sameJson(state.session.initialSchedule, state.plan.schedule);
}

function isReachableRestoredState(state: DinnerPlannerState) {
  if (!validDinnerPlanSettings(state.settings)
    || !validRecipeReviewStates(state.reviewStates)
    || (state.stage !== "setup" && state.reviewStates.length === 0)) return false;
  if (state.stage === "setup" || state.stage === "review") {
    return state.plan === null && state.session === null;
  }
  if (state.stage === "plan") return state.plan !== null && state.session === null;
  if (state.stage === "cook") return hasLinkedSession(state);
  if (state.stage !== "summary" || !hasLinkedSession(state)) return false;
  const runtime = Object.values(state.session!.runtime);
  return runtime.length > 0
    && runtime.every((task) => task.status === "completed");
}

export function markValidatedDinnerPlannerState<T extends DinnerPlannerState>(
  state: T,
): T {
  // Bind the private marker to the exact state so post-validation mutations cannot cross
  // the reducer boundary, while ordinary object spreads cannot propagate the marker.
  Object.defineProperty(state, VALIDATED_RESTORE, {
    value: JSON.stringify(state),
    enumerable: false,
  });
  return state;
}

export function isValidatedDinnerPlannerState(
  state: DinnerPlannerState,
) {
  const marked = state as DinnerPlannerState & {
    [VALIDATED_RESTORE]?: string;
  };
  try {
    if (typeof marked[VALIDATED_RESTORE] !== "string"
      || marked[VALIDATED_RESTORE] !== JSON.stringify(state)) return false;
    return isReachableRestoredState(state);
  } catch {
    return false;
  }
}
