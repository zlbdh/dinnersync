import type { KitchenResources } from "@/shared";
import { describe, expect, it } from "vitest";

import { scheduleForwardEarliest } from "../forward-schedule";
import { scheduleDinner } from "../schedule";
import type { ScheduleRequest, ScheduleTask } from "../types";

const KITCHEN: KitchenResources = { cooks: 1, ovens: 1, burners: 2 };

function task(id: string, overrides: Partial<ScheduleTask> = {}): ScheduleTask {
  return {
    id,
    recipeId: "recipe-1",
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

function request(tasks: ScheduleTask[]): ScheduleRequest {
  return {
    tasks,
    kitchen: KITCHEN,
    availableFrom: "2026-07-18T18:00:00Z",
    serveAt: "2026-07-18T19:00:00Z",
    serveToleranceMinutes: 5,
  };
}

function expectIssue(result: ReturnType<typeof scheduleDinner>, code: string) {
  expect(result.feasible).toBe(false);
  if (!result.feasible) expect(result.issues.map((entry) => entry.code)).toContain(code);
}

describe("scheduling safety regressions", () => {
  it.each([
    ["reverse", scheduleDinner],
    ["forward", scheduleForwardEarliest],
  ])("fails closed for a null %s request", (_name, schedule) => {
    expect(() => schedule(null as never)).not.toThrow();
    expectIssue(schedule(null as never), "INVALID_TASK");
  });

  it.each([
    ["reverse", scheduleDinner],
    ["forward", scheduleForwardEarliest],
  ])("rejects an empty %s task set", (_name, schedule) => {
    expectIssue(schedule(request([])), "INVALID_TASK");
  });

  it.each([
    ["reverse", scheduleDinner],
    ["forward", scheduleForwardEarliest],
  ])("requires the recipe terminal to be its final reachable sink in %s", (_name, schedule) => {
    const serve = task("serve", { isTerminal: true });
    const after = task("after-serve", { dependsOn: ["serve"], isTerminal: false });
    expectIssue(schedule(request([serve, after])), "INVALID_TERMINAL");
  });

  it.each([
    ["reverse", scheduleDinner],
    ["forward", scheduleForwardEarliest],
  ])("rejects a cross-recipe child after the %s terminal", (_name, schedule) => {
    const firstServe = task("first-serve", { recipeId: "first" });
    const secondWork = task("second-work", {
      recipeId: "second",
      dependsOn: ["first-serve"],
      isTerminal: false,
    });
    const secondServe = task("second-serve", {
      recipeId: "second",
      dependsOn: ["second-work"],
    });
    expectIssue(
      schedule(request([firstServe, secondWork, secondServe])),
      "INVALID_TERMINAL",
    );
  });

  it("finds the legal oven order when the default reverse tie-break would not", () => {
    const tasks = [
      task("a-preheat-180", {
        recipeId: "a",
        resources: [{ resourceId: "oven:1" }],
        ovenOperation: "preheat",
        ovenTemperatureC: 180,
        isTerminal: false,
      }),
      task("b-cook-180", {
        recipeId: "a",
        dependsOn: ["a-preheat-180"],
        resources: [{ resourceId: "oven:1" }],
        ovenOperation: "cook",
        ovenTemperatureC: 180,
      }),
      task("c-change-200", {
        recipeId: "b",
        resources: [{ resourceId: "oven:1" }],
        ovenOperation: "temperature-change",
        ovenTemperatureC: 200,
        isTerminal: false,
      }),
      task("d-cook-200", {
        recipeId: "b",
        dependsOn: ["c-change-200"],
        resources: [{ resourceId: "oven:1" }],
        ovenOperation: "cook",
        ovenTemperatureC: 200,
      }),
    ];
    const result = scheduleDinner(request(tasks));
    expect(result.feasible).toBe(true);
    if (result.feasible) {
      expect(result.tasks.map((entry) => entry.taskId)).toEqual([
        "a-preheat-180",
        "b-cook-180",
        "c-change-200",
        "d-cook-200",
      ]);
    }
  });

  it("places the short shared-cook terminal last when that makes the window feasible", () => {
    const result = scheduleDinner(request([
      task("long-terminal", { recipeId: "long", durationMinutes: 10, mode: "active" }),
      task("short-terminal", { recipeId: "short", durationMinutes: 1, mode: "active" }),
    ]));
    expect(result.feasible).toBe(true);
    if (result.feasible) {
      expect(result.tasks.map((entry) => entry.taskId)).toEqual([
        "long-terminal",
        "short-terminal",
      ]);
      const terminalEnds = result.tasks.map((entry) => Date.parse(entry.plannedEnd));
      expect(Math.max(...terminalEnds) - Math.min(...terminalEnds)).toBeLessThanOrEqual(300_000);
    }
  });

  it("does not fabricate an earliest synchronized serve time", () => {
    const input = request([
      task("terminal-a", { recipeId: "a", durationMinutes: 10, mode: "active" }),
      task("terminal-b", { recipeId: "b", durationMinutes: 10, mode: "active" }),
    ]);
    const reverse = scheduleDinner(input);
    expect(reverse).toMatchObject({ feasible: false, earliestFeasible: null });
    expectIssue(reverse, "WINDOW_INFEASIBLE");
    expectIssue(scheduleForwardEarliest(input), "WINDOW_INFEASIBLE");
  });

  it("delays independent terminals to the earliest synchronized serve time", () => {
    const tasks = [
      task("long-terminal", { recipeId: "long", durationMinutes: 10 }),
      task("short-terminal", { recipeId: "short", durationMinutes: 1 }),
    ];
    const input = {
      ...request(tasks),
      serveAt: "2026-07-18T18:05:00Z" as const,
    };
    const forward = scheduleForwardEarliest(input);
    expect(forward).toMatchObject({
      feasible: true,
      serveAt: "2026-07-18T18:10:00.000Z",
    });
    if (forward.feasible) {
      expect(new Set(forward.tasks.map((entry) => entry.plannedEnd))).toEqual(
        new Set(["2026-07-18T18:10:00.000Z"]),
      );
    }
    expect(scheduleDinner(input)).toMatchObject({
      feasible: false,
      earliestFeasible: { serveAt: "2026-07-18T18:10:00.000Z" },
    });
  });

  it("advances to the next resource boundary when terminal alignment needs it", () => {
    const tasks = [
      task("long-prep", {
        recipeId: "long",
        durationMinutes: 10,
        isTerminal: false,
      }),
      task("long-terminal", {
        recipeId: "long",
        durationMinutes: 10,
        mode: "active",
        dependsOn: ["long-prep"],
      }),
      task("short-terminal", {
        recipeId: "short",
        durationMinutes: 1,
        mode: "active",
      }),
    ];
    const input = {
      ...request(tasks),
      serveAt: "2026-07-18T18:20:00Z" as const,
    };
    expect(scheduleForwardEarliest(input)).toMatchObject({
      feasible: true,
      serveAt: "2026-07-18T18:21:00.000Z",
    });
    expect(scheduleDinner(input)).toMatchObject({
      feasible: false,
      earliestFeasible: { serveAt: "2026-07-18T18:21:00.000Z" },
    });
  });

  it("keeps independent resource tails parallel when advancing the boundary", () => {
    const tasks = [
      task("combo-prep", {
        recipeId: "combo",
        durationMinutes: 10,
        isTerminal: false,
      }),
      task("combo-terminal", {
        recipeId: "combo",
        durationMinutes: 10,
        mode: "active",
        resources: [{ resourceId: "burner:1" }],
        dependsOn: ["combo-prep"],
      }),
      task("cook-terminal", {
        recipeId: "cook",
        mode: "active",
      }),
      task("burner-terminal", {
        recipeId: "burner",
        resources: [{ resourceId: "burner:1" }],
      }),
    ];
    const input = {
      ...request(tasks),
      serveAt: "2026-07-18T18:20:00Z" as const,
    };
    expect(scheduleForwardEarliest(input)).toMatchObject({
      feasible: true,
      serveAt: "2026-07-18T18:21:00.000Z",
    });
    expect(scheduleDinner(input)).toMatchObject({
      feasible: false,
      earliestFeasible: { serveAt: "2026-07-18T18:21:00.000Z" },
    });
  });
});
