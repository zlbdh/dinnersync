import {
  advanceSessionTime,
  applySessionCommand,
  createCookingSession,
} from "@/modules/cooking-session";
import type { CookingSessionState } from "@/modules/cooking-session";
import {
  DEMO_NUTRITION_CATALOG,
  DEMO_REVIEW_STATES,
  DEMO_SCENARIO,
} from "@/modules/demo";
import type { RecipeReviewState } from "@/modules/recipe-import";
import { describe, expect, it } from "vitest";

import {
  buildDinnerPlan,
  createDinnerPlannerState,
  dinnerPlannerReducer,
  restoreDinnerPlanner,
  serializeDinnerPlanner,
  snapshotDinnerPlanner,
} from "../index";
import type {
  DinnerPlan,
  DinnerPlannerPersistenceSeed,
  DinnerPlannerStage,
  DinnerPlannerState,
} from "../index";
import { validRecipeReviewStates } from "../snapshot-validation";

const NOW = "2026-07-18T19:00:00.000Z";

function seed(): DinnerPlannerPersistenceSeed {
  return {
    settings: DEMO_SCENARIO,
    reviewStates: DEMO_REVIEW_STATES,
    nutritionCatalog: DEMO_NUTRITION_CATALOG,
  };
}

function completeOnSchedule(
  initial: CookingSessionState,
  plan: DinnerPlan,
) {
  if (!plan.schedule.feasible) throw new Error("Expected feasible demo plan");
  const commands = plan.schedule.tasks.flatMap((task) => [
    { type: "START" as const, taskId: task.taskId, at: task.plannedStart },
    { type: "COMPLETE" as const, taskId: task.taskId, at: task.plannedEnd },
  ]).sort((left, right) => Date.parse(left.at) - Date.parse(right.at)
    || (left.type === right.type ? left.taskId.localeCompare(right.taskId)
      : left.type === "COMPLETE" ? -1 : 1));
  return commands.reduce((state, command) => applySessionCommand(
    advanceSessionTime(state, command.at),
    command,
  ), initial);
}

function reachableStates(): Record<DinnerPlannerStage, DinnerPlannerState> {
  const built = buildDinnerPlan(seed());
  if (!built.ok || !built.value.schedule.feasible) throw new Error("Expected demo plan");
  const setup = createDinnerPlannerState(DEMO_SCENARIO, DEMO_REVIEW_STATES);
  const review = dinnerPlannerReducer(setup, {
    type: "STAGE_CHANGED",
    stage: "review",
  });
  const plan = dinnerPlannerReducer(review, { type: "PLAN_BUILT", plan: built.value });
  const cook = dinnerPlannerReducer(plan, {
    type: "SESSION_STARTED",
    session: createCookingSession(built.value.scheduleRequest, built.value.schedule),
  });
  const completedCook = {
    ...cook,
    session: completeOnSchedule(cook.session!, built.value),
  };
  const summary = dinnerPlannerReducer(completedCook, {
    type: "STAGE_CHANGED",
    stage: "summary",
  });
  return { setup, review, plan, cook, summary };
}

function fourReviewStates(): RecipeReviewState[] {
  const reviews = structuredClone([...DEMO_REVIEW_STATES]);
  const fourth = structuredClone(DEMO_REVIEW_STATES[0]);
  const ingredientIds = new Map(fourth.draft.ingredients.map((ingredient) => [
    ingredient.id,
    `fourth-${ingredient.id}`,
  ]));
  const stepIds = new Map(fourth.draft.steps.map((step) => [
    step.id,
    `fourth-${step.id}`,
  ]));
  fourth.draft.id = "fourth-recipe";
  fourth.draft.ingredients.forEach((ingredient) => {
    ingredient.id = ingredientIds.get(ingredient.id)!;
  });
  fourth.ingredientDecisions.forEach((decision) => {
    decision.ingredientId = ingredientIds.get(decision.ingredientId)!;
  });
  fourth.draft.steps.forEach((step) => {
    step.id = stepIds.get(step.id)!;
    step.dependsOn.value = step.dependsOn.value.map((id) => stepIds.get(id) ?? id);
  });
  return [...reviews, fourth];
}

function oversizedSources(): RecipeReviewState[] {
  return structuredClone([...DEMO_REVIEW_STATES]).map((review) => {
    const sourceText = review.draft.sourceText.padEnd(9_000, " ");
    review.draft.sourceText = sourceText;
    review.draft.ingredients.forEach((ingredient) => {
      ingredient.sourceText = sourceText;
    });
    review.draft.steps.forEach((step) => {
      step.sourceText = sourceText;
    });
    return review;
  });
}

function expectRecovered(serialized: string) {
  const restored = restoreDinnerPlanner(serialized, seed(), NOW);
  expect(restored).toMatchObject({
    stage: "setup",
    plan: null,
    session: null,
    settings: DEMO_SCENARIO,
    reviewStates: DEMO_REVIEW_STATES,
  });
  expect(restored.warnings).toContainEqual(expect.objectContaining({
    code: "SNAPSHOT_RECOVERED",
  }));
}

describe("dinner planner snapshot reachability", () => {
  it("rejects more than three review states at the persistence boundary", () => {
    expect(validRecipeReviewStates(fourReviewStates())).toBe(false);
  });

  it("rejects review states whose combined source text exceeds the input boundary", () => {
    expect(validRecipeReviewStates(oversizedSources())).toBe(false);
  });

  it.each(["review", "plan", "cook", "summary"] as const)(
    "recovers %s snapshots with no review states",
    (stage) => {
      const snapshot = snapshotDinnerPlanner(reachableStates()[stage]);
      snapshot.reviewStates = [];
      expectRecovered(JSON.stringify(snapshot));
    },
  );

  it.each(["review", "plan", "cook", "summary"] as const)(
    "recovers %s snapshots with more than three review states",
    (stage) => {
      const snapshot = snapshotDinnerPlanner(reachableStates()[stage]);
      snapshot.reviewStates = fourReviewStates();
      expectRecovered(JSON.stringify(snapshot));
    },
  );

  it("rejects an oversized serialized snapshot before restoring its derived plan", () => {
    const serialized = serializeDinnerPlanner(reachableStates().plan)
      + " ".repeat(4 * 1024 * 1024);
    expectRecovered(serialized);
  });
});

describe("validated restore action boundary", () => {
  it("keeps the restore marker private when a restored state is spread", () => {
    const states = reachableStates();
    const restored = restoreDinnerPlanner(serializeDinnerPlanner(states.plan), seed(), NOW);
    const symbols = Object.getOwnPropertySymbols(restored);

    expect(symbols).toHaveLength(1);
    expect(Object.getOwnPropertyDescriptor(restored, symbols[0])?.enumerable).toBe(false);
    expect(Object.getOwnPropertySymbols({ ...restored })).toHaveLength(0);
  });

  it("rejects a validated plan whose derived contents are mutated before dispatch", () => {
    const states = reachableStates();
    const restored = restoreDinnerPlanner(serializeDinnerPlanner(states.plan), seed(), NOW);
    if (!restored.plan) throw new Error("Expected restored plan");
    restored.plan.nutrition.knownMealKcal = 1;

    expect(dinnerPlannerReducer(states.setup, {
      type: "VALIDATED_STATE_RESTORED",
      state: restored,
    })).toBe(states.setup);
  });

  it.each(["review", "plan", "cook", "summary"] as const)(
    "rejects a persistence-validated %s state mutated to have no reviews",
    (stage) => {
      const states = reachableStates();
      const restored = restoreDinnerPlanner(serializeDinnerPlanner(states[stage]), seed(), NOW);
      const mutated = { ...restored, reviewStates: [] };

      expect(dinnerPlannerReducer(states.setup, {
        type: "VALIDATED_STATE_RESTORED",
        state: mutated,
      })).toBe(states.setup);
    },
  );

  it("rejects a persistence-validated state mutated beyond the review limit", () => {
    const states = reachableStates();
    const restored = restoreDinnerPlanner(serializeDinnerPlanner(states.review), seed(), NOW);
    const mutated = { ...restored, reviewStates: fourReviewStates() };

    expect(dinnerPlannerReducer(states.setup, {
      type: "VALIDATED_STATE_RESTORED",
      state: mutated,
    })).toBe(states.setup);
  });

  it("rejects an unvalidated but otherwise reachable restore payload", () => {
    const states = reachableStates();

    expect(dinnerPlannerReducer(states.setup, {
      type: "VALIDATED_STATE_RESTORED",
      state: states.plan,
    })).toBe(states.setup);
  });

  it.each(["setup", "review", "plan", "cook", "summary"] as const)(
    "accepts the reachable %s state returned by persistence",
    (stage) => {
      const states = reachableStates();
      const restored = restoreDinnerPlanner(serializeDinnerPlanner(states[stage]), seed(), NOW);
      const next = dinnerPlannerReducer(states.setup, {
        type: "VALIDATED_STATE_RESTORED",
        state: restored,
      });

      expect(next).toEqual(structuredClone(restored));
      expect(next).not.toBe(states.setup);
    },
  );
});
