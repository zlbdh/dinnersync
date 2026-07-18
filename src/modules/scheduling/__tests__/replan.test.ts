import { toEpochMs } from "@/shared";
import { describe, expect, it } from "vitest";

import { replanRemainingTasks, scheduleDinner } from "../index";
import type { ReplanRequest, Schedule, ScheduleRequest, ScheduleTask } from "../types";

const START = "2026-07-18T18:00:00Z";
const DUE = "2026-07-18T18:05:00Z";
const SERVE = "2026-07-18T18:11:00Z";

function task(id: string, overrides: Partial<ScheduleTask>): ScheduleTask {
  return {
    id,
    recipeId: id.split("-")[0],
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

function base(): { request: ScheduleRequest; previous: Schedule } {
  const request: ScheduleRequest = {
    tasks: [
      task("a-work", { durationMinutes: 5, mode: "active", isTerminal: false }),
      task("a-serve", { dependsOn: ["a-work"] }),
      task("b-work", { durationMinutes: 5, mode: "active", isTerminal: false }),
      task("b-serve", { dependsOn: ["b-work"] }),
    ],
    kitchen: { cooks: 1, ovens: 1, burners: 2 },
    availableFrom: START,
    serveAt: SERVE,
    serveToleranceMinutes: 5,
  };
  return {
    request,
    previous: {
      feasible: true,
      serveAt: SERVE,
      tasks: [
        {
          taskId: "a-work",
          plannedStart: START,
          plannedEnd: DUE,
          effectiveResources: ["cook:1"],
        },
        {
          taskId: "b-work",
          plannedStart: DUE,
          plannedEnd: "2026-07-18T18:10:00Z",
          effectiveResources: ["cook:1"],
        },
        {
          taskId: "a-serve",
          plannedStart: "2026-07-18T18:10:00Z",
          plannedEnd: SERVE,
          effectiveResources: [],
        },
        {
          taskId: "b-serve",
          plannedStart: "2026-07-18T18:10:00Z",
          plannedEnd: SERVE,
          effectiveResources: [],
        },
      ],
    },
  };
}

function ovenRequest(): ScheduleRequest {
  return {
    ...base().request,
    tasks: [
      task("a-preheat-180", {
        recipeId: "a", resources: [{ resourceId: "oven:1" }],
        ovenOperation: "preheat", ovenTemperatureC: 180, isTerminal: false,
      }),
      task("b-cook-180", {
        recipeId: "a", dependsOn: ["a-preheat-180"],
        resources: [{ resourceId: "oven:1" }],
        ovenOperation: "cook", ovenTemperatureC: 180,
      }),
      task("c-change-200", {
        recipeId: "b", resources: [{ resourceId: "oven:1" }],
        ovenOperation: "temperature-change", ovenTemperatureC: 200, isTerminal: false,
      }),
      task("d-cook-200", {
        recipeId: "b", dependsOn: ["c-change-200"],
        resources: [{ resourceId: "oven:1" }],
        ovenOperation: "cook", ovenTemperatureC: 200,
      }),
    ],
    serveAt: "2026-07-18T19:00:00Z",
  };
}

function replan(overrides: Partial<ReplanRequest> = {}) {
  const source = base();
  return replanRemainingTasks({
    ...source,
    now: DUE,
    completedTaskIds: ["a-work"],
    activeTasks: [],
    ...overrides,
  });
}

describe("replanRemainingTasks", () => {
  it("treats completed dependencies as satisfied and never moves completed tasks", () => {
    const result = replan();

    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    expect(result.tasks.find((entry) => entry.taskId === "a-work"))
      .toEqual(base().previous.tasks[0]);
    expect(result.tasks).toHaveLength(4);
  });

  it("reserves a running task until expectedEnd and exposes a safe earliest timeline", () => {
    const { request, previous } = base();
    const result = replan({
      request,
      previous,
      now: DUE,
      completedTaskIds: [],
      activeTasks: [{
        taskId: "a-work",
        status: "running",
        actualStart: START,
        expectedEnd: "2026-07-18T18:08:00Z",
        lockUntil: "2026-07-18T18:08:00Z",
        effectiveResources: ["cook:1"],
      }],
    });

    expect(result.feasible).toBe(false);
    if (result.feasible) return;
    expect(result.issues.map((entry) => entry.code)).toContain("WINDOW_INFEASIBLE");
    expect(result.earliestFeasible).not.toBeNull();
    const earliest = result.earliestFeasible!;
    const running = earliest.tasks.find((entry) => entry.taskId === "a-work")!;
    const next = earliest.tasks.find((entry) => entry.taskId === "b-work")!;
    expect(running).toEqual(previous.tasks[0]);
    expect(toEpochMs(next.plannedStart))
      .toBeGreaterThanOrEqual(toEpochMs("2026-07-18T18:08:00Z"));
  });

  it("fails closed for a due infinite lock without placing Infinity in a timeline", () => {
    const { request, previous } = base();
    const result = replan({
      request,
      previous,
      completedTaskIds: [],
      activeTasks: [{
        taskId: "a-work",
        status: "due",
        actualStart: START,
        expectedEnd: DUE,
        lockUntil: null,
        effectiveResources: ["cook:1"],
      }],
    });

    expect(result).toEqual({
      feasible: false,
      issues: [
        { code: "RESOURCE_UNAVAILABLE", taskIds: ["a-work"] },
        { code: "WINDOW_INFEASIBLE", taskIds: ["a-work"] },
      ],
      earliestFeasible: null,
    });
  });

  it("returns the same result for identical input", () => {
    const { request, previous } = base();
    const input: ReplanRequest = {
      request,
      previous,
      now: DUE,
      completedTaskIds: ["a-work"],
      activeTasks: [],
    };

    expect(replanRemainingTasks(input)).toEqual(replanRemainingTasks(input));
  });

  it.each([
    ["null request", null],
    ["missing state arrays", { request: base().request, previous: base().previous }],
    ["malformed previous entry", {
      ...base(), now: DUE, completedTaskIds: [], activeTasks: [],
      previous: { feasible: true, serveAt: SERVE, tasks: [null] },
    }],
    ["unknown active status", {
      ...base(), now: DUE, completedTaskIds: [],
      activeTasks: [{
        taskId: "a-work",
        status: "paused",
        actualStart: START,
        expectedEnd: "2026-07-18T18:08:00Z",
        lockUntil: null,
        effectiveResources: ["cook:1"],
      }],
    }],
  ])("fails closed instead of throwing for %s", (_label, malformed) => {
    expect(() => replanRemainingTasks(malformed as ReplanRequest)).not.toThrow();
    expect(replanRemainingTasks(malformed as ReplanRequest)).toMatchObject({
      feasible: false,
      earliestFeasible: null,
    });
  });

  it("rejects a running lock whose actual interval is inconsistent with now", () => {
    const { request, previous } = base();
    const result = replanRemainingTasks({
      request,
      previous,
      now: "2026-07-18T18:09:00Z",
      completedTaskIds: [],
      activeTasks: [{
        taskId: "a-work",
        status: "running",
        actualStart: START,
        expectedEnd: "2026-07-18T18:08:00Z",
        lockUntil: "2026-07-18T18:08:00Z",
        effectiveResources: ["cook:1"],
      }],
    });

    expect(result).toMatchObject({
      feasible: false,
      issues: [{ code: "INVALID_TASK", taskIds: ["a-work"] }],
    });
  });

  it("rejects invalid availableFrom on a constrained replan", () => {
    const source = base();
    const result = replanRemainingTasks({
      ...source, now: DUE, completedTaskIds: ["a-work"], activeTasks: [],
      request: { ...source.request, availableFrom: "not-an-instant" },
    });
    expect(result).toMatchObject({
      feasible: false, issues: [{ code: "INVALID_TIME", taskIds: ["availableFrom"] }],
    });
  });

  it("reuses the legal base order when an unchanged oven plan is replanned", () => {
    const request = ovenRequest();
    const previous = scheduleDinner(request);
    expect(previous.feasible).toBe(true);
    if (!previous.feasible) return;

    expect(replanRemainingTasks({
      request,
      previous,
      now: request.availableFrom,
      completedTaskIds: [],
      activeTasks: [],
    })).toEqual(previous);
  });

  it("keeps a feasible oven timeline after its preheat is completed", () => {
    const request = ovenRequest();
    const previous = scheduleDinner(request);
    expect(previous.feasible).toBe(true);
    if (!previous.feasible) return;
    const preheat = previous.tasks.find((entry) => entry.taskId === "a-preheat-180")!;
    const result = replanRemainingTasks({
      request,
      previous,
      now: preheat.plannedEnd,
      completedTaskIds: [preheat.taskId],
      activeTasks: [],
    });

    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    const oven = result.tasks.filter((entry) => entry.effectiveResources.includes("oven:1"));
    const ovenOrder = oven.map((entry) => entry.taskId);
    expect(ovenOrder).toEqual([
      "a-preheat-180", "b-cook-180", "c-change-200", "d-cook-200",
    ]);
    expect(oven.slice(1).every((entry, i) =>
      toEpochMs(oven[i].plannedEnd) <= toEpochMs(entry.plannedStart))).toBe(true);
    const byId = new Map(result.tasks.map((entry) => [entry.taskId, entry]));
    expect(toEpochMs(byId.get("b-cook-180")!.plannedStart))
      .toBeGreaterThanOrEqual(toEpochMs(preheat.plannedEnd));
    expect(toEpochMs(byId.get("c-change-200")!.plannedEnd))
      .toBeLessThanOrEqual(toEpochMs(byId.get("d-cook-200")!.plannedStart));
    expect(toEpochMs(result.serveAt)).toBe(toEpochMs(request.serveAt));
  });
});
