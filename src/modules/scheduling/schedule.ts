import { fromEpochMs, parseIsoInstant, toEpochMs } from "@/shared";
import type { ResourceId } from "@/shared";

import {
  ovenTransitionIssueIds,
  scheduleForwardEarliest,
} from "./forward-schedule";
import { canReserve, reserve } from "./intervals";
import type { ResourceReservation } from "./intervals";
import type {
  InfeasibleSchedule,
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
  return { code, taskIds: [...new Set(taskIds)].sort(compareText) };
}

function parseTimes(request: ScheduleRequest) {
  const values = new Map<string, number>();
  const issues: ScheduleIssue[] = [];
  for (const field of ["availableFrom", "serveAt"] as const) {
    const parsed = parseIsoInstant(request[field]);
    if (!parsed.ok) issues.push(issue("INVALID_TIME", [field]));
    else values.set(field, toEpochMs(parsed.value));
  }
  return {
    issues,
    availableMs: values.get("availableFrom"),
    serveMs: values.get("serveAt"),
  };
}

function infeasible(
  request: ScheduleRequest,
  issues: ScheduleIssue[],
  includeForward: boolean,
): InfeasibleSchedule {
  const forward = includeForward ? scheduleForwardEarliest(request) : null;
  return {
    feasible: false,
    issues,
    earliestFeasible: forward?.feasible
      ? { tasks: forward.tasks, serveAt: forward.serveAt }
      : null,
  };
}

function upstreamScores(tasks: readonly ScheduleTask[]) {
  const scores = new Map<string, number>();
  for (const task of topologicallySortTasks(tasks)) {
    const dependencyScore = Math.max(
      0,
      ...task.dependsOn.map((id) => scores.get(id) ?? 0),
    );
    scores.set(task.id, task.durationMinutes + dependencyScore);
  }
  return scores;
}

function childMap(tasks: readonly ScheduleTask[]) {
  const children = new Map<string, ScheduleTask[]>();
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      children.set(dependency, [...(children.get(dependency) ?? []), task]);
    }
  }
  return children;
}

function latestEnd(
  task: ScheduleTask,
  children: ReadonlyMap<string, ScheduleTask[]>,
  scheduled: ReadonlyMap<string, TimedTask>,
  serveMs: number,
) {
  const taskChildren = children.get(task.id) ?? [];
  return taskChildren.length === 0
    ? serveMs
    : Math.min(...taskChildren.map((child) => scheduled.get(child.id)!.startMs));
}

function findLatestSlot(
  task: ScheduleTask,
  deadlineMs: number,
  availableMs: number,
  reservations: readonly ResourceReservation[],
  resourceIds: ResourceId[],
) {
  const durationMs = task.durationMinutes * MINUTE_MS;
  let consideredResourceSlot = false;
  for (let endMs = deadlineMs; endMs - durationMs >= availableMs; endMs -= MINUTE_MS) {
    const candidate = {
      taskId: task.id,
      startMs: endMs - durationMs,
      endMs,
      resourceIds,
    };
    if (resourceIds.length === 0 || canReserve(reservations, candidate)) {
      return { slot: { startMs: candidate.startMs, endMs }, conflicted: false };
    }
    consideredResourceSlot = true;
  }
  return { slot: null, conflicted: consideredResourceSlot };
}

function stableTimeline(entries: readonly TimedTask[]) {
  return [...entries].sort((left, right) =>
    left.startMs - right.startMs
    || left.endMs - right.endMs
    || compareText(left.task.id, right.task.id));
}

function convertTimeline(entries: readonly TimedTask[]): ScheduledTask[] | null {
  try {
    return stableTimeline(entries).map((entry) => ({
      taskId: entry.task.id,
      plannedStart: fromEpochMs(entry.startMs),
      plannedEnd: fromEpochMs(entry.endMs),
      effectiveResources: [...entry.resourceIds],
    }));
  } catch {
    return null;
  }
}

function reverseSchedule(
  request: ScheduleRequest,
  availableMs: number,
  serveMs: number,
): { issues: ScheduleIssue[] } | { timeline: TimedTask[] } {
  const children = childMap(request.tasks);
  const scores = upstreamScores(request.tasks);
  const remaining = new Map(request.tasks.map((task) => [task.id, task]));
  const scheduled = new Map<string, TimedTask>();
  let reservations: ResourceReservation[] = [];

  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter((task) => (children.get(task.id) ?? [])
        .every((child) => scheduled.has(child.id)))
      .sort((left, right) => {
        const leftEnd = latestEnd(left, children, scheduled, serveMs);
        const rightEnd = latestEnd(right, children, scheduled, serveMs);
        return rightEnd - leftEnd
          || (scores.get(right.id) ?? 0) - (scores.get(left.id) ?? 0)
          || compareText(left.recipeId, right.recipeId)
          || compareText(left.id, right.id);
      });
    const task = ready[0];
    if (!task) return { issues: [issue("DEPENDENCY_CYCLE", [...remaining.keys()])] };
    const resourceIds = resolveTaskResourceIds(task);
    const search = findLatestSlot(
      task,
      latestEnd(task, children, scheduled, serveMs),
      availableMs,
      reservations,
      resourceIds,
    );
    if (!search.slot) {
      const issues = search.conflicted
        ? [
          issue("RESOURCE_CONFLICT", [task.id]),
          issue("WINDOW_INFEASIBLE", [task.id]),
        ]
        : [issue("WINDOW_INFEASIBLE", [task.id])];
      return { issues };
    }
    const slot = search.slot;
    const entry = { task, ...slot, resourceIds };
    if (resourceIds.length > 0) {
      reservations = reserve(reservations, {
        taskId: task.id,
        startMs: slot.startMs,
        endMs: slot.endMs,
        resourceIds,
      })!;
    }
    scheduled.set(task.id, entry);
    remaining.delete(task.id);
  }
  return { timeline: stableTimeline([...scheduled.values()]) };
}

export function scheduleDinner(request: ScheduleRequest): ScheduleResult {
  const graphIssues = validateTaskGraph(request.tasks, request.kitchen);
  const times = parseTimes(request);
  if (graphIssues.length > 0 || times.issues.length > 0) {
    return infeasible(request, [...times.issues, ...graphIssues], false);
  }
  const availableMs = times.availableMs!;
  const serveMs = times.serveMs!;
  if (request.serveToleranceMinutes !== 5 || availableMs > serveMs) {
    return infeasible(
      request,
      [issue("WINDOW_INFEASIBLE", ["availableFrom", "serveAt"])],
      true,
    );
  }
  if (request.tasks.some((task) =>
    !Number.isSafeInteger(task.durationMinutes * MINUTE_MS))) {
    return infeasible(
      request,
      [issue("WINDOW_INFEASIBLE", request.tasks.map((task) => task.id))],
      true,
    );
  }

  const attempt = reverseSchedule(request, availableMs, serveMs);
  if ("issues" in attempt) return infeasible(request, attempt.issues, true);
  const ovenIssues = ovenTransitionIssueIds(attempt.timeline);
  if (ovenIssues.length > 0) {
    return infeasible(
      request,
      [issue("OVEN_TRANSITION_REQUIRED", ovenIssues)],
      true,
    );
  }
  const windowStart = serveMs - request.serveToleranceMinutes * MINUTE_MS;
  const lateTerminals = attempt.timeline
    .filter((entry) => entry.task.isTerminal)
    .filter((entry) => entry.endMs < windowStart || entry.endMs > serveMs)
    .map((entry) => entry.task.id);
  if (lateTerminals.length > 0) {
    return infeasible(
      request,
      [issue("WINDOW_INFEASIBLE", lateTerminals)],
      true,
    );
  }
  const tasks = convertTimeline(attempt.timeline);
  if (!tasks) {
    return infeasible(
      request,
      [issue("WINDOW_INFEASIBLE", request.tasks.map((task) => task.id))],
      true,
    );
  }
  return { feasible: true, tasks, serveAt: fromEpochMs(serveMs) };
}
