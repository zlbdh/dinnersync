import {
  createCookingSession,
} from "@/modules/cooking-session";
import {
  DEMO_AI_DRAFTS,
  DEMO_NUTRITION_CATALOG,
  DEMO_REVIEW_STATES,
  DEMO_SCENARIO,
} from "@/modules/demo";
import { createRecipeReviewState } from "@/modules/recipe-import";
import { describe, expect, it } from "vitest";

import {
  buildDinnerPlan,
  createDinnerPlannerState,
  dinnerPlannerReducer,
} from "../index";

function build(overrides: Partial<Parameters<typeof buildDinnerPlan>[0]> = {}) {
  return buildDinnerPlan({
    settings: DEMO_SCENARIO,
    reviewStates: DEMO_REVIEW_STATES,
    nutritionCatalog: DEMO_NUTRITION_CATALOG,
    ...overrides,
  });
}

function readyPlan() {
  const result = build();
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

describe("buildDinnerPlan", () => {
  it("converts confirmed reviews, calculates nutrition, and invokes the scheduler", () => {
    const plan = readyPlan();

    expect(plan.recipes.map((recipe) => recipe.id)).toEqual([
      "lemon-herb-chicken",
      "roasted-garden-vegetables",
      "garlic-butter-rice",
    ]);
    expect(plan.nutrition).toMatchObject({
      completeness: "complete",
      knownMealKcal: 1_300.28,
      knownKcalPerPerson: 650.14,
      targetDeltaPerPerson: 0.14,
    });
    expect(plan.schedule.feasible).toBe(true);
    if (plan.schedule.feasible) {
      expect(plan.schedule.tasks.find((task) => task.taskId === "veg-finish")?.plannedEnd)
        .toBe(DEMO_SCENARIO.serveAt);
    }
  });

  it("rejects any draft that still contains a needs-review field", () => {
    const result = build({
      reviewStates: [createRecipeReviewState(DEMO_AI_DRAFTS[0], 2)],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContainEqual(expect.objectContaining({
        category: "review",
        code: "FIELD_NOT_CONFIRMED",
      }));
    }
  });

  it("still schedules a confirmed null sourceServings recipe but reports partial nutrition", () => {
    const reviewStates = structuredClone(DEMO_REVIEW_STATES);
    reviewStates[0].draft.sourceServings = {
      value: null,
      provenance: "inferred",
      evidence: null,
      inferenceReason: "The source serving count is unavailable after review.",
      confidence: 1,
      status: "confirmed",
    };

    const result = build({ reviewStates });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.schedule.feasible).toBe(true);
    expect(result.value.nutrition).toMatchObject({
      completeness: "partial",
      knownMealKcal: 783.66,
      estimatedMealKcal: null,
      targetDeltaPerPerson: null,
    });
    expect(result.value.nutrition.unresolvedIngredientIds).toEqual([
      "chicken-breast",
      "chicken-oil",
      "lemon-juice",
      "parsley",
      "chicken-garlic",
    ]);
  });

  it("retains infeasible issues and earliestFeasible instead of flattening schedule output", () => {
    const result = build({
      settings: {
        ...DEMO_SCENARIO,
        serveAt: "2026-07-18T18:20:00.000Z",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.schedule.feasible).toBe(false);
    if (result.value.schedule.feasible) return;
    expect(result.value.schedule.issues.length).toBeGreaterThan(0);
    expect(result.value.schedule).toHaveProperty("earliestFeasible");
  });

  it.each([
    ["target servings", {
      type: "set-target-servings" as const,
      value: 4,
    }],
    ["ingredient status", {
      type: "set-ingredient-status" as const,
      ingredientId: "chicken-oil",
      status: "omitted" as const,
    }],
    ["review field", {
      type: "edit-field" as const,
      target: { scope: "ingredient" as const, id: "chicken-breast", field: "quantity" as const },
      value: 300,
    }],
  ])("invalidates plan and session after changing %s", (_label, reviewAction) => {
    const plan = readyPlan();
    if (!plan.schedule.feasible) throw new Error("expected feasible demo");
    let state = createDinnerPlannerState(DEMO_SCENARIO, DEMO_REVIEW_STATES);
    state = dinnerPlannerReducer(state, { type: "STAGE_CHANGED", stage: "review" });
    state = dinnerPlannerReducer(state, { type: "PLAN_BUILT", plan });
    state = dinnerPlannerReducer(state, {
      type: "SESSION_STARTED",
      session: createCookingSession(plan.scheduleRequest, plan.schedule),
    });
    expect(state.stage).toBe("cook");

    const next = dinnerPlannerReducer(state, {
      type: "REVIEW_CHANGED",
      recipeId: "lemon-herb-chicken",
      action: reviewAction,
    });

    expect(next.stage).toBe("review");
    expect(next.plan).toBeNull();
    expect(next.session).toBeNull();
    expect(state.plan).toEqual(plan);
  });

  it("exposes the complete UI stage and error category vocabularies", () => {
    const state = createDinnerPlannerState(DEMO_SCENARIO, DEMO_REVIEW_STATES);
    expect(state.stage).toBe("setup");
    expect(state.errors).toEqual([]);
    expect(["setup", "review", "plan", "cook", "summary"]).toContain(state.stage);
    expect(["field", "review", "nutrition", "schedule", "storage", "ai"])
      .toContain("storage");
  });

  it("guards plan, cook, and summary stages with their required state", () => {
    const plan = readyPlan();
    if (!plan.schedule.feasible) throw new Error("expected feasible demo");
    const initial = createDinnerPlannerState(DEMO_SCENARIO, DEMO_REVIEW_STATES);
    expect(dinnerPlannerReducer(initial, {
      type: "STAGE_CHANGED", stage: "plan",
    })).toBe(initial);

    const review = dinnerPlannerReducer(initial, {
      type: "STAGE_CHANGED", stage: "review",
    });
    expect(dinnerPlannerReducer(initial, { type: "PLAN_BUILT", plan })).toBe(initial);
    const planned = dinnerPlannerReducer(review, { type: "PLAN_BUILT", plan });
    expect(dinnerPlannerReducer(planned, {
      type: "STAGE_CHANGED", stage: "cook",
    })).toBe(planned);

    const session = createCookingSession(plan.scheduleRequest, plan.schedule);
    const detached = structuredClone(session);
    detached.request.serveAt = "2026-07-18T20:00:00.000Z";
    expect(dinnerPlannerReducer(planned, {
      type: "SESSION_STARTED", session: detached,
    })).toBe(planned);

    const cooking = dinnerPlannerReducer(planned, {
      type: "SESSION_STARTED", session,
    });
    expect(cooking.stage).toBe("cook");
    expect(dinnerPlannerReducer(cooking, {
      type: "STAGE_CHANGED", stage: "summary",
    })).toBe(cooking);
  });

  it("allows only the forward stage actions that own each transition", () => {
    const plan = readyPlan();
    if (!plan.schedule.feasible) throw new Error("expected feasible demo");
    const setup = createDinnerPlannerState(DEMO_SCENARIO, DEMO_REVIEW_STATES);
    const review = dinnerPlannerReducer(setup, {
      type: "STAGE_CHANGED", stage: "review",
    });
    const planned = dinnerPlannerReducer(review, { type: "PLAN_BUILT", plan });
    const cooking = dinnerPlannerReducer(planned, {
      type: "SESSION_STARTED",
      session: createCookingSession(plan.scheduleRequest, plan.schedule),
    });

    expect(dinnerPlannerReducer(review, {
      type: "SESSION_STARTED", session: cooking.session!,
    })).toBe(review);
    expect(dinnerPlannerReducer(planned, {
      type: "STAGE_CHANGED", stage: "review",
    })).toBe(planned);
    expect(dinnerPlannerReducer(cooking, {
      type: "STAGE_CHANGED", stage: "plan",
    })).toBe(cooking);
    expect(dinnerPlannerReducer(cooking, {
      type: "STAGE_CHANGED", stage: "review",
    })).toBe(cooking);
  });

  it("keeps setup active while setup settings are edited", () => {
    const setup = createDinnerPlannerState(DEMO_SCENARIO, DEMO_REVIEW_STATES);
    const changed = dinnerPlannerReducer(setup, {
      type: "SETTINGS_CHANGED",
      settings: { targetKcalPerPerson: 625 },
    });

    expect(changed.stage).toBe("setup");
    expect(changed.settings.targetKcalPerPerson).toBe(625);
    expect(changed.plan).toBeNull();
    expect(changed.session).toBeNull();
  });

  it("preserves plan and cook state identity for review and settings no-ops", () => {
    const plan = readyPlan();
    if (!plan.schedule.feasible) throw new Error("expected feasible demo");
    const setup = createDinnerPlannerState(DEMO_SCENARIO, DEMO_REVIEW_STATES);
    const review = dinnerPlannerReducer(setup, {
      type: "STAGE_CHANGED", stage: "review",
    });
    const planned = dinnerPlannerReducer(review, { type: "PLAN_BUILT", plan });
    const cooking = dinnerPlannerReducer(planned, {
      type: "SESSION_STARTED",
      session: createCookingSession(plan.scheduleRequest, plan.schedule),
    });

    for (const state of [planned, cooking]) {
      expect(dinnerPlannerReducer(state, {
        type: "REVIEW_CHANGED",
        recipeId: "lemon-herb-chicken",
        action: { type: "set-target-servings", value: 2 },
      })).toBe(state);
      expect(dinnerPlannerReducer(state, {
        type: "REVIEW_CHANGED",
        recipeId: "lemon-herb-chicken",
        action: {
          type: "set-ingredient-status",
          ingredientId: "chicken-oil",
          status: "used",
        },
      })).toBe(state);
      expect(dinnerPlannerReducer(state, {
        type: "SETTINGS_CHANGED", settings: {},
      })).toBe(state);
      expect(dinnerPlannerReducer(state, {
        type: "SETTINGS_CHANGED",
        settings: { kitchen: { ...state.settings.kitchen } },
      })).toBe(state);
      expect(dinnerPlannerReducer(state, {
        type: "SETTINGS_CHANGED",
        settings: { kitchen: { burners: 2, ovens: 1, cooks: 1 } },
      })).toBe(state);
    }
  });

  it("isolates appended storage warnings from later dispatches", () => {
    const state = createDinnerPlannerState(DEMO_SCENARIO, DEMO_REVIEW_STATES);
    const warning = {
      category: "storage" as const, code: "STORAGE_UNAVAILABLE" as const,
      message: "original",
    };
    const first = dinnerPlannerReducer(state, { type: "STORAGE_WARNING", warning });
    first.warnings[0].message = "mutated";
    const second = dinnerPlannerReducer(state, { type: "STORAGE_WARNING", warning });

    expect(second.warnings[0].message).toBe("original");
  });
});
