import type { KitchenResources } from "@/shared";
import { describe, expect, it } from "vitest";

import {
  resolveTaskResourceIds,
  topologicallySortTasks,
  validateTaskGraph,
} from "../index";
import type { ScheduleIssueCode, ScheduleTask } from "../types";

const KITCHEN: KitchenResources = { cooks: 1, ovens: 1, burners: 2 };

function task(id: string, overrides: Partial<ScheduleTask> = {}): ScheduleTask {
  return {
    id,
    recipeId: "recipe-1",
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

function codes(tasks: ScheduleTask[], kitchen = KITCHEN) {
  return validateTaskGraph(tasks, kitchen).map((issue) => issue.code);
}

function expectCode(tasks: ScheduleTask[], code: ScheduleIssueCode, kitchen = KITCHEN) {
  expect(codes(tasks, kitchen)).toContain(code);
}

describe("validateTaskGraph", () => {
  it("accepts a valid graph and resolves active cook locks deterministically", () => {
    const tasks = [
      task("finish", { dependsOn: ["prep"] }),
      task("prep", {
        mode: "active",
        resources: [{ resourceId: "burner:1" }],
        isTerminal: false,
      }),
    ];
    expect(validateTaskGraph(tasks, KITCHEN)).toEqual([]);
    expect(topologicallySortTasks(tasks).map((entry) => entry.id)).toEqual(["prep", "finish"]);
    expect(resolveTaskResourceIds(tasks[1])).toEqual(["cook:1", "burner:1"]);
  });

  it("reports missing and self dependencies without throwing", () => {
    const missing = task("missing-owner", { dependsOn: ["absent"] });
    expect(validateTaskGraph([missing], KITCHEN)).toContainEqual({
      code: "MISSING_DEPENDENCY",
      taskIds: ["absent", "missing-owner"],
    });
    expectCode([task("self", { dependsOn: ["self"] })], "DEPENDENCY_CYCLE");
  });

  it("fails closed when runtime dependencies are not an array", () => {
    const forged = task("forged-dependencies", { dependsOn: "prep" as never });
    expect(() => validateTaskGraph([forged], KITCHEN)).not.toThrow();
    expectCode([forged], "MISSING_DEPENDENCY");
    expect(topologicallySortTasks([forged])).toEqual([]);
  });

  it.each([
    ["null task", null],
    ["numeric id", task("valid", { id: 42 as never })],
    ["blank recipe id", task("blank-recipe", { recipeId: " " })],
    ["non-string dependency", task("bad-dependency", { dependsOn: [42 as never] })],
    ["non-boolean terminal", task("bad-terminal", { isTerminal: "yes" as never })],
  ])("rejects malformed runtime shape: %s", (_name, forged) => {
    const tasks = [forged] as ScheduleTask[];
    expect(() => validateTaskGraph(tasks, KITCHEN)).not.toThrow();
    expectCode(tasks, "INVALID_TASK");
    expect(topologicallySortTasks(tasks)).toEqual([]);
  });

  it("detects a multi-node cycle and returns no topological order", () => {
    const tasks = [
      task("b", { dependsOn: ["a"], isTerminal: true }),
      task("a", { dependsOn: ["b"], isTerminal: false }),
    ];
    expect(validateTaskGraph(tasks, KITCHEN)).toContainEqual({
      code: "DEPENDENCY_CYCLE",
      taskIds: ["a", "b"],
    });
    expect(topologicallySortTasks(tasks)).toEqual([]);
  });

  it.each([
    ["zero", [task("a", { isTerminal: false })]],
    ["multiple", [task("a"), task("b")]],
  ])("requires exactly one terminal per recipe: %s", (_name, tasks) => {
    expectCode(tasks, "INVALID_TERMINAL");
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects non-positive, non-finite, fractional, or unsafe duration %s",
    (durationMinutes) => {
      expectCode([task("duration", { durationMinutes })], "INVALID_DURATION");
    },
  );

  it("rejects duplicate task IDs and duplicate dependency entries", () => {
    expectCode([task("same"), task("same")], "DUPLICATE_TASK_ID");
    expectCode([
      task("prep", { isTerminal: false }),
      task("finish", { dependsOn: ["prep", "prep"] }),
    ], "DUPLICATE_DEPENDENCY");
  });

  it("rejects unknown resources and unavailable second burners at runtime", () => {
    const forged = task("forged", {
      resources: [{ resourceId: "grill:1" } as never],
    });
    expectCode([forged], "INVALID_RESOURCE");

    const secondBurner = task("burner", { resources: [{ resourceId: "burner:2" }] });
    expectCode(
      [secondBurner],
      "INVALID_RESOURCE",
      { cooks: 1, ovens: 1, burners: 1 },
    );
  });

  it.each([
    ["missing operation", { resources: [{ resourceId: "oven:1" }], ovenTemperatureC: 180 }],
    ["missing temperature", { resources: [{ resourceId: "oven:1" }], ovenOperation: "preheat" }],
    ["operation without oven", { ovenOperation: "preheat", ovenTemperatureC: 180 }],
    ["temperature without oven", { ovenTemperatureC: 180 }],
  ] as const)("requires bidirectionally consistent oven fields: %s", (_name, overrides) => {
    expectCode([task("oven", overrides as Partial<ScheduleTask>)], "OVEN_TRANSITION_REQUIRED");
  });

  it("requires each oven cook to transitively depend on the same temperature", () => {
    const preheat = task("preheat", {
      resources: [{ resourceId: "oven:1" }],
      ovenOperation: "preheat",
      ovenTemperatureC: 180,
      isTerminal: false,
    });
    const bridge = task("bridge", { dependsOn: ["preheat"], isTerminal: false });
    const cook = task("cook", {
      dependsOn: ["bridge"],
      resources: [{ resourceId: "oven:1" }],
      ovenOperation: "cook",
      ovenTemperatureC: 180,
    });
    expect(validateTaskGraph([cook, bridge, preheat], KITCHEN)).toEqual([]);

    const mismatch = structuredClone(preheat);
    mismatch.ovenTemperatureC = 200;
    expectCode([cook, bridge, mismatch], "OVEN_TRANSITION_REQUIRED");
  });

  it("does not see through a later transition to an older matching temperature", () => {
    const preheat = task("preheat-180", {
      resources: [{ resourceId: "oven:1" }],
      ovenOperation: "preheat",
      ovenTemperatureC: 180,
      isTerminal: false,
    });
    const change = task("change-200", {
      dependsOn: ["preheat-180"],
      resources: [{ resourceId: "oven:1" }],
      ovenOperation: "temperature-change",
      ovenTemperatureC: 200,
      isTerminal: false,
    });
    const cook = task("cook-180", {
      dependsOn: ["change-200"],
      resources: [{ resourceId: "oven:1" }],
      ovenOperation: "cook",
      ovenTemperatureC: 180,
    });
    expectCode([preheat, change, cook], "OVEN_TRANSITION_REQUIRED");
  });

  it("sorts issues and task IDs identically for permuted input", () => {
    const tasks = [
      task("z", { durationMinutes: 0 }),
      task("a", { dependsOn: ["missing"], isTerminal: false }),
    ];
    expect(validateTaskGraph(tasks, KITCHEN)).toEqual(
      validateTaskGraph([...tasks].reverse(), KITCHEN),
    );
  });
});
