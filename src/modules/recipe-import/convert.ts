import type { Result } from "@/shared";

import { parseRecipeDraft } from "./schemas";
import type {
  CookingStep,
  Ingredient,
  IngredientReviewDecision,
  Recipe,
  RecipeDraft,
  RecipeReviewState,
  ReviewIssue,
  ReviewValue,
} from "./types";

type ConversionResult = Result<Recipe, ReviewIssue[]>;

function issue(path: string, code: string, message: string): ReviewIssue {
  return { path, code, message };
}

function requireConfirmed<T>(
  review: ReviewValue<T>,
  path: string,
  issues: ReviewIssue[],
) {
  if (review.status !== "confirmed") {
    issues.push(issue(path, "FIELD_NOT_CONFIRMED", "Review this field before conversion."));
  }
}

function confirmationIssues(draft: RecipeDraft) {
  const issues: ReviewIssue[] = [];
  requireConfirmed(draft.name, "name", issues);
  requireConfirmed(draft.sourceServings, "sourceServings", issues);
  draft.ingredients.forEach((ingredient, index) => {
    const base = `ingredients[${index}]`;
    requireConfirmed(ingredient.name, `${base}.name`, issues);
    requireConfirmed(ingredient.quantity, `${base}.quantity`, issues);
    requireConfirmed(ingredient.unit, `${base}.unit`, issues);
    requireConfirmed(ingredient.foodState, `${base}.foodState`, issues);
  });
  draft.steps.forEach((step, index) => {
    const base = `steps[${index}]`;
    requireConfirmed(step.instruction, `${base}.instruction`, issues);
    requireConfirmed(step.durationMinutes, `${base}.durationMinutes`, issues);
    requireConfirmed(step.mode, `${base}.mode`, issues);
    requireConfirmed(step.dependsOn, `${base}.dependsOn`, issues);
    requireConfirmed(step.resources, `${base}.resources`, issues);
    requireConfirmed(step.ovenOperation, `${base}.ovenOperation`, issues);
    requireConfirmed(step.ovenTemperatureC, `${base}.ovenTemperatureC`, issues);
    requireConfirmed(step.isTerminal, `${base}.isTerminal`, issues);
  });
  return issues;
}

function decisionIssues(
  draft: RecipeDraft,
  decisions: IngredientReviewDecision[],
) {
  const issues: ReviewIssue[] = [];
  const knownIds = new Set(draft.ingredients.map((ingredient) => ingredient.id));
  const seen = new Set<string>();
  decisions.forEach((decision, index) => {
    const idPath = `ingredientDecisions[${index}].ingredientId`;
    if (!knownIds.has(decision.ingredientId)) {
      issues.push(issue(idPath, "INGREDIENT_DECISION_UNKNOWN", "Decision has no draft ingredient."));
    } else if (seen.has(decision.ingredientId)) {
      issues.push(issue(idPath, "INGREDIENT_DECISION_DUPLICATE", "Ingredient decision is duplicated."));
    }
    seen.add(decision.ingredientId);
    if (decision.status === null) {
      issues.push(issue(
        `ingredientDecisions[${index}].status`,
        "INGREDIENT_STATUS_REQUIRED",
        "Choose used or omitted explicitly.",
      ));
    } else if (decision.status !== "used" && decision.status !== "omitted") {
      issues.push(issue(
        `ingredientDecisions[${index}].status`,
        "INGREDIENT_STATUS_INVALID",
        "Ingredient status must be used or omitted.",
      ));
    }
    if (
      decision.nutritionMatchStatus !== "confirmed"
      && decision.nutritionMatchStatus !== "unresolved"
    ) {
      issues.push(issue(
        `ingredientDecisions[${index}].nutritionMatchStatus`,
        "NUTRITION_STATUS_INVALID",
        "Nutrition status must be confirmed or unresolved.",
      ));
    }
  });
  draft.ingredients.forEach((ingredient, index) => {
    if (!seen.has(ingredient.id)) {
      issues.push(issue(
        `ingredients[${index}].decision`,
        "INGREDIENT_DECISION_MISSING",
        "Every draft ingredient requires one decision.",
      ));
    }
  });
  return issues;
}

function nutritionIssue(
  draft: RecipeDraft,
  decision: IngredientReviewDecision,
  index: number,
): ReviewIssue | null {
  const ingredient = draft.ingredients.find((entry) => entry.id === decision.ingredientId);
  if (!ingredient) return null;
  const confirmed = decision.nutritionMatchStatus === "confirmed";
  const complete = decision.status === "used"
    && ingredient.foodState.value !== null
    && typeof decision.nutritionRefId === "string"
    && decision.nutritionRefId.trim() !== ""
    && Number.isFinite(decision.sourceGrams)
    && (decision.sourceGrams as number) > 0
    && Number.isFinite(decision.plannedGrams)
    && (decision.plannedGrams as number) > 0;
  const unresolvedIsClean = decision.nutritionRefId === null
    && decision.sourceGrams === null
    && decision.plannedGrams === null;
  if ((confirmed && !complete) || (!confirmed && !unresolvedIsClean)) {
    return issue(
      `ingredientDecisions[${index}].nutritionRefId`,
      "NUTRITION_CONFIRMATION_INVALID",
      "Nutrition matches require explicit complete confirmation and a known food state.",
    );
  }
  return null;
}

function makeIngredient(
  draft: RecipeDraft,
  index: number,
  decision: IngredientReviewDecision,
): Ingredient {
  const ingredient = draft.ingredients[index];
  return {
    id: ingredient.id,
    sourceText: ingredient.sourceText,
    name: ingredient.name.value,
    quantity: ingredient.quantity.value,
    unit: ingredient.unit.value,
    foodState: ingredient.foodState.value,
    sourceGrams: decision.sourceGrams,
    plannedGrams: decision.plannedGrams,
    nutritionRefId: decision.nutritionRefId,
    nutritionMatchStatus: decision.nutritionMatchStatus,
    status: decision.status as "used" | "omitted",
  };
}

function makeStep(draft: RecipeDraft, index: number): CookingStep {
  const step = draft.steps[index];
  return {
    id: step.id,
    recipeId: draft.id,
    sourceText: step.sourceText,
    instruction: step.instruction.value,
    durationMinutes: step.durationMinutes.value,
    mode: step.mode.value,
    dependsOn: [...step.dependsOn.value],
    resources: step.resources.value.map((resource) => ({ ...resource })),
    ovenOperation: step.ovenOperation.value,
    ovenTemperatureC: step.ovenTemperatureC.value,
    isTerminal: step.isTerminal.value,
  };
}

export function convertDraftToRecipe(state: RecipeReviewState): ConversionResult {
  const parsed = parseRecipeDraft(state.draft);
  if (!parsed.ok) return parsed;
  const draft = parsed.value;
  const issues = confirmationIssues(draft);
  if (!Number.isSafeInteger(state.targetServings) || state.targetServings <= 0) {
    issues.push(issue(
      "targetServings",
      "TARGET_SERVINGS_INVALID",
      "Target servings must be a positive safe integer.",
    ));
  }
  issues.push(...decisionIssues(draft, state.ingredientDecisions));
  state.ingredientDecisions.forEach((decision, index) => {
    const invalidNutrition = nutritionIssue(draft, decision, index);
    if (invalidNutrition) issues.push(invalidNutrition);
  });
  if (issues.length > 0) return { ok: false, error: issues };

  const decisions = new Map(
    state.ingredientDecisions.map((decision) => [decision.ingredientId, decision]),
  );
  return {
    ok: true,
    value: {
      id: draft.id,
      name: draft.name.value,
      sourceText: draft.sourceText,
      sourceServings: draft.sourceServings.value,
      targetServings: state.targetServings,
      ingredients: draft.ingredients.map((ingredient, index) =>
        makeIngredient(draft, index, decisions.get(ingredient.id)!)),
      steps: draft.steps.map((_step, index) => makeStep(draft, index)),
    },
  };
}
