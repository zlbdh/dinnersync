import { DEMO_REVIEW_STATES, DEMO_SCENARIO } from "@/modules/demo";
import { describe, expect, it } from "vitest";

import {
  createDinnerPlannerState,
  dinnerPlannerReducer,
} from "@/modules/dinner-planner";

describe("dinner planner review entry", () => {
  it("keeps setup unchanged when no review data exists", () => {
    const setup = createDinnerPlannerState(DEMO_SCENARIO, []);

    const next = dinnerPlannerReducer(setup, {
      type: "STAGE_CHANGED",
      stage: "review",
    });

    expect(next).toBe(setup);
    expect(next.stage).toBe("setup");
  });

  it("enters review with a deep copy and does not mutate setup or its seed", () => {
    const seed = structuredClone(DEMO_REVIEW_STATES);
    const setup = createDinnerPlannerState(DEMO_SCENARIO, seed);
    const originalName = setup.reviewStates[0].draft.name.value;

    const next = dinnerPlannerReducer(setup, {
      type: "STAGE_CHANGED",
      stage: "review",
    });

    expect(next.stage).toBe("review");
    expect(next.reviewStates).toEqual(setup.reviewStates);
    expect(next.reviewStates).not.toBe(setup.reviewStates);
    expect(next.reviewStates[0].draft).not.toBe(setup.reviewStates[0].draft);

    next.reviewStates[0].draft.name.value = "Changed only in review";
    expect(setup.reviewStates[0].draft.name.value).toBe(originalName);
    expect(seed[0].draft.name.value).toBe(originalName);
  });
});
