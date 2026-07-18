import {
  DEMO_NUTRITION_CATALOG,
  DEMO_REVIEW_STATES,
  DEMO_SCENARIO,
} from "@/modules/demo";
import type { RecipeReviewState } from "@/modules/recipe-import";
import { describe, expect, it } from "vitest";

import {
  createDinnerPlannerState,
  restoreDinnerPlanner,
  snapshotDinnerPlanner,
} from "../index";
import type {
  DinnerPlannerPersistenceSeed,
  DinnerPlannerSnapshotV1,
} from "../index";

const NOW = "2026-07-18T18:24:00.000Z";

function seed(): DinnerPlannerPersistenceSeed {
  return {
    settings: DEMO_SCENARIO,
    reviewStates: DEMO_REVIEW_STATES,
    nutritionCatalog: DEMO_NUTRITION_CATALOG,
  };
}

function reviewSnapshot(): DinnerPlannerSnapshotV1 {
  return snapshotDinnerPlanner({
    ...createDinnerPlannerState(DEMO_SCENARIO, DEMO_REVIEW_STATES),
    stage: "review",
  });
}

function expectRecovered(snapshot: unknown) {
  const restored = restoreDinnerPlanner(JSON.stringify(snapshot), seed(), NOW);
  expect(restored.stage).toBe("setup");
  expect(restored.plan).toBeNull();
  expect(restored.session).toBeNull();
  expect(restored.settings).toEqual(DEMO_SCENARIO);
  expect(restored.warnings).toContainEqual(expect.objectContaining({
    category: "storage",
    code: "SNAPSHOT_RECOVERED",
  }));
}

describe("planless dinner planner snapshot validation", () => {
  it("resets exact-key review snapshots with unreadable nested values", () => {
    expectRecovered({
      version: 1,
      stage: "review",
      settings: {},
      reviewStates: [null],
      recipes: [],
      nutrition: null,
      scheduleRequest: null,
      schedule: null,
      session: null,
    });
  });

  it.each([
    ["extra key", { ...DEMO_SCENARIO, unexpected: true }],
    ["missing field", {
      diners: 2,
      availableFrom: DEMO_SCENARIO.availableFrom,
      serveAt: DEMO_SCENARIO.serveAt,
      targetKcalPerPerson: 650,
      kitchen: DEMO_SCENARIO.kitchen,
    }],
    ["invalid availableFrom", { ...DEMO_SCENARIO, availableFrom: "2026-07-18 18:00" }],
    ["fractional diners", { ...DEMO_SCENARIO, diners: 1.5 }],
    ["invalid kitchen", { ...DEMO_SCENARIO, kitchen: { cooks: 0, ovens: 1, burners: 2 } }],
    ["extra kitchen key", {
      ...DEMO_SCENARIO,
      kitchen: { cooks: 1, ovens: 1, burners: 2, grill: 1 },
    }],
    ["invalid target", { ...DEMO_SCENARIO, targetKcalPerPerson: 0 }],
    ["invalid tolerance", { ...DEMO_SCENARIO, serveToleranceMinutes: 4 }],
  ])("resets settings with %s", (_label, settings) => {
    expectRecovered({ ...reviewSnapshot(), settings });
  });

  const corruptions: Array<[
    string,
    (review: RecipeReviewState & Record<string, unknown>) => void,
  ]> = [
    ["extra review key", (review) => { review.unexpected = true; }],
    ["invalid draft", (review) => {
      (review.draft as unknown as Record<string, unknown>).unexpected = true;
    }],
    ["invalid target servings", (review) => { review.targetServings = 1.5; }],
    ["non-array decisions", (review) => { review.ingredientDecisions = null as never; }],
    ["missing decision", (review) => { review.ingredientDecisions.pop(); }],
    ["duplicate decision", (review) => {
      review.ingredientDecisions[1].ingredientId = review.ingredientDecisions[0].ingredientId;
    }],
    ["extra decision key", (review) => {
      (review.ingredientDecisions[0] as unknown as Record<string, unknown>).extra = true;
    }],
    ["invalid status", (review) => {
      review.ingredientDecisions[0].status = "ignored" as never;
    }],
    ["negative grams", (review) => { review.ingredientDecisions[0].sourceGrams = -1; }],
    ["unclean unresolved match", (review) => {
      review.ingredientDecisions[0].nutritionMatchStatus = "unresolved";
    }],
  ];

  it.each(corruptions)("resets a review state with %s", (_label, corrupt) => {
    const review = structuredClone(DEMO_REVIEW_STATES[0]) as
      RecipeReviewState & Record<string, unknown>;
    corrupt(review);
    expectRecovered({ ...reviewSnapshot(), reviewStates: [review] });
  });
});
