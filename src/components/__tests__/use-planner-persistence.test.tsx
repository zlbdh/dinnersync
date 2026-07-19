import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCallback, useReducer } from "react";

import {
  DEMO_NUTRITION_CATALOG,
  DEMO_REVIEW_STATES,
  DEMO_SCENARIO,
} from "@/modules/demo";
import {
  buildDinnerPlan,
  createDinnerPlannerState,
  dinnerPlannerReducer,
  readDinnerPlannerRevision,
  serializeDinnerPlanner,
  type DinnerPlannerState,
} from "@/modules/dinner-planner";
import type { IsoInstant } from "@/shared";

import { serializePlanningContext, type PlanningMode } from "../planning-context";
import {
  PLANNER_STORAGE_KEY,
  PLANNING_CONTEXT_STORAGE_KEY,
  usePlannerPersistence,
} from "../use-planner-persistence";

const REVISION_A = "4f1aa33d-7b62-47a4-935e-1d63833fd7c0";
const REVISION_B = "caabcb40-e77f-4418-85a4-b7538f274fa0";
const WALL_CLOCK = 100_000;

function planState(): DinnerPlannerState {
  const built = buildDinnerPlan({
    settings: DEMO_SCENARIO,
    reviewStates: DEMO_REVIEW_STATES,
    nutritionCatalog: DEMO_NUTRITION_CATALOG,
  });
  if (!built.ok) throw new Error("Expected demo plan");
  return {
    ...createDinnerPlannerState(DEMO_SCENARIO, DEMO_REVIEW_STATES),
    stage: "plan",
    plan: built.value,
  };
}

function useHarness(restoreSpy: (
  origin: PlanningMode | null,
  now: IsoInstant,
  wallClockMs: number,
) => void) {
  const [planner, dispatch] = useReducer(
    dinnerPlannerReducer,
    createDinnerPlannerState(DEMO_SCENARIO, []),
  );
  const restoreUiContext = useCallback((
    origin: PlanningMode | null,
    now: IsoInstant,
    wallClockMs: number,
  ) => restoreSpy(origin, now, wallClockMs), [restoreSpy]);
  const stored = usePlannerPersistence(
    planner,
    dispatch,
    "hosted",
    DEMO_SCENARIO.availableFrom,
    restoreUiContext,
    DEMO_SCENARIO,
  );
  return { planner, ...stored };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("usePlannerPersistence revision binding", () => {
  it("restores origin and virtual time only when planner and context revisions match", async () => {
    vi.spyOn(Date, "now").mockReturnValue(WALL_CLOCK);
    localStorage.setItem(PLANNER_STORAGE_KEY, serializeDinnerPlanner(planState(), REVISION_A));
    localStorage.setItem(PLANNING_CONTEXT_STORAGE_KEY, serializePlanningContext(
      "local",
      DEMO_SCENARIO.availableFrom,
      WALL_CLOCK - 60_000,
      REVISION_A,
    ));
    const restored = vi.fn();

    const view = renderHook(() => useHarness(restored));

    await waitFor(() => expect(view.result.current.hydrated).toBe(true));
    expect(restored).toHaveBeenCalledWith(
      "local",
      "2026-07-18T18:01:00.000Z",
      WALL_CLOCK,
    );
  });

  it("rejects stale context when its revision belongs to another planner write", async () => {
    vi.spyOn(Date, "now").mockReturnValue(WALL_CLOCK);
    localStorage.setItem(PLANNER_STORAGE_KEY, serializeDinnerPlanner(planState(), REVISION_A));
    localStorage.setItem(PLANNING_CONTEXT_STORAGE_KEY, serializePlanningContext(
      "local",
      "2026-07-18T18:20:00.000Z",
      WALL_CLOCK - 60_000,
      REVISION_B,
    ));
    const restored = vi.fn();

    const view = renderHook(() => useHarness(restored));

    await waitFor(() => expect(view.result.current.hydrated).toBe(true));
    expect(view.result.current.planner.stage).toBe("plan");
    expect(view.result.current.planner.warnings).toContainEqual(expect.objectContaining({
      code: "SNAPSHOT_RECOVERED",
    }));
    expect(restored).toHaveBeenCalledWith(
      null,
      DEMO_SCENARIO.availableFrom,
      WALL_CLOCK,
    );
  });

  it("writes one shared revision for the planner and its UI context", async () => {
    vi.spyOn(Date, "now").mockReturnValue(WALL_CLOCK);
    const restored = vi.fn();

    const view = renderHook(() => useHarness(restored));

    await waitFor(() => expect(view.result.current.hydrated).toBe(true));
    await act(async () => undefined);
    const plannerRevision = readDinnerPlannerRevision(
      localStorage.getItem(PLANNER_STORAGE_KEY),
    );
    const context = JSON.parse(localStorage.getItem(PLANNING_CONTEXT_STORAGE_KEY)!);
    expect(plannerRevision).toMatch(/^[0-9a-f-]{36}$/i);
    expect(context.revision).toBe(plannerRevision);
  });

  it("leaves a detectable mismatch when the planner write fails but context succeeds", async () => {
    vi.spyOn(Date, "now").mockReturnValue(WALL_CLOCK);
    const values = new Map<string, string>([
      [PLANNER_STORAGE_KEY, serializeDinnerPlanner(planState(), REVISION_A)],
      [PLANNING_CONTEXT_STORAGE_KEY, serializePlanningContext(
        "local",
        DEMO_SCENARIO.availableFrom,
        WALL_CLOCK,
        REVISION_A,
      )],
    ]);
    const storage = {
      getItem(key: string) { return values.get(key) ?? null; },
      setItem(key: string, value: string) {
        if (key === PLANNER_STORAGE_KEY) throw new Error("QuotaExceededError");
        values.set(key, value);
      },
      removeItem(key: string) { values.delete(key); },
    };
    vi.stubGlobal("localStorage", storage);
    const restored = vi.fn();

    const view = renderHook(() => useHarness(restored));

    await waitFor(() => expect(view.result.current.hydrated).toBe(true));
    await waitFor(() => expect(values.get(PLANNING_CONTEXT_STORAGE_KEY))
      .not.toBe(serializePlanningContext(
        "local",
        DEMO_SCENARIO.availableFrom,
        WALL_CLOCK,
        REVISION_A,
      )));
    const plannerRevision = readDinnerPlannerRevision(values.get(PLANNER_STORAGE_KEY) ?? null);
    const context = JSON.parse(values.get(PLANNING_CONTEXT_STORAGE_KEY)!);
    expect(context.revision).toMatch(/^[0-9a-f-]{36}$/i);
    expect(context.revision).not.toBe(plannerRevision);
  });
});
