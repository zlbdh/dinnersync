import { validateEvidence } from "./evidence";
import type {
  IngredientReviewDecision,
  RecipeDraft,
  RecipeReviewAction,
  RecipeReviewState,
  ReviewFieldTarget,
  ReviewValue,
} from "./types";

const USER_EDIT_REASON = "User edited this field during review.";

type LocatedReview = {
  path: string;
  review: ReviewValue<unknown>;
};

function emptyDecision(ingredientId: string): IngredientReviewDecision {
  return {
    ingredientId,
    status: null,
    sourceGrams: null,
    plannedGrams: null,
    nutritionRefId: null,
    nutritionMatchStatus: "unresolved",
  };
}

export function createRecipeReviewState(
  draft: RecipeDraft,
  targetServings: number,
): RecipeReviewState {
  const clonedDraft = structuredClone(draft);
  return {
    draft: clonedDraft,
    targetServings,
    ingredientDecisions: clonedDraft.ingredients.map((ingredient) =>
      emptyDecision(ingredient.id)),
  };
}

function reviewField(
  value: object,
  field: string,
): ReviewValue<unknown> | undefined {
  const candidate = (value as Record<string, unknown>)[field];
  if (typeof candidate !== "object" || candidate === null || !("status" in candidate)) {
    return undefined;
  }
  return candidate as ReviewValue<unknown>;
}

function locateReview(draft: RecipeDraft, target: ReviewFieldTarget): LocatedReview | undefined {
  if (target.scope === "recipe") {
    const review = reviewField(draft, target.field);
    return review ? { path: target.field, review } : undefined;
  }
  if (target.scope === "ingredient") {
    const index = draft.ingredients.findIndex((entry) => entry.id === target.id);
    if (index < 0) return undefined;
    const review = reviewField(draft.ingredients[index], target.field);
    return review ? { path: `ingredients[${index}].${target.field}`, review } : undefined;
  }
  const index = draft.steps.findIndex((entry) => entry.id === target.id);
  if (index < 0) return undefined;
  const review = reviewField(draft.steps[index], target.field);
  return review ? { path: `steps[${index}].${target.field}`, review } : undefined;
}

function resetStepReviews(draft: RecipeDraft) {
  for (const step of draft.steps) {
    for (const field of [
      "instruction",
      "durationMinutes",
      "mode",
      "dependsOn",
      "resources",
      "ovenOperation",
      "ovenTemperatureC",
      "isTerminal",
    ] as const) {
      step[field].status = "needs-review";
    }
  }
}

function invalidateDerivedState(state: RecipeReviewState) {
  for (const decision of state.ingredientDecisions) {
    decision.sourceGrams = null;
    decision.plannedGrams = null;
    decision.nutritionRefId = null;
    decision.nutritionMatchStatus = "unresolved";
  }
  resetStepReviews(state.draft);
}

function validPositive(value: number) {
  return Number.isFinite(value) && value > 0;
}

function editInvalidatesDerivations(target: ReviewFieldTarget) {
  return target.scope === "ingredient"
    || (target.scope === "recipe" && target.field === "sourceServings");
}

function confirmNutrition(
  state: RecipeReviewState,
  action: Extract<RecipeReviewAction, { type: "confirm-nutrition" }>,
) {
  const decision = state.ingredientDecisions.find(
    (entry) => entry.ingredientId === action.ingredientId,
  );
  const ingredient = state.draft.ingredients.find(
    (entry) => entry.id === action.ingredientId,
  );
  if (!decision
    || !ingredient
    || decision.status !== "used"
    || ingredient.foodState.status !== "confirmed"
    || ingredient.foodState.value === null
    || action.nutritionRefId.trim() === ""
    || !validPositive(action.sourceGrams)
    || !validPositive(action.plannedGrams)) return state;

  decision.nutritionRefId = action.nutritionRefId;
  decision.sourceGrams = action.sourceGrams;
  decision.plannedGrams = action.plannedGrams;
  decision.nutritionMatchStatus = "confirmed";
  return state;
}

export function recipeReviewReducer(
  state: RecipeReviewState,
  action: RecipeReviewAction,
): RecipeReviewState {
  if (action.type === "confirm-field") {
    const current = locateReview(state.draft, action.target);
    if (!current
      || !validateEvidence(state.draft.sourceText, current.review, current.path).ok) return state;
    const next = structuredClone(state);
    locateReview(next.draft, action.target)!.review.status = "confirmed";
    return next;
  }

  if (action.type === "edit-field") {
    if (!locateReview(state.draft, action.target)) return state;
    const next = structuredClone(state);
    const review = locateReview(next.draft, action.target)!.review;
    review.value = structuredClone(action.value);
    review.status = "confirmed";
    review.provenance = "inferred";
    review.evidence = null;
    review.confidence = 1;
    review.inferenceReason = action.reason?.trim() || USER_EDIT_REASON;
    if (editInvalidatesDerivations(action.target)) invalidateDerivedState(next);
    return next;
  }

  if (action.type === "set-target-servings") {
    if (Object.is(state.targetServings, action.value)) return state;
    const next = structuredClone(state);
    next.targetServings = action.value;
    invalidateDerivedState(next);
    return next;
  }

  if (action.type === "set-ingredient-status") {
    const current = state.ingredientDecisions.find(
      (entry) => entry.ingredientId === action.ingredientId,
    );
    if (!current || current.status === action.status) return state;
    const next = structuredClone(state);
    next.ingredientDecisions.find(
      (entry) => entry.ingredientId === action.ingredientId,
    )!.status = action.status;
    invalidateDerivedState(next);
    return next;
  }

  return confirmNutrition(structuredClone(state), action);
}
