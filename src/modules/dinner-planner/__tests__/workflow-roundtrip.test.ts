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
import { describe, expect, it } from "vitest";

import {
  buildDinnerPlan,
  createDinnerPlannerState,
  dinnerPlannerReducer,
  restoreDinnerPlanner,
  serializeDinnerPlanner,
} from "../index";
import type {
  DinnerPlan,
  DinnerPlannerPersistenceSeed,
  DinnerPlannerState,
} from "../index";

function seed(): DinnerPlannerPersistenceSeed {
  return {
    settings: DEMO_SCENARIO,
    reviewStates: DEMO_REVIEW_STATES,
    nutritionCatalog: DEMO_NUTRITION_CATALOG,
  };
}

function reachableFlow() {
  const built = buildDinnerPlan(seed());
  if (!built.ok || !built.value.schedule.feasible) throw new Error("Expected demo plan");
  const setup = createDinnerPlannerState(DEMO_SCENARIO, DEMO_REVIEW_STATES);
  const review = dinnerPlannerReducer(setup, {
    type: "STAGE_CHANGED", stage: "review",
  });
  const plan = dinnerPlannerReducer(review, {
    type: "PLAN_BUILT", plan: built.value,
  });
  const cook = dinnerPlannerReducer(plan, {
    type: "SESSION_STARTED",
    session: createCookingSession(built.value.scheduleRequest, built.value.schedule),
  });
  return { setup, review, plan, cook, dinnerPlan: built.value };
}

function completeOnSchedule(
  initial: CookingSessionState,
  plan: DinnerPlan,
) {
  if (!plan.schedule.feasible) throw new Error("Expected feasible schedule");
  const actions = plan.schedule.tasks.flatMap((task) => [
    { type: "START" as const, taskId: task.taskId, at: task.plannedStart },
    { type: "COMPLETE" as const, taskId: task.taskId, at: task.plannedEnd },
  ]).sort((left, right) => Date.parse(left.at) - Date.parse(right.at)
    || (left.type === right.type ? left.taskId.localeCompare(right.taskId)
      : left.type === "COMPLETE" ? -1 : 1));
  return actions.reduce((state, command) => applySessionCommand(
    advanceSessionTime(state, command.at),
    command,
  ), initial);
}

function restore(
  state: DinnerPlannerState,
  now: string = DEMO_SCENARIO.availableFrom,
) {
  return restoreDinnerPlanner(serializeDinnerPlanner(state), seed(), now);
}

describe("reachable dinner planner workflow snapshots", () => {
  it("round-trips every reachable non-summary stage", () => {
    const flow = reachableFlow();
    for (const state of [flow.setup, flow.review, flow.plan, flow.cook]) {
      const restored = restore(state);
      expect(restored.stage).toBe(state.stage);
      expect(restored.plan).toEqual(state.plan);
      expect(restored.session?.events ?? null).toEqual(state.session?.events ?? null);
      expect(restored.warnings).toEqual([]);
    }
  });

  it("round-trips summary only with a nonempty fully completed runtime", () => {
    const flow = reachableFlow();
    const completed = completeOnSchedule(flow.cook.session!, flow.dinnerPlan);
    expect(Object.keys(completed.runtime).length).toBeGreaterThan(0);
    expect(Object.values(completed.runtime).every((task) =>
      task.status === "completed")).toBe(true);
    const summary = dinnerPlannerReducer(
      { ...flow.cook, session: completed },
      { type: "STAGE_CHANGED", stage: "summary" },
    );
    expect(summary.stage).toBe("summary");

    const restored = restore(summary, DEMO_SCENARIO.serveAt);
    expect(restored.stage).toBe("summary");
    expect(Object.values(restored.session!.runtime).every((task) =>
      task.status === "completed")).toBe(true);
    expect(restored.warnings).toEqual([]);
  });
});
