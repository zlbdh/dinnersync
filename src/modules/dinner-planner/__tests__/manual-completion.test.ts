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

function cookingPlanner() {
  const result = buildDinnerPlan({
    settings: DEMO_SCENARIO,
    reviewStates: DEMO_REVIEW_STATES,
    nutritionCatalog: DEMO_NUTRITION_CATALOG,
  });
  if (!result.ok || !result.value.schedule.feasible) {
    throw new Error("Expected the demo plan to be feasible");
  }
  let state = createDinnerPlannerState(DEMO_SCENARIO, DEMO_REVIEW_STATES);
  state = dinnerPlannerReducer(state, { type: "STAGE_CHANGED", stage: "review" });
  state = dinnerPlannerReducer(state, { type: "PLAN_BUILT", plan: result.value });
  return dinnerPlannerReducer(state, {
    type: "SESSION_STARTED",
    session: createCookingSession(result.value.scheduleRequest, result.value.schedule),
  });
}

describe("manual cooking completion", () => {
  it("enters Summary when the final explicit Complete command is accepted", () => {
    let planner = cookingPlanner();

    for (let index = 0; index < 100 && planner.stage === "cook"; index += 1) {
      const beat = nextDemoCommand(planner.session!);
      if (!beat) break;
      planner = dinnerPlannerReducer(planner, {
        type: "SESSION_COMMAND",
        command: beat.command,
      });
    }

    expect(Object.values(planner.session!.runtime).every((task) =>
      task.status === "completed")).toBe(true);
    expect(planner.stage).toBe("summary");
  });
});
