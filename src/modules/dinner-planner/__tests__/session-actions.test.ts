import { createCookingSession } from "@/modules/cooking-session";
import {
  DEMO_NUTRITION_CATALOG,
  DEMO_REVIEW_STATES,
  DEMO_SCENARIO,
  nextDemoCommand,
} from "@/modules/demo";
import { describe, expect, it } from "vitest";

import {
  buildDinnerPlan,
  createDinnerPlannerState,
  dinnerPlannerReducer,
} from "../index";

function cookingState() {
  const built = buildDinnerPlan({
    settings: DEMO_SCENARIO,
    reviewStates: DEMO_REVIEW_STATES,
    nutritionCatalog: DEMO_NUTRITION_CATALOG,
  });
  if (!built.ok || !built.value.schedule.feasible) throw new Error("Expected demo plan");
  let state = createDinnerPlannerState(DEMO_SCENARIO, DEMO_REVIEW_STATES);
  state = dinnerPlannerReducer(state, { type: "STAGE_CHANGED", stage: "review" });
  state = dinnerPlannerReducer(state, { type: "PLAN_BUILT", plan: built.value });
  return dinnerPlannerReducer(state, {
    type: "SESSION_STARTED",
    session: createCookingSession(built.value.scheduleRequest, built.value.schedule),
  });
}

describe("dinner planner cooking actions", () => {
  it("advances time before applying a real session command", () => {
    const state = cookingState();
    const beat = nextDemoCommand(state.session!);
    expect(beat?.command.type).toBe("START");

    const next = dinnerPlannerReducer(state, {
      type: "SESSION_COMMAND",
      command: beat!.command,
    });

    expect(next.session?.events).toContainEqual(expect.objectContaining({
      type: "TASK_STARTED",
      taskId: beat!.command.taskId,
      at: beat!.command.at,
    }));
    expect(next.session?.runtime[beat!.command.taskId].status).toBe("running");
  });

  it("derives due state from the supplied instant without mutating the input", () => {
    const state = cookingState();
    const start = nextDemoCommand(state.session!)!;
    const running = dinnerPlannerReducer(state, {
      type: "SESSION_COMMAND",
      command: start.command,
    });
    const expectedEnd = running.session!.runtime[start.command.taskId].expectedEnd!;

    const due = dinnerPlannerReducer(running, {
      type: "SESSION_TIME_ADVANCED",
      now: expectedEnd,
    });

    expect(due.session?.runtime[start.command.taskId].status).toBe("due");
    expect(running.session?.runtime[start.command.taskId].status).toBe("running");
  });

  it("ignores cooking actions outside the cook stage", () => {
    const setup = createDinnerPlannerState(DEMO_SCENARIO, DEMO_REVIEW_STATES);
    const command = {
      type: "START" as const,
      taskId: "chicken-preheat",
      at: DEMO_SCENARIO.availableFrom,
    };

    expect(dinnerPlannerReducer(setup, {
      type: "SESSION_COMMAND", command,
    })).toBe(setup);
    expect(dinnerPlannerReducer(setup, {
      type: "SESSION_TIME_ADVANCED", now: DEMO_SCENARIO.availableFrom,
    })).toBe(setup);
  });
});
