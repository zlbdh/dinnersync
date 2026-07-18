import { ovenTransitionIssueIds } from "./forward-schedule";
import { findEarliestResourceSlot, findLatestResourceSlot, reserve } from "./intervals";
import {
  compareText,
  fixedTimed,
  lowerBound,
  MINUTE_MS,
  parsedMs,
  terminalsFit,
  toSchedule,
} from "./replan-context";
import type { ReplanContext, TimedTask } from "./replan-context";
import { alignTerminalWindow } from "./terminal-alignment";
import type { Schedule, ScheduleTask } from "./types";
import { resolveTaskResourceIds } from "./validate";

export function previousTarget(context: ReplanContext): Schedule | null {
  const planned = context.remaining.map((task): TimedTask => {
    const previous = context.previous.get(task.id)!;
    return {
      task,
      startMs: parsedMs(previous.plannedStart)!,
      endMs: parsedMs(previous.plannedEnd)!,
      resourceIds: resolveTaskResourceIds(task),
    };
  });
  const byId = new Map(planned.map((entry) => [entry.task.id, entry]));
  if (planned.some((entry) =>
    entry.startMs < lowerBound(context, entry.task)
    || entry.endMs - entry.startMs !== entry.task.durationMinutes * MINUTE_MS
    || entry.task.dependsOn.some((id) => {
      const dependency = byId.get(id);
      return dependency !== undefined && dependency.endMs > entry.startMs;
    }))) return null;

  let reservations = [...context.reservations];
  for (const entry of [...planned].sort((left, right) =>
    left.startMs - right.startMs || compareText(left.task.id, right.task.id))) {
    if (entry.resourceIds.length === 0) continue;
    const next = reserve(reservations, {
      taskId: entry.task.id,
      startMs: entry.startMs,
      endMs: entry.endMs,
      resourceIds: entry.resourceIds,
    });
    if (!next) return null;
    reservations = next;
  }
  const combined = [...fixedTimed(context), ...planned];
  if (!terminalsFit(combined, context.serveMs)
    || ovenTransitionIssueIds(combined).length > 0) return null;
  return toSchedule(context, planned, context.serveMs);
}

export function reverseTarget(context: ReplanContext): Schedule | null {
  const remaining = new Map(context.remaining.map((task) => [task.id, task]));
  const children = new Map<string, ScheduleTask[]>();
  context.remaining.forEach((task) => task.dependsOn.forEach((id) => {
    if (remaining.has(id)) children.set(id, [...(children.get(id) ?? []), task]);
  }));
  const planned = new Map<string, TimedTask>();
  let reservations = [...context.reservations];
  while (planned.size < context.remaining.length) {
    const ready = context.remaining.filter((task) => !planned.has(task.id)
      && (children.get(task.id) ?? []).every((child) => planned.has(child.id)))
      .sort((left, right) => {
        const leftEnd = Math.min(context.serveMs, ...(children.get(left.id) ?? [])
          .map((child) => planned.get(child.id)!.startMs));
        const rightEnd = Math.min(context.serveMs, ...(children.get(right.id) ?? [])
          .map((child) => planned.get(child.id)!.startMs));
        return rightEnd - leftEnd
          || (left.isTerminal && right.isTerminal
            ? left.durationMinutes - right.durationMinutes : 0)
          || compareText(left.id, right.id);
      });
    const task = ready[0];
    if (!task) return null;
    const deadline = Math.min(context.serveMs, ...(children.get(task.id) ?? [])
      .map((child) => planned.get(child.id)!.startMs));
    const durationMs = task.durationMinutes * MINUTE_MS;
    const resourceIds = resolveTaskResourceIds(task);
    const slot = resourceIds.length === 0
      ? { startMs: deadline - durationMs, endMs: deadline }
      : findLatestResourceSlot(reservations, {
        taskId: task.id,
        notBeforeMs: lowerBound(context, task),
        notAfterMs: deadline,
        durationMs,
        stepMs: MINUTE_MS,
        resourceIds,
      });
    if (!slot || slot.startMs < lowerBound(context, task)) return null;
    const entry = { task, ...slot, resourceIds };
    if (resourceIds.length > 0) reservations = reserve(reservations, {
      taskId: task.id, ...slot, resourceIds,
    })!;
    planned.set(task.id, entry);
  }
  const combined = [...fixedTimed(context), ...planned.values()];
  if (!terminalsFit(combined, context.serveMs)
    || ovenTransitionIssueIds(combined).length > 0) return null;
  return toSchedule(context, [...planned.values()], context.serveMs);
}

export function forwardEarliest(context: ReplanContext): Schedule | null {
  const planned = new Map<string, TimedTask>();
  let reservations = [...context.reservations];
  const totalMs = context.remaining.reduce((sum, task) =>
    sum + task.durationMinutes * MINUTE_MS, 0);
  const activeTail = Math.max(0, ...context.input.activeTasks
    .map((lock) => parsedMs(lock.expectedEnd)! - context.nowMs));
  const horizon = context.nowMs + totalMs + activeTail;
  if (!Number.isSafeInteger(horizon)) return null;
  while (planned.size < context.remaining.length) {
    const ready = context.remaining.filter((task) => !planned.has(task.id)
      && task.dependsOn.every((id) => context.completed.has(id)
        || context.active.has(id) || planned.has(id)))
      .sort((left, right) => Number(left.isTerminal) - Number(right.isTerminal)
        || compareText(left.id, right.id));
    const task = ready[0];
    if (!task) return null;
    const notBeforeMs = Math.max(lowerBound(context, task), ...task.dependsOn
      .filter((id) => planned.has(id)).map((id) => planned.get(id)!.endMs));
    const durationMs = task.durationMinutes * MINUTE_MS;
    const resourceIds = resolveTaskResourceIds(task);
    const slot = resourceIds.length === 0
      ? { startMs: notBeforeMs, endMs: notBeforeMs + durationMs }
      : findEarliestResourceSlot(reservations, {
        taskId: task.id, notBeforeMs, notAfterMs: horizon,
        durationMs, stepMs: MINUTE_MS, resourceIds,
      });
    if (!slot || !Number.isSafeInteger(slot.endMs)) return null;
    const entry = { task, ...slot, resourceIds };
    if (resourceIds.length > 0) reservations = reserve(reservations, {
      taskId: task.id, ...slot, resourceIds,
    })!;
    planned.set(task.id, entry);
  }
  const fixed = fixedTimed(context);
  const fixedTerminal = fixed.some((entry) => entry.task.isTerminal);
  const combined = [...fixed, ...planned.values()];
  const aligned = fixedTerminal
    ? combined
    : alignTerminalWindow(combined, context.nowMs, 5);
  if (!aligned || ovenTransitionIssueIds(aligned).length > 0) return null;
  const serveMs = Math.max(...aligned.filter((entry) => entry.task.isTerminal)
    .map((entry) => entry.endMs));
  if (!terminalsFit(aligned, serveMs)) return null;
  return toSchedule(context, aligned.filter((entry) => planned.has(entry.task.id)), serveMs);
}
