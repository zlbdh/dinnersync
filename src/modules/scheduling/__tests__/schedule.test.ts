import { toEpochMs } from "@/shared";
import type { KitchenResources, ResourceId } from "@/shared";
import { describe, expect, it } from "vitest";

import { scheduleDinner } from "../schedule";
import type { Schedule, ScheduleRequest, ScheduleTask } from "../types";

const KITCHEN: KitchenResources = { cooks: 1, ovens: 1, burners: 2 };

function task(id: string, overrides: Partial<ScheduleTask> = {}): ScheduleTask {
  return {
    id,
    recipeId: id,
    sourceText: `${id} source`,
    instruction: id,
    durationMinutes: 1,
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

function timeline(schedule: Schedule) {
  return new Map(schedule.tasks.map((entry) => [entry.taskId, entry]));
}

function overlaps(
  left: { plannedStart: string; plannedEnd: string },
  right: { plannedStart: string; plannedEnd: string },
) {
  return toEpochMs(left.plannedStart) < toEpochMs(right.plannedEnd)
    && toEpochMs(right.plannedStart) < toEpochMs(left.plannedEnd);
}

function expectInvariants(schedule: Schedule, input: ScheduleRequest) {
  const entries = timeline(schedule);
  const available = toEpochMs(input.availableFrom);
  const serve = toEpochMs(input.serveAt);
  for (const current of schedule.tasks) {
    expect(toEpochMs(current.plannedStart)).toBeGreaterThanOrEqual(available);
    const original = input.tasks.find((entry) => entry.id === current.taskId)!;
    for (const dependency of original.dependsOn) {
      expect(toEpochMs(entries.get(dependency)!.plannedEnd))
        .toBeLessThanOrEqual(toEpochMs(current.plannedStart));
    }
    if (original.isTerminal) {
      expect(toEpochMs(current.plannedEnd)).toBeGreaterThanOrEqual(serve - 5 * 60_000);
      expect(toEpochMs(current.plannedEnd)).toBeLessThanOrEqual(serve);
    }
  }
  for (let left = 0; left < schedule.tasks.length; left += 1) {
    for (let right = left + 1; right < schedule.tasks.length; right += 1) {
      const shared = schedule.tasks[left].effectiveResources.some((resource: ResourceId) =>
        schedule.tasks[right].effectiveResources.includes(resource));
      if (shared) expect(overlaps(schedule.tasks[left], schedule.tasks[right])).toBe(false);
    }
  }
}

function servingPair(recipeId: string, resourceId: "burner:1" | "burner:2") {
  return [
    task(`${recipeId}-work`, {
      recipeId,
      durationMinutes: 10,
      resources: [{ resourceId }],
      isTerminal: false,
    }),
    task(`${recipeId}-serve`, { recipeId, dependsOn: [`${recipeId}-work`] }),
  ];
}

function seededPermutation<T>(values: readonly T[], seed: number) {
  const result = [...values];
  let state = seed >>> 0;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    const selected = state % (index + 1);
    [result[index], result[selected]] = [result[selected], result[index]];
  }
  return result;
}

describe("scheduleDinner", () => {
  it("lands three terminals in the five-minute window with dependencies and two burners", () => {
    const tasks = [
      ...servingPair("a", "burner:1"),
      ...servingPair("b", "burner:2"),
      ...servingPair("c", "burner:1"),
    ];
    const input = request(tasks);
    const result = scheduleDinner(input);
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expectInvariants(result, input);
    const entries = timeline(result);
    expect(overlaps(entries.get("a-work")!, entries.get("b-work")!)).toBe(true);
    expect(entries.get("a-serve")!.plannedEnd).toBe("2026-07-18T19:00:00.000Z");
    expect(entries.get("b-serve")!.plannedEnd).toBe("2026-07-18T19:00:00.000Z");
    expect(entries.get("c-serve")!.plannedEnd).toBe("2026-07-18T19:00:00.000Z");
  });

  it("serializes active work and a passive task that explicitly requests cook", () => {
    const tasks = [
      task("a", { mode: "active", durationMinutes: 10 }),
      task("b", { mode: "active", durationMinutes: 10 }),
      task("c", { resources: [{ resourceId: "cook:1" }], durationMinutes: 10 }),
    ];
    const result = scheduleDinner(request(tasks, {
      serveAt: "2026-07-18T18:30:00Z",
      serveToleranceMinutes: 5,
    }));
    expect(result.feasible).toBe(false);
    if (result.feasible || !result.earliestFeasible) return;
    const entries = result.earliestFeasible.tasks;
    expect(overlaps(entries[0], entries[1])).toBe(false);
    expect(overlaps(entries[1], entries[2])).toBe(false);
  });

  it("keeps every oven interval mutually exclusive", () => {
    const ovenRecipe = (id: string) => [
      task(`${id}-heat`, {
        recipeId: id,
        durationMinutes: 5,
        resources: [{ resourceId: "oven:1" }],
        ovenOperation: "preheat",
        ovenTemperatureC: 180,
        isTerminal: false,
      }),
      task(`${id}-cook`, {
        recipeId: id,
        durationMinutes: 10,
        dependsOn: [`${id}-heat`],
        resources: [{ resourceId: "oven:1" }],
        ovenOperation: "cook",
        ovenTemperatureC: 180,
        isTerminal: false,
      }),
      task(`${id}-serve`, { recipeId: id, dependsOn: [`${id}-cook`] }),
    ];
    const result = scheduleDinner(request([...ovenRecipe("a"), ...ovenRecipe("b")]));
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    const oven = result.tasks.filter((entry) => entry.effectiveResources.includes("oven:1"));
    for (let left = 0; left < oven.length; left += 1) {
      for (let right = left + 1; right < oven.length; right += 1) {
        expect(overlaps(oven[left], oven[right])).toBe(false);
      }
    }
  });

  it("requires an explicit temperature-change between different oven cooks", () => {
    const oven = (id: string, operation: "preheat" | "cook", temperature: number) =>
      task(id, {
        recipeId: "oven-meal",
        resources: [{ resourceId: "oven:1" }],
        ovenOperation: operation,
        ovenTemperatureC: temperature,
        isTerminal: false,
      });
    const preheat180 = oven("preheat-180", "preheat", 180);
    const cook180 = oven("cook-180", "cook", 180);
    cook180.dependsOn = ["preheat-180"];
    const wrongPreheat = oven("preheat-200", "preheat", 200);
    wrongPreheat.dependsOn = ["cook-180"];
    const cook200 = oven("cook-200", "cook", 200);
    cook200.dependsOn = ["preheat-200"];
    cook200.isTerminal = true;

    expect(scheduleDinner(request([
      preheat180,
      cook180,
      wrongPreheat,
      cook200,
    ]))).toMatchObject({
      feasible: false,
      issues: [{ code: "OVEN_TRANSITION_REQUIRED" }],
      earliestFeasible: null,
    });
  });

  it("uses stable reverse priority and ignores input order", () => {
    const tasks = [
      task("z-work", { recipeId: "z", mode: "active", durationMinutes: 5, isTerminal: false }),
      task("z-serve", { recipeId: "z", dependsOn: ["z-work"] }),
      task("a-work", { recipeId: "a", mode: "active", durationMinutes: 5, isTerminal: false }),
      task("a-serve", { recipeId: "a", dependsOn: ["a-work"] }),
    ];
    const expected = scheduleDinner(request(tasks));
    expect(expected).toEqual(scheduleDinner(request([...tasks].reverse())));
    expect(expected.feasible).toBe(true);
    if (!expected.feasible) return;
    const entries = timeline(expected);
    expect(toEpochMs(entries.get("a-work")!.plannedStart))
      .toBeGreaterThan(toEpochMs(entries.get("z-work")!.plannedStart));
  });

  it.each([7, 19, 42])("preserves all invariants for fixed seed %s", (seed) => {
    const tasks = [
      ...servingPair("a", "burner:1"),
      ...servingPair("b", "burner:2"),
      task("c-work", { recipeId: "c", mode: "active", durationMinutes: 8, isTerminal: false }),
      task("c-serve", { recipeId: "c", dependsOn: ["c-work"] }),
    ];
    const input = request(seededPermutation(tasks, seed));
    const result = scheduleDinner(input);
    expect(result.feasible).toBe(true);
    if (result.feasible) expectInvariants(result, input);
  });

  it("returns a recomputable forward timeline when the requested window is impossible", () => {
    const tasks = [
      task("prep", { recipeId: "meal", mode: "active", durationMinutes: 20, isTerminal: false }),
      task("serve", { recipeId: "meal", dependsOn: ["prep"] }),
    ];
    const result = scheduleDinner(request(tasks, { serveAt: "2026-07-18T18:10:00Z" }));
    expect(result).toMatchObject({
      feasible: false,
      issues: [{ code: "WINDOW_INFEASIBLE", taskIds: ["prep"] }],
      earliestFeasible: { serveAt: "2026-07-18T18:21:00.000Z" },
    });
    if (result.feasible || !result.earliestFeasible) return;
    const terminal = result.earliestFeasible.tasks.find((entry) => entry.taskId === "serve")!;
    expect(terminal.plannedEnd).toBe(result.earliestFeasible.serveAt);
  });

  it("distinguishes a fully occupied resource window from missing time capacity", () => {
    const result = scheduleDinner(request([
      task("a", { mode: "active", durationMinutes: 10 }),
      task("b", { mode: "active", durationMinutes: 10 }),
    ], { serveAt: "2026-07-18T18:10:00Z" }));

    expect(result).toMatchObject({
      feasible: false,
      issues: [
        { code: "RESOURCE_CONFLICT", taskIds: ["b"] },
        { code: "WINDOW_INFEASIBLE", taskIds: ["b"] },
      ],
      earliestFeasible: { serveAt: "2026-07-18T18:20:00.000Z" },
    });
  });

  it.each([
    ["invalid ISO", { availableFrom: "invalid" }, "INVALID_TIME"],
    ["reversed window", { availableFrom: "2026-07-18T19:05:00Z" }, "WINDOW_INFEASIBLE"],
  ])("returns a structured issue for %s", (_label, overrides, code) => {
    const action = () => scheduleDinner(request([task("meal")], overrides));
    expect(action).not.toThrow();
    expect(action()).toMatchObject({ feasible: false, issues: [{ code }] });
  });

  it("keeps earliestFeasible null when the graph itself is invalid", () => {
    const result = scheduleDinner(request([task("cycle", { dependsOn: ["cycle"] })]));
    expect(result).toMatchObject({ feasible: false, earliestFeasible: null });
  });

  it("canonicalizes equivalent offsets across midnight", () => {
    const tasks = [task("meal", { durationMinutes: 5 })];
    const offset = request(tasks, {
      availableFrom: "2026-07-18T23:45:00+09:00",
      serveAt: "2026-07-19T00:03:00+09:00",
    });
    const utc = request(tasks, {
      availableFrom: "2026-07-18T14:45:00Z",
      serveAt: "2026-07-18T15:03:00Z",
    });
    expect(scheduleDinner(offset)).toEqual(scheduleDinner(utc));
  });
});
