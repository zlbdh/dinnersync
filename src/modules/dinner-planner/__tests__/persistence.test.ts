import { createCookingSession } from "@/modules/cooking-session";
import {
  DEMO_NUTRITION_CATALOG,
  DEMO_REVIEW_STATES,
  DEMO_SCENARIO,
  runDemoDelayScenario,
} from "@/modules/demo";
import { describe, expect, it } from "vitest";

import {
  buildDinnerPlan,
  createDinnerPlannerPersistence,
  createDinnerPlannerState,
  readDinnerPlannerRevision,
  restoreDinnerPlanner,
  serializeDinnerPlanner,
  snapshotDinnerPlanner,
} from "../index";
import type {
  DinnerPlannerPersistenceSeed,
  DinnerPlannerState,
} from "../index";

const NOW = "2026-07-18T18:24:00.000Z";
const REVISION = "4f1aa33d-7b62-47a4-935e-1d63833fd7c0";

function seed(): DinnerPlannerPersistenceSeed {
  return {
    settings: DEMO_SCENARIO,
    reviewStates: DEMO_REVIEW_STATES,
    nutritionCatalog: DEMO_NUTRITION_CATALOG,
  };
}

function cookingState(): DinnerPlannerState {
  const built = buildDinnerPlan(seed());
  if (!built.ok || !built.value.schedule.feasible) throw new Error("Expected demo plan");
  const base = createDinnerPlannerState(DEMO_SCENARIO, [...DEMO_REVIEW_STATES]);
  return {
    ...base,
    stage: "cook",
    plan: built.value,
    session: runDemoDelayScenario(createCookingSession(
      built.value.scheduleRequest,
      built.value.schedule,
    )),
  };
}

describe("dinner planner persistence", () => {
  it("stores only V1 source/derived fields and a replayable SessionSnapshotV1", () => {
    const state = cookingState() as DinnerPlannerState & Record<string, unknown>;
    state.codexSession = "must-not-persist";
    state.authToken = "secret";
    state.tempDir = "C:/sensitive/temp";
    const snapshot = snapshotDinnerPlanner(state);

    expect(Object.keys(snapshot).sort()).toEqual([
      "nutrition",
      "recipes",
      "reviewStates",
      "revision",
      "schedule",
      "scheduleRequest",
      "session",
      "settings",
      "stage",
      "version",
    ]);
    expect(snapshot.session && Object.keys(snapshot.session).sort()).toEqual([
      "events",
      "initialSchedule",
      "request",
      "version",
    ]);
    expect(snapshot).not.toHaveProperty("errors");
    expect(snapshot).not.toHaveProperty("warnings");
    expect(snapshot.session).not.toHaveProperty("runtime");
    expect(JSON.stringify(snapshot)).not.toMatch(/codexSession|authToken|tempDir|secret/);
  });

  it("stores the caller revision with the planner snapshot", () => {
    const snapshot = snapshotDinnerPlanner(cookingState(), REVISION);

    expect(snapshot).toHaveProperty("revision", REVISION);
  });

  it("persists the same caller revision through the storage adapter", () => {
    let stored: string | null = null;
    const storage = {
      getItem() { return stored; },
      setItem(_key: string, value: string) { stored = value; },
      removeItem() { stored = null; },
    };
    const persistence = createDinnerPlannerPersistence("dinnersync", () => storage);

    persistence.save(cookingState(), REVISION);

    expect(JSON.parse(stored!)).toHaveProperty("revision", REVISION);
    expect(readDinnerPlannerRevision(stored)).toBe(REVISION);
  });

  it.each([
    ["missing", serializeDinnerPlanner(cookingState())],
    ["malformed", JSON.stringify({ revision: "not-a-revision" })],
    ["oversized", `${serializeDinnerPlanner(cookingState())}${" ".repeat(4 * 1024 * 1024)}`],
  ])("does not expose a %s planner revision", (_label, serialized) => {
    expect(readDinnerPlannerRevision(serialized)).toBeNull();
  });

  it("recomputes plan data and replays session events on restore", () => {
    const source = cookingState();
    const restored = restoreDinnerPlanner(serializeDinnerPlanner(source), seed(), NOW);

    expect(restored.stage).toBe("cook");
    expect(restored.plan).toEqual(source.plan);
    expect(restored.plan?.nutrition.knownMealKcal).toBe(1_300.28);
    expect(restored.session?.runtime["chicken-roast"]).toMatchObject({
      status: "running",
      actualStart: "2026-07-18T18:16:00.000Z",
      expectedEnd: "2026-07-18T18:46:00.000Z",
    });
    expect(restored.session?.events).toEqual(source.session?.events);
  });

  it.each([
    ["damaged JSON", "{"],
    ["unknown version", JSON.stringify({ version: 2 })],
  ])("safely resets %s", (_label, serialized) => {
    const restored = restoreDinnerPlanner(serialized, seed(), NOW);

    expect(restored.stage).toBe("setup");
    expect(restored.plan).toBeNull();
    expect(restored.session).toBeNull();
    expect(restored.warnings).toContainEqual(expect.objectContaining({
      category: "storage",
      code: "SNAPSHOT_RECOVERED",
    }));
  });

  it("rejects stale derived values and returns the safe seed instead of trusting them", () => {
    const snapshot = snapshotDinnerPlanner(cookingState());
    if (!snapshot.nutrition) throw new Error("Expected nutrition");
    snapshot.nutrition.knownMealKcal = 1;
    const restored = restoreDinnerPlanner(JSON.stringify(snapshot), seed(), NOW);

    expect(restored.plan).toBeNull();
    expect(restored.stage).toBe("setup");
    expect(restored.warnings.some((warning) =>
      warning.code === "SNAPSHOT_RECOVERED")).toBe(true);
  });

  it("does not restore summary before every session task is completed", () => {
    const snapshot = snapshotDinnerPlanner(cookingState());
    snapshot.stage = "summary";
    const restored = restoreDinnerPlanner(JSON.stringify(snapshot), seed(), NOW);

    expect(restored.stage).toBe("setup");
    expect(restored.warnings).toContainEqual(expect.objectContaining({
      code: "SNAPSHOT_RECOVERED",
    }));
  });

  it("falls back to memory after quota/set failure and keeps the warning sticky", () => {
    const quotaStorage = {
      getItem() { return null; },
      setItem() { throw new Error("QuotaExceededError"); },
      removeItem() { throw new Error("QuotaExceededError"); },
    };
    const persistence = createDinnerPlannerPersistence("dinnersync", () => quotaStorage);
    const saved = persistence.save(cookingState());
    const originalWarningMessage = saved.warnings[0].message;
    saved.warnings[0].message = "mutated";
    const restored = persistence.restore(seed(), NOW);

    expect(saved.warnings).toContainEqual(expect.objectContaining({
      code: "STORAGE_UNAVAILABLE",
    }));
    expect(restored.session?.runtime["chicken-roast"].expectedEnd)
      .toBe("2026-07-18T18:46:00.000Z");
    expect(restored.warnings).toContainEqual(expect.objectContaining({
      code: "STORAGE_UNAVAILABLE",
      message: originalWarningMessage,
    }));
  });

  it("falls back to memory after a storage getter or getItem failure", () => {
    const getterFailure = createDinnerPlannerPersistence("getter", () => {
      throw new Error("blocked getter");
    });
    expect(getterFailure.save(cookingState()).warnings).toContainEqual(
      expect.objectContaining({ code: "STORAGE_UNAVAILABLE" }),
    );

    let failRead = false;
    let stored: string | null = null;
    const storage = {
      getItem() {
        if (failRead) throw new Error("blocked read");
        return stored;
      },
      setItem(_key: string, value: string) { stored = value; },
      removeItem() { stored = null; },
    };
    const readFailure = createDinnerPlannerPersistence("read", () => storage);
    readFailure.save(cookingState());
    failRead = true;
    const restored = readFailure.restore(seed(), NOW);

    expect(restored.stage).toBe("cook");
    expect(restored.warnings).toContainEqual(expect.objectContaining({
      code: "STORAGE_UNAVAILABLE",
    }));
  });

  it("restores an infeasible ScheduleResult with its issues and earliestFeasible", () => {
    const built = buildDinnerPlan({
      ...seed(),
      settings: { ...DEMO_SCENARIO, serveAt: "2026-07-18T18:20:00.000Z" },
    });
    if (!built.ok || built.value.schedule.feasible) throw new Error("Expected infeasible plan");
    const state = {
      ...createDinnerPlannerState(
        { ...DEMO_SCENARIO, serveAt: "2026-07-18T18:20:00.000Z" },
        [...DEMO_REVIEW_STATES],
      ),
      stage: "plan" as const,
      plan: built.value,
    };
    const restored = restoreDinnerPlanner(serializeDinnerPlanner(state), {
      ...seed(),
      settings: state.settings,
    }, NOW);

    expect(restored.plan?.schedule).toEqual(built.value.schedule);
    expect(restored.plan?.schedule.feasible).toBe(false);
    if (restored.plan && !restored.plan.schedule.feasible) {
      expect(restored.plan.schedule).toHaveProperty("issues");
      expect(restored.plan.schedule).toHaveProperty("earliestFeasible");
    }
  });
});
