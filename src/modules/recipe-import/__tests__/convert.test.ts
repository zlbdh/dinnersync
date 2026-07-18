import { describe, expect, test } from "vitest";

import * as recipeImport from "../index";
import { confirmEveryReviewValue, makeAiDraft } from "./draft-fixture";

type ReviewIssue = { path: string; code: string };
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
type ConvertResult = { ok: true; value: Record<string, unknown> } | {
  ok: false;
  error: ReviewIssue[];
};
type ConvertApi = {
  convertDraftToRecipe(state: ReviewState): ConvertResult;
  recipeReviewReducer(state: ReviewState, action: Record<string, unknown>): ReviewState;
};

const api = recipeImport as typeof recipeImport & ConvertApi;

function makeReadyState(): ReviewState {
  return {
    draft: confirmEveryReviewValue(makeAiDraft()),
    targetServings: 2,
    ingredientDecisions: [
      {
        ingredientId: "ingredient-pasta",
        status: "used",
        sourceGrams: 200,
        plannedGrams: 200,
        nutritionRefId: "usda-pasta-dry",
        nutritionMatchStatus: "confirmed",
      },
      {
        ingredientId: "ingredient-sauce",
        status: "used",
        sourceGrams: null,
        plannedGrams: null,
        nutritionRefId: null,
        nutritionMatchStatus: "unresolved",
      },
    ],
  };
}

function expectIssue(result: ConvertResult, path: string, code: string) {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContainEqual(expect.objectContaining({ path, code }));
}

describe("Draft to Recipe conversion", () => {
  test("strips review metadata and preserves only explicit review-state derivations", () => {
    const state = makeReadyState();
    const result = api.convertDraftToRecipe(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const recipe = result.value as {
      id: string;
      sourceText: string;
      sourceServings: number | null;
      ingredients: Array<Record<string, unknown>>;
      steps: Array<Record<string, unknown>>;
    };

    expect(recipe.sourceText).toBe(state.draft.sourceText);
    expect(recipe.sourceServings).toBe(2);
    expect(recipe.ingredients[0]).toEqual(expect.objectContaining({
      name: "dry pasta",
      status: "used",
      sourceGrams: 200,
      plannedGrams: 200,
      nutritionRefId: "usda-pasta-dry",
      nutritionMatchStatus: "confirmed",
    }));
    expect(recipe.ingredients[1]).toEqual(expect.objectContaining({
      status: "used",
      nutritionRefId: null,
      nutritionMatchStatus: "unresolved",
    }));
    expect(recipe.steps[0]).toEqual(expect.objectContaining({
      recipeId: "recipe-1",
      instruction: "Boil the pasta",
    }));
    expect(recipe).not.toHaveProperty("name.status");
    expect(JSON.stringify(recipe)).not.toContain("needs-review");
    expect(JSON.stringify(recipe)).not.toContain("provenance");
  });

  test("does not share mutable arrays or objects with the draft", () => {
    const state = makeReadyState();
    const result = api.convertDraftToRecipe(state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const recipe = result.value as {
      ingredients: Array<Record<string, unknown>>;
      steps: Array<{ dependsOn: string[]; resources: object[] }>;
    };
    expect(recipe.ingredients).not.toBe(state.draft.ingredients);
    expect(recipe.steps).not.toBe(state.draft.steps);
    expect(recipe.steps[0].dependsOn).not.toBe(state.draft.steps[0].dependsOn.value);
    expect(recipe.steps[0].resources).not.toBe(state.draft.steps[0].resources.value);
    expect(recipe.steps[0].resources[0]).not.toBe(
      (state.draft.steps[0].resources.value as object[])[0],
    );
  });

  test("converts a locally edited field while stripping its internal marker", () => {
    const edited = api.recipeReviewReducer(makeReadyState(), {
      type: "edit-field",
      target: { scope: "recipe", field: "name" },
      value: "Weeknight pasta",
    });

    const result = api.convertDraftToRecipe(edited);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("Weeknight pasta");
    expect(JSON.stringify(result.value)).not.toContain("editedByUser");
  });

  test.each([
    ["name", (state: ReviewState) => state.draft.name, "name"],
    ["source servings", (state: ReviewState) => state.draft.sourceServings, "sourceServings"],
    ["ingredient name", (state: ReviewState) => state.draft.ingredients[0].name, "ingredients[0].name"],
    ["ingredient quantity", (state: ReviewState) => state.draft.ingredients[0].quantity, "ingredients[0].quantity"],
    ["ingredient unit", (state: ReviewState) => state.draft.ingredients[0].unit, "ingredients[0].unit"],
    ["ingredient food state", (state: ReviewState) => state.draft.ingredients[0].foodState, "ingredients[0].foodState"],
    ["step instruction", (state: ReviewState) => state.draft.steps[0].instruction, "steps[0].instruction"],
    ["step duration", (state: ReviewState) => state.draft.steps[0].durationMinutes, "steps[0].durationMinutes"],
    ["step mode", (state: ReviewState) => state.draft.steps[0].mode, "steps[0].mode"],
    ["step dependencies", (state: ReviewState) => state.draft.steps[0].dependsOn, "steps[0].dependsOn"],
    ["step resources", (state: ReviewState) => state.draft.steps[0].resources, "steps[0].resources"],
    ["step oven operation", (state: ReviewState) => state.draft.steps[0].ovenOperation, "steps[0].ovenOperation"],
    ["step oven temperature", (state: ReviewState) => state.draft.steps[0].ovenTemperatureC, "steps[0].ovenTemperatureC"],
    ["step terminal flag", (state: ReviewState) => state.draft.steps[0].isTerminal, "steps[0].isTerminal"],
  ])("rejects unconfirmed %s", (_name, select, path) => {
    const state = makeReadyState();
    (select(state) as { status: string }).status = "needs-review";
    expectIssue(api.convertDraftToRecipe(state), path, "FIELD_NOT_CONFIRMED");
  });

  test("accepts an explicitly confirmed null source serving count", () => {
    const state = makeReadyState();
    state.draft.sourceServings = {
      value: null,
      provenance: "inferred",
      evidence: null,
      inferenceReason: "The source does not state servings",
      confidence: 1,
      status: "confirmed",
    };
    const result = api.convertDraftToRecipe(state);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sourceServings).toBeNull();
  });

  test("revalidates schema and root evidence before conversion", () => {
    const badSchema = makeReadyState();
    Object.assign(badSchema.draft.ingredients[0], { kcal: 700 });
    expectIssue(api.convertDraftToRecipe(badSchema), "ingredients[0]", "SCHEMA_INVALID");

    const badEvidence = makeReadyState();
    badEvidence.draft.steps[0].instruction.evidence = {
      start: 0,
      end: "Boil the pasta".length,
      text: "Boil the pasta",
    };
    expectIssue(
      api.convertDraftToRecipe(badEvidence),
      "steps[0].instruction.evidence",
      "EVIDENCE_TEXT_MISMATCH",
    );
  });

  test.each([0, 1.5, Number.POSITIVE_INFINITY])(
    "rejects invalid target servings %s",
    (targetServings) => {
      const state = makeReadyState();
      state.targetServings = targetServings;
      expectIssue(
        api.convertDraftToRecipe(state),
        "targetServings",
        "TARGET_SERVINGS_INVALID",
      );
    },
  );

  test("requires one explicit ingredient decision per draft ingredient", () => {
    const missing = makeReadyState();
    missing.ingredientDecisions.pop();
    expectIssue(
      api.convertDraftToRecipe(missing),
      "ingredients[1].decision",
      "INGREDIENT_DECISION_MISSING",
    );

    const duplicate = makeReadyState();
    duplicate.ingredientDecisions[1].ingredientId = "ingredient-pasta";
    expectIssue(
      api.convertDraftToRecipe(duplicate),
      "ingredientDecisions[1].ingredientId",
      "INGREDIENT_DECISION_DUPLICATE",
    );

    const undecided = makeReadyState();
    undecided.ingredientDecisions[0].status = null;
    expectIssue(
      api.convertDraftToRecipe(undecided),
      "ingredientDecisions[0].status",
      "INGREDIENT_STATUS_REQUIRED",
    );
  });

  test("rejects impossible confirmed nutrition metadata", () => {
    const state = makeReadyState();
    state.draft.ingredients[0].foodState.value = null;
    expectIssue(
      api.convertDraftToRecipe(state),
      "ingredientDecisions[0].nutritionRefId",
      "NUTRITION_CONFIRMATION_INVALID",
    );
  });

  test("rejects forged ingredient and nutrition status values at runtime", () => {
    const forgedIngredientStatus = makeReadyState();
    forgedIngredientStatus.ingredientDecisions[0].status = "ignored" as never;
    expectIssue(
      api.convertDraftToRecipe(forgedIngredientStatus),
      "ingredientDecisions[0].status",
      "INGREDIENT_STATUS_INVALID",
    );

    const forgedNutritionStatus = makeReadyState();
    forgedNutritionStatus.ingredientDecisions[0].nutritionMatchStatus = "trusted" as never;
    expectIssue(
      api.convertDraftToRecipe(forgedNutritionStatus),
      "ingredientDecisions[0].nutritionMatchStatus",
      "NUTRITION_STATUS_INVALID",
    );
  });
});
