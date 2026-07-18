import { toEpochMs } from "@/shared";
import type { KitchenResources } from "@/shared";
import { describe, expect, it, vi } from "vitest";

import { scheduleForwardEarliest } from "../forward-schedule";
import type { ScheduleRequest, ScheduleTask } from "../types";

const KITCHEN: KitchenResources = { cooks: 1, ovens: 1, burners: 2 };

function task(id: string, overrides: Partial<ScheduleTask> = {}): ScheduleTask {
  return {
    id,
    recipeId: id,
    sourceText: `${id} source`,
    instruction: id,
    durationMinutes: 5,
    mode: "passive",
    dependsOn: [],
    resources: [],
    ovenOperation: null,
    ovenTemperatureC: null,
    isTerminal: true,
    ...overrides,
  };
}

function request(tasks: ScheduleTask[], overrides: Partial<ScheduleRequest> = {}): ScheduleRequest {
  return {
    tasks,
    kitchen: KITCHEN,
    availableFrom: "2026-07-18T18:00:00Z",
    serveAt: "2026-07-18T19:00:00Z",
    serveToleranceMinutes: 5,
    ...overrides,
  };
}

function byId(result: ReturnType<typeof scheduleForwardEarliest>) {
  if (!result.feasible) throw new Error("expected a feasible forward schedule");
  return new Map(result.tasks.map((entry) => [entry.taskId, entry]));
}

describe("scheduleForwardEarliest", () => {
  it("builds a complete dependency and resource-safe timeline from availableFrom", () => {
    const tasks = [
      task("prep-a", {
        recipeId: "a",
        mode: "active",
        resources: [{ resourceId: "burner:1" }],
        isTerminal: false,
      }),
      task("simmer-a", {
        recipeId: "a",
        durationMinutes: 10,
        dependsOn: ["prep-a"],
        resources: [{ resourceId: "burner:1" }],
      }),
      task("prep-b", {
        recipeId: "b",
        mode: "active",
        resources: [{ resourceId: "burner:2" }],
        isTerminal: false,
      }),
      task("simmer-b", {
        recipeId: "b",
        durationMinutes: 10,
        dependsOn: ["prep-b"],
        resources: [{ resourceId: "burner:2" }],
      }),
    ];

    const result = scheduleForwardEarliest(request(tasks));
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.tasks).toHaveLength(4);
    const scheduled = byId(result);
    expect(scheduled.get("prep-a")!.plannedStart).toBe("2026-07-18T18:00:00.000Z");
    expect(scheduled.get("prep-b")!.plannedStart).toBe("2026-07-18T18:05:00.000Z");
    expect(toEpochMs(scheduled.get("simmer-a")!.plannedStart))
      .toBeGreaterThanOrEqual(toEpochMs(scheduled.get("prep-a")!.plannedEnd));
    expect(toEpochMs(scheduled.get("simmer-b")!.plannedStart))
      .toBeGreaterThanOrEqual(toEpochMs(scheduled.get("prep-b")!.plannedEnd));
    expect(result.serveAt).toBe("2026-07-18T18:20:00.000Z");
  });

  it("lets passive device work overlap active work on another burner", () => {
    const tasks = [
      task("passive", {
        resources: [{ resourceId: "burner:1" }],
        durationMinutes: 10,
      }),
      task("active", {
        mode: "active",
        resources: [{ resourceId: "burner:2" }],
        durationMinutes: 10,
      }),
    ];
    const scheduled = byId(scheduleForwardEarliest(request(tasks)));
    expect(scheduled.get("passive")!.plannedStart)
      .toBe(scheduled.get("active")!.plannedStart);
  });

  it("keeps an explicit cook lock on a passive task", () => {
    const tasks = [
      task("explicit-cook", {
        resources: [{ resourceId: "cook:1" }],
        durationMinutes: 10,
      }),
      task("active", { mode: "active", durationMinutes: 10 }),
    ];
    const scheduled = byId(scheduleForwardEarliest(request(tasks)));
    const firstEnd = toEpochMs(scheduled.get("active")!.plannedEnd);
    const secondStart = toEpochMs(scheduled.get("explicit-cook")!.plannedStart);
    expect(secondStart).toBeGreaterThanOrEqual(firstEnd);
  });

  it("returns the same canonical snapshot for task permutations", () => {
    const tasks = [task("z"), task("a"), task("m")];
    expect(scheduleForwardEarliest(request(tasks))).toEqual(
      scheduleForwardEarliest(request([tasks[2], tasks[0], tasks[1]])),
    );
  });

  it("treats equivalent offsets across midnight as the same instant", () => {
    const tasks = [task("midnight", { durationMinutes: 10 })];
    const offset = request(tasks, {
      availableFrom: "2026-07-18T23:55:00-07:00",
      serveAt: "2026-07-19T08:00:00Z",
    });
    const utc = request(tasks, {
      availableFrom: "2026-07-19T06:55:00Z",
      serveAt: "2026-07-19T08:00:00+00:00",
    });
    const expected = scheduleForwardEarliest(utc);
    expect(scheduleForwardEarliest(offset)).toEqual(expected);
    expect(expected).toMatchObject({
      feasible: true,
      serveAt: "2026-07-19T07:05:00.000Z",
    });
  });

  it("returns graph issues with no fabricated earliest timeline", () => {
    const invalid = [task("self", { dependsOn: ["self"] })];
    expect(scheduleForwardEarliest(request(invalid))).toMatchObject({
      feasible: false,
      issues: [{ code: "DEPENDENCY_CYCLE", taskIds: ["self"] }],
      earliestFeasible: null,
    });
  });

  it.each([
    ["availableFrom", { availableFrom: "not-an-instant" }],
    ["serveAt", { serveAt: "2026-02-30T18:00:00Z" }],
  ])("returns a structured issue for invalid %s", (field, overrides) => {
    const action = () => scheduleForwardEarliest(request([task("valid")], overrides));
    expect(action).not.toThrow();
    expect(action()).toEqual({
      feasible: false,
      issues: [{ code: "INVALID_TIME", taskIds: [field] }],
      earliestFeasible: null,
    });
  });

  it("does not read the system clock", () => {
    const clock = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("clock access is forbidden");
    });
    try {
      expect(scheduleForwardEarliest(request([task("pure")])).feasible).toBe(true);
    } finally {
      clock.mockRestore();
    }
  });
});
