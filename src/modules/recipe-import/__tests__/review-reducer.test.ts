import { describe, expect, test } from "vitest";

import * as recipeImport from "../index";
import { confirmEveryReviewValue, makeAiDraft } from "./draft-fixture";

type ReviewState = {
  draft: ReturnType<typeof makeAiDraft>;
  targetServings: number;
  ingredientDecisions: Array<{
    ingredientId: string;
    status: "used" | "omitted" | null;
    sourceGrams: number | null;
    plannedGrams: number | null;
    nutritionRefId: string | null;
    nutritionMatchStatus: "confirmed" | "unresolved";
  }>;
};
type ReducerApi = {
  createRecipeReviewState(draft: unknown, targetServings: number): ReviewState;
  recipeReviewReducer(state: ReviewState, action: Record<string, unknown>): ReviewState;
};

const api = recipeImport as typeof recipeImport & ReducerApi;

function usedState() {
  const state = api.createRecipeReviewState(confirmEveryReviewValue(makeAiDraft()), 2);
  return state.ingredientDecisions.reduce(
    (current, decision) => api.recipeReviewReducer(current, {
      type: "set-ingredient-status",
      ingredientId: decision.ingredientId,
      status: "used",
    }),
    state,
  );
}

function hasOnlyStepStatus(state: ReviewState, status: string) {
  return state.draft.steps.every((step) => Object.values(step)
    .filter((value) => typeof value === "object" && value !== null && "status" in value)
    .every((value) => (value as { status: string }).status === status));
}

describe("recipe review reducer", () => {
  test("starts with explicit undecided ingredient choices and no derived data", () => {
    const state = api.createRecipeReviewState(makeAiDraft(), 2);
    expect(state.ingredientDecisions).toEqual([
      expect.objectContaining({ ingredientId: "ingredient-pasta", status: null }),
      expect.objectContaining({ ingredientId: "ingredient-sauce", status: null }),
    ]);
    expect(state.ingredientDecisions.every((decision) =>
      decision.sourceGrams === null
      && decision.plannedGrams === null
      && decision.nutritionRefId === null
      && decision.nutritionMatchStatus === "unresolved")).toBe(true);
  });

  test("confirms an unedited field without changing valid provenance", () => {
    const state = api.createRecipeReviewState(makeAiDraft(), 2);
    const before = structuredClone(state.draft.name);
    const next = api.recipeReviewReducer(state, {
      type: "confirm-field",
      target: { scope: "recipe", field: "name" },
    });

    expect(next.draft.name).toEqual({ ...before, status: "confirmed" });
    expect(state.draft.name.status).toBe("needs-review");
  });

  test("stores a user edit as confirmed inferred data without evidence", () => {
    const state = api.createRecipeReviewState(makeAiDraft(), 2);
    const next = api.recipeReviewReducer(state, {
      type: "edit-field",
      target: { scope: "ingredient", id: "ingredient-pasta", field: "quantity" },
      value: 225,
      reason: "I weighed the pasta before cooking",
    });

    expect(next.draft.ingredients[0].quantity).toEqual({
      value: 225,
      provenance: "inferred",
      evidence: null,
      inferenceReason: "I weighed the pasta before cooking",
      confidence: 1,
      status: "confirmed",
      editedByUser: true,
    });
    expect(state.draft.ingredients[0].quantity.value).toBe(200);
  });

  test("uses a non-blank safe reason when edit reason is omitted", () => {
    const next = api.recipeReviewReducer(
      api.createRecipeReviewState(makeAiDraft(), 2),
      {
        type: "edit-field",
        target: { scope: "recipe", field: "sourceServings" },
        value: null,
      },
    );
    expect(next.draft.sourceServings.inferenceReason?.trim().length).toBeGreaterThan(0);
  });

  test("only explicit nutrition confirmation can store a match", () => {
    const state = usedState();
    expect(state.ingredientDecisions[0].nutritionRefId).toBeNull();

    const next = api.recipeReviewReducer(state, {
      type: "confirm-nutrition",
      ingredientId: "ingredient-pasta",
      nutritionRefId: "usda-pasta-dry",
      sourceGrams: 200,
      plannedGrams: 200,
    });
    expect(next.ingredientDecisions[0]).toEqual(expect.objectContaining({
      nutritionRefId: "usda-pasta-dry",
      nutritionMatchStatus: "confirmed",
      sourceGrams: 200,
      plannedGrams: 200,
    }));
    expect(state.ingredientDecisions[0].nutritionRefId).toBeNull();
  });

  test("refuses a nutrition match while food state is unknown", () => {
    let state = usedState();
    state = structuredClone(state);
    state.draft.ingredients[0].foodState.value = null;
    state.draft.ingredients[0].foodState.status = "confirmed";
    const next = api.recipeReviewReducer(state, {
      type: "confirm-nutrition",
      ingredientId: "ingredient-pasta",
      nutritionRefId: "unsafe-match",
      sourceGrams: 200,
      plannedGrams: 200,
    });
    expect(next.ingredientDecisions[0]).toEqual(expect.objectContaining({
      nutritionRefId: null,
      nutritionMatchStatus: "unresolved",
    }));
  });

  test("keeps an explicitly used but unmatched ingredient unresolved", () => {
    const state = api.recipeReviewReducer(
      api.createRecipeReviewState(makeAiDraft(), 2),
      {
        type: "set-ingredient-status",
        ingredientId: "ingredient-pasta",
        status: "used",
      },
    );
    expect(state.ingredientDecisions[0]).toEqual(expect.objectContaining({
      status: "used",
      nutritionRefId: null,
      nutritionMatchStatus: "unresolved",
    }));
  });

  test.each([
    ["source servings", {
      type: "edit-field",
      target: { scope: "recipe", field: "sourceServings" },
      value: 4,
    }],
    ["ingredient name", {
      type: "edit-field",
      target: { scope: "ingredient", id: "ingredient-pasta", field: "name" },
      value: "whole-wheat pasta",
    }],
    ["ingredient quantity", {
      type: "edit-field",
      target: { scope: "ingredient", id: "ingredient-pasta", field: "quantity" },
      value: 225,
    }],
    ["ingredient unit", {
      type: "edit-field",
      target: { scope: "ingredient", id: "ingredient-pasta", field: "unit" },
      value: "kg",
    }],
    ["ingredient food state", {
      type: "edit-field",
      target: { scope: "ingredient", id: "ingredient-pasta", field: "foodState" },
      value: "cooked",
    }],
  ])("invalidates confirmed nutrition after editing %s", (_name, action) => {
    let state = usedState();
    state = api.recipeReviewReducer(state, {
      type: "confirm-nutrition",
      ingredientId: "ingredient-pasta",
      nutritionRefId: "usda-pasta-dry",
      sourceGrams: 200,
      plannedGrams: 200,
    });
    expect(state.ingredientDecisions[0].nutritionMatchStatus).toBe("confirmed");

    const next = api.recipeReviewReducer(state, action);
    expect(next.ingredientDecisions.every((decision) =>
      decision.sourceGrams === null
      && decision.plannedGrams === null
      && decision.nutritionRefId === null
      && decision.nutritionMatchStatus === "unresolved")).toBe(true);
  });

  test.each([
    ["target servings", { type: "set-target-servings", value: 4 }],
    ["ingredient choice", {
      type: "set-ingredient-status",
      ingredientId: "ingredient-pasta",
      status: "omitted",
    }],
  ])("invalidates every derivation and step review after changing %s", (_name, action) => {
    let state = usedState();
    state = api.recipeReviewReducer(state, {
      type: "confirm-nutrition",
      ingredientId: "ingredient-pasta",
      nutritionRefId: "usda-pasta-dry",
      sourceGrams: 200,
      plannedGrams: 200,
    });
    state = { ...state, draft: confirmEveryReviewValue(state.draft) };
    expect(hasOnlyStepStatus(state, "confirmed")).toBe(true);
    const snapshot = structuredClone(state);
    const next = api.recipeReviewReducer(state, action);

    expect(next.ingredientDecisions.every((decision) =>
      decision.sourceGrams === null
      && decision.plannedGrams === null
      && decision.nutritionRefId === null
      && decision.nutritionMatchStatus === "unresolved")).toBe(true);
    expect(hasOnlyStepStatus(next, "needs-review")).toBe(true);
    expect(state).toEqual(snapshot);
  });

  test.each([0, -1, 2.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "refuses invalid target servings %s",
    (value) => {
      const state = api.createRecipeReviewState(makeAiDraft(), 2);
      expect(api.recipeReviewReducer(state, {
        type: "set-target-servings",
        value,
      })).toBe(state);
    },
  );
});
