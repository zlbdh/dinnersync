import { fromEpochMs, parseIsoInstant, toEpochMs } from "@/shared";
import type { ResourceId } from "@/shared";

import { canReserve, reserve } from "./intervals";
import type { ResourceReservation } from "./intervals";
import type {
  ScheduleIssue,
  ScheduleRequest,
  ScheduleResult,
  ScheduledTask,
  ScheduleTask,
} from "./types";
import {
  resolveTaskResourceIds,
  topologicallySortTasks,
  validateTaskGraph,
} from "./validate";

const MINUTE_MS = 60_000;

type TimedTask = {
  task: ScheduleTask;
  startMs: number;
  endMs: number;
  resourceIds: ResourceId[];
};

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function issue(code: ScheduleIssue["code"], taskIds: string[]): ScheduleIssue {
  return { code, taskIds: [...taskIds].sort(compareText) };
}

function invalidResult(issues: ScheduleIssue[]): ScheduleResult {
  return { feasible: false, issues, earliestFeasible: null };
}

function parseRequestTimes(request: ScheduleRequest) {
  const fields = ["availableFrom", "serveAt"] as const;
  const issues: ScheduleIssue[] = [];
  const values = new Map<(typeof fields)[number], number>();
  for (const field of fields) {
    const parsed = parseIsoInstant(request[field]);
    if (!parsed.ok) issues.push(issue("INVALID_TIME", [field]));
    else values.set(field, toEpochMs(parsed.value));
  }
  return { issues, availableMs: values.get("availableFrom") };
}

function downstreamScores(tasks: readonly ScheduleTask[]) {
  const ordered = topologicallySortTasks(tasks);
  const children = new Map<string, ScheduleTask[]>();
  for (const task of ordered) {
    for (const dependency of task.dependsOn) {
      children.set(dependency, [...(children.get(dependency) ?? []), task]);
    }
  }
  const scores = new Map<string, number>();
  for (const task of [...ordered].reverse()) {
    const childScore = Math.max(
      0,
      ...(children.get(task.id) ?? []).map((child) => scores.get(child.id) ?? 0),
    );
    scores.set(task.id, task.durationMinutes + childScore);
  }
  return scores;
}

function earliestStart(
  task: ScheduleTask,
  scheduled: ReadonlyMap<string, TimedTask>,
  availableMs: number,
) {
  return Math.max(
    availableMs,
    ...task.dependsOn.map((dependency) => scheduled.get(dependency)!.endMs),
  );
}

function findAvailableStart(
  task: ScheduleTask,
  notBeforeMs: number,
  horizonMs: number,
  reservations: readonly ResourceReservation[],
  resourceIds: ResourceId[],
) {
  const durationMs = task.durationMinutes * MINUTE_MS;
  if (resourceIds.length === 0) return notBeforeMs;
  for (let startMs = notBeforeMs; startMs + durationMs <= horizonMs; startMs += MINUTE_MS) {
    if (canReserve(reservations, {
      taskId: task.id,
      startMs,
      endMs: startMs + durationMs,
      resourceIds,
    })) return startMs;
  }
  return null;
}

function stableTimeline(entries: readonly TimedTask[]): TimedTask[] {
  return [...entries].sort((left, right) =>
    left.startMs - right.startMs
    || left.endMs - right.endMs
    || compareText(left.task.id, right.task.id));
}

export function ovenTransitionIssueIds(
  entries: readonly Pick<TimedTask, "task" | "startMs" | "endMs">[],
) {
  const oven = entries
    .filter((entry) => resolveTaskResourceIds(entry.task).includes("oven:1"))
    .toSorted((left, right) => left.startMs - right.startMs
      || left.endMs - right.endMs
      || compareText(left.task.id, right.task.id));
  let currentTemperature: number | null = null;
  let lastCookTemperature: number | null = null;
  let changedSinceCook = false;
  const invalid: string[] = [];
  for (const entry of oven) {
    const { ovenOperation, ovenTemperatureC } = entry.task;
    if (ovenOperation === "temperature-change") {
      currentTemperature = ovenTemperatureC;
      changedSinceCook = true;
      continue;
    }
    if (ovenOperation === "preheat") {
      currentTemperature = ovenTemperatureC;
      continue;
    }
    if (ovenOperation !== "cook") continue;
    if (currentTemperature !== ovenTemperatureC
      || (lastCookTemperature !== null
        && lastCookTemperature !== ovenTemperatureC
        && !changedSinceCook)) invalid.push(entry.task.id);
    currentTemperature = ovenTemperatureC;
    lastCookTemperature = ovenTemperatureC;
    changedSinceCook = false;
  }
  return invalid.sort(compareText);
}

function toScheduledTask(entry: TimedTask): ScheduledTask | null {
  try {
    return {
      taskId: entry.task.id,
      plannedStart: fromEpochMs(entry.startMs),
      plannedEnd: fromEpochMs(entry.endMs),
      effectiveResources: [...entry.resourceIds],
    };
  } catch {
    return null;
  }
}

export function scheduleForwardEarliest(
  request: ScheduleRequest,
): ScheduleResult {
  const graphIssues = validateTaskGraph(request.tasks, request.kitchen);
  const times = parseRequestTimes(request);
  const issues = [...times.issues, ...graphIssues];
  if (issues.length > 0 || times.availableMs === undefined) return invalidResult(issues);

  const durationMinutes = request.tasks.reduce(
    (sum, task) => sum + task.durationMinutes,
    0,
  );
  const horizonMs = times.availableMs + durationMinutes * MINUTE_MS;
  if (!Number.isSafeInteger(horizonMs)) {
    return invalidResult([issue("WINDOW_INFEASIBLE", request.tasks.map((task) => task.id))]);
  }

  const scores = downstreamScores(request.tasks);
  const remaining = new Map(request.tasks.map((task) => [task.id, task]));
  const scheduled = new Map<string, TimedTask>();
  let reservations: ResourceReservation[] = [];

  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter((task) => task.dependsOn.every((id) => scheduled.has(id)))
      .sort((left, right) => {
        const leftStart = earliestStart(left, scheduled, times.availableMs!);
        const rightStart = earliestStart(right, scheduled, times.availableMs!);
        return leftStart - rightStart
          || (scores.get(right.id) ?? 0) - (scores.get(left.id) ?? 0)
          || compareText(left.recipeId, right.recipeId)
          || compareText(left.id, right.id);
      });
    const task = ready[0];
    if (!task) return invalidResult([issue("DEPENDENCY_CYCLE", [...remaining.keys()])]);
    const resourceIds = resolveTaskResourceIds(task);
    const startMs = findAvailableStart(
      task,
      earliestStart(task, scheduled, times.availableMs),
      horizonMs,
      reservations,
      resourceIds,
    );
    if (startMs === null) {
      return invalidResult([issue("RESOURCE_CONFLICT", [task.id])]);
    }
    const entry = {
      task,
      startMs,
      endMs: startMs + task.durationMinutes * MINUTE_MS,
      resourceIds,
    };
    if (resourceIds.length > 0) {
      reservations = reserve(reservations, {
        taskId: task.id,
        startMs: entry.startMs,
        endMs: entry.endMs,
        resourceIds,
      })!;
    }
    scheduled.set(task.id, entry);
    remaining.delete(task.id);
  }

  const timeline = stableTimeline([...scheduled.values()]);
  const ovenIssues = ovenTransitionIssueIds(timeline);
  if (ovenIssues.length > 0) {
    return invalidResult([issue("OVEN_TRANSITION_REQUIRED", ovenIssues)]);
  }
  const tasks = timeline.map(toScheduledTask);
  const terminalEnds = timeline
    .filter((entry) => entry.task.isTerminal)
    .map((entry) => entry.endMs);
  const serveMs = Math.max(...terminalEnds);
  let serveAt: string;
  try {
    serveAt = fromEpochMs(serveMs);
  } catch {
    return invalidResult([issue("WINDOW_INFEASIBLE", request.tasks.map((task) => task.id))]);
  }
  if (tasks.some((task) => task === null)) {
    return invalidResult([issue("WINDOW_INFEASIBLE", request.tasks.map((task) => task.id))]);
  }
  return { feasible: true, tasks: tasks as ScheduledTask[], serveAt };
}
