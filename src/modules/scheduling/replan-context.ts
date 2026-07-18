import {
  fromEpochMs,
  isResourceId,
  parseIsoInstant,
  toEpochMs,
} from "@/shared";
import type { ResourceId } from "@/shared";

import { reserve } from "./intervals";
import type { ResourceReservation } from "./intervals";
import { terminalSemanticsIssues } from "./request-validation";
import type {
  ActiveTaskLock,
  ReplanRequest,
  ReplanResult,
  Schedule,
  ScheduleIssue,
  ScheduledTask,
  ScheduleTask,
} from "./types";
import { resolveTaskResourceIds, validateTaskGraph } from "./validate";

export const MINUTE_MS = 60_000;

export type TimedTask = {
  task: ScheduleTask;
  startMs: number;
  endMs: number;
  resourceIds: ResourceId[];
};

export type ReplanContext = {
  input: ReplanRequest;
  tasks: Map<string, ScheduleTask>;
  previous: Map<string, ScheduledTask>;
  completed: Set<string>;
  active: Map<string, ActiveTaskLock>;
  remaining: ScheduleTask[];
  availableMs: number;
  nowMs: number;
  serveMs: number;
  reservations: ResourceReservation[];
};

export function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function issue(
  code: ScheduleIssue["code"],
  taskIds: readonly string[],
): ScheduleIssue {
  return { code, taskIds: [...new Set(taskIds)].sort(compareText) };
}

export function failed(issues: ScheduleIssue[]): ReplanResult {
  return { feasible: false, issues, earliestFeasible: null };
}

function sameResources(left: readonly ResourceId[], right: readonly ResourceId[]) {
  return [...left].sort(compareText).join("\0") === [...right].sort(compareText).join("\0");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsedMs(value: unknown) {
  const parsed = parseIsoInstant(value);
  return parsed.ok ? toEpochMs(parsed.value) : null;
}

export function prepareReplan(input: ReplanRequest): ReplanContext | ReplanResult {
  if (!isRecord(input) || !isRecord(input.request)
    || !Array.isArray(input.request.tasks)
    || !Array.isArray(input.completedTaskIds)
    || !input.completedTaskIds.every((id) => typeof id === "string")
    || !Array.isArray(input.activeTasks)
    || !input.activeTasks.every((lock) => isRecord(lock)
      && typeof lock.taskId === "string")
    || !isRecord(input.previous)
    || input.previous.feasible !== true
    || !Array.isArray(input.previous.tasks)
    || !input.previous.tasks.every((entry) => isRecord(entry)
      && typeof entry.taskId === "string")) {
    return failed([issue("INVALID_TASK", ["request"])]);
  }
  const graphIssues = validateTaskGraph(input.request.tasks, input.request.kitchen);
  const semanticIssues = graphIssues.length === 0
    ? terminalSemanticsIssues(input.request.tasks) : [];
  const availableMs = parsedMs(input.request.availableFrom);
  const nowMs = parsedMs(input.now);
  const serveMs = parsedMs(input.request.serveAt);
  if (graphIssues.length > 0 || semanticIssues.length > 0) {
    return failed([...graphIssues, ...semanticIssues]);
  }
  const invalidTimes = [
    ...(availableMs === null ? ["availableFrom"] : []),
    ...(nowMs === null ? ["now"] : []),
    ...(serveMs === null ? ["serveAt"] : []),
  ];
  if (availableMs === null || nowMs === null || serveMs === null) {
    return failed([issue("INVALID_TIME", invalidTimes)]);
  }
  if (input.request.serveToleranceMinutes !== 5) {
    return failed([issue("INVALID_TIME", ["serveToleranceMinutes"])]);
  }
  const tasks = new Map(input.request.tasks.map((task) => [task.id, task]));
  const previousEntries = input.previous?.feasible === true && Array.isArray(input.previous.tasks)
    ? input.previous.tasks : [];
  const previous = new Map(previousEntries.map((entry) => [entry.taskId, entry]));
  const completed = new Set(input.completedTaskIds);
  const active = new Map(input.activeTasks.map((entry) => [entry.taskId, entry]));
  const stateIds = [...input.completedTaskIds, ...input.activeTasks.map((entry) => entry.taskId)];
  const malformed = previous.size !== tasks.size
    || previousEntries.length !== tasks.size
    || completed.size !== input.completedTaskIds.length
    || active.size !== input.activeTasks.length
    || new Set(stateIds).size !== stateIds.length
    || stateIds.some((id) => !tasks.has(id));
  if (malformed) return failed([issue("INVALID_TASK", stateIds.length ? stateIds : ["state"])]);

  for (const [id, task] of tasks) {
    const entry = previous.get(id);
    if (!entry || parsedMs(entry.plannedStart) === null || parsedMs(entry.plannedEnd) === null
      || !Array.isArray(entry.effectiveResources)
      || !entry.effectiveResources.every(isResourceId)
      || !sameResources(entry.effectiveResources, resolveTaskResourceIds(task))) {
      return failed([issue("INVALID_TASK", [id])]);
    }
    if (completed.has(id)
      && !task.dependsOn.every((dependency) => completed.has(dependency))) {
      return failed([issue("MISSING_DEPENDENCY", [id])]);
    }
  }

  let reservations: ResourceReservation[] = [];
  for (const lock of input.activeTasks) {
    const task = tasks.get(lock.taskId)!;
    const startMs = parsedMs(lock.actualStart);
    const endMs = parsedMs(lock.expectedEnd);
    const lockMs = lock.status === "running" ? parsedMs(lock.lockUntil) : null;
    if ((lock.status !== "running" && lock.status !== "due")
      || startMs === null || endMs === null || endMs <= startMs
      || startMs > nowMs
      || (lock.status === "running" && endMs <= nowMs)
      || (lock.status === "due" && endMs > nowMs)
      || (lock.status === "running" && lockMs !== endMs)
      || (lock.status === "due" && lock.lockUntil !== null)
      || !Array.isArray(lock.effectiveResources)
      || !lock.effectiveResources.every(isResourceId)
      || !sameResources(lock.effectiveResources, resolveTaskResourceIds(task))
      || !task.dependsOn.every((dependency) => completed.has(dependency))) {
      return failed([issue("INVALID_TASK", [lock.taskId])]);
    }
    if (lock.status === "running" && lock.effectiveResources.length > 0) {
      const next = reserve(reservations, {
        taskId: lock.taskId,
        startMs,
        endMs,
        resourceIds: lock.effectiveResources,
      });
      if (!next) return failed([issue("RESOURCE_CONFLICT", [lock.taskId])]);
      reservations = next;
    }
  }
  const remaining = input.request.tasks.filter((task) =>
    !completed.has(task.id) && !active.has(task.id));
  const blockedFixed = [...completed, ...active.keys()].filter((id) =>
    tasks.get(id)!.dependsOn.some((dependency) => !completed.has(dependency)));
  if (blockedFixed.length > 0) {
    return failed([issue("MISSING_DEPENDENCY", blockedFixed)]);
  }
  return {
    input, tasks, previous, completed, active, remaining,
    availableMs, nowMs, serveMs, reservations,
  };
}

export function lowerBound(context: ReplanContext, task: ScheduleTask) {
  return Math.max(context.availableMs, context.nowMs, ...task.dependsOn
    .filter((id) => context.active.has(id))
    .map((id) => parsedMs(context.active.get(id)!.expectedEnd)!));
}

export function fixedTimed(context: ReplanContext): TimedTask[] {
  return [...context.completed, ...context.active.keys()].map((id) => {
    const task = context.tasks.get(id)!;
    const previous = context.previous.get(id)!;
    const lock = context.active.get(id);
    return {
      task,
      startMs: lock ? parsedMs(lock.actualStart)! : parsedMs(previous.plannedStart)!,
      endMs: lock ? parsedMs(lock.expectedEnd)! : parsedMs(previous.plannedEnd)!,
      resourceIds: context.completed.has(id) ? [] : [...previous.effectiveResources],
    };
  });
}

export function toSchedule(
  context: ReplanContext,
  planned: readonly TimedTask[],
  serveMs: number,
): Schedule | null {
  try {
    const moving = new Map(planned.map((entry) => [entry.task.id, entry]));
    const tasks = context.input.request.tasks.map((task) => {
      if (context.completed.has(task.id) || context.active.has(task.id)) {
        const fixed = context.previous.get(task.id)!;
        return { ...fixed, effectiveResources: [...fixed.effectiveResources] };
      }
      const entry = moving.get(task.id)!;
      return {
        taskId: task.id,
        plannedStart: fromEpochMs(entry.startMs),
        plannedEnd: fromEpochMs(entry.endMs),
        effectiveResources: [...entry.resourceIds],
      };
    }).sort((left, right) => toEpochMs(left.plannedStart) - toEpochMs(right.plannedStart)
      || compareText(left.taskId, right.taskId));
    return { feasible: true, tasks, serveAt: fromEpochMs(serveMs) };
  } catch {
    return null;
  }
}

export function terminalsFit(entries: readonly TimedTask[], serveMs: number) {
  const start = serveMs - 5 * MINUTE_MS;
  return entries.filter((entry) => entry.task.isTerminal)
    .every((entry) => entry.endMs >= start && entry.endMs <= serveMs);
}
