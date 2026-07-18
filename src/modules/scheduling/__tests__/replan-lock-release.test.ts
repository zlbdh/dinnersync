import { describe, expect, it } from "vitest";

import { replanRemainingTasks } from "../index";
import type { Schedule, ScheduleRequest, ScheduleTask } from "../types";

const AT = (minute: number) => `2026-07-18T18:${String(minute).padStart(2, "0")}:00Z`;

function task(id: string, overrides: Partial<ScheduleTask>): ScheduleTask {
  return {
    id,
    recipeId: id[0],
    sourceText: id,
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

function entry(
  taskId: string,
  start: number,
  end: number,
  cook = false,
) {
  return {
    taskId,
    plannedStart: AT(start),
    plannedEnd: AT(end),
    effectiveResources: cook ? ["cook:1" as const] : [],
  };
}

describe("replan released resources", () => {
  it("does not keep a completed task as a ghost reservation during alignment", () => {
    const tasks = [
      task("a-work", {
        recipeId: "a", durationMinutes: 10, mode: "active", isTerminal: false,
      }),
      task("a-serve", { recipeId: "a", dependsOn: ["a-work"] }),
      task("b-work", {
        recipeId: "b", durationMinutes: 5, mode: "active", isTerminal: false,
      }),
      task("b-serve", { recipeId: "b", dependsOn: ["b-work"] }),
      task("c-work", {
        recipeId: "c", durationMinutes: 15, isTerminal: false,
      }),
      task("c-serve", { recipeId: "c", dependsOn: ["c-work"] }),
    ];
    const request: ScheduleRequest = {
      tasks,
      kitchen: { cooks: 1, ovens: 1, burners: 2 },
      availableFrom: AT(0),
      serveAt: AT(16),
      serveToleranceMinutes: 5,
    };
    const previous: Schedule = {
      feasible: true,
      serveAt: AT(16),
      tasks: [
        entry("b-work", 0, 5, true),
        entry("a-work", 5, 15, true),
        entry("c-work", 0, 15),
        entry("a-serve", 15, 16),
        entry("b-serve", 15, 16),
        entry("c-serve", 15, 16),
      ],
    };

    const result = replanRemainingTasks({
      request,
      previous,
      now: AT(1),
      completedTaskIds: ["b-work"],
      activeTasks: [{
        taskId: "c-work",
        status: "running",
        actualStart: AT(0),
        expectedEnd: AT(20),
        lockUntil: AT(20),
        effectiveResources: [],
      }],
    });

    expect(result.feasible).toBe(false);
    if (result.feasible) return;
    expect(result.earliestFeasible).not.toBeNull();
    expect(result.earliestFeasible?.serveAt).toBe("2026-07-18T18:21:00.000Z");
    expect(result.earliestFeasible?.tasks.find((item) => item.taskId === "a-work"))
      .toMatchObject({
        plannedStart: "2026-07-18T18:01:00.000Z",
        plannedEnd: "2026-07-18T18:11:00.000Z",
      });
  });
});
