import { parseIsoInstant, toEpochMs } from "@/shared";

import type { CookingSessionState, SessionEvent, TaskRuntimeState } from "./types";

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function activeResourceIds(state: CookingSessionState, exceptTaskId: string) {
  const activeIds = new Set(Object.values(state.runtime)
    .filter((task) => task.taskId !== exceptTaskId
      && (task.status === "running" || task.status === "due"))
    .map((task) => task.taskId));
  return new Set(state.schedule.tasks
    .filter((task) => activeIds.has(task.taskId))
    .flatMap((task) => task.effectiveResources));
}

function canBecomeReady(state: CookingSessionState, task: TaskRuntimeState, nowMs: number) {
  const definition = state.request.tasks.find((entry) => entry.id === task.taskId);
  const scheduled = state.schedule.tasks.find((entry) => entry.taskId === task.taskId);
  if (!definition || !scheduled || toEpochMs(task.plannedStart) > nowMs) return false;
  if (!definition.dependsOn.every((id) => state.runtime[id]?.status === "completed")) {
    return false;
  }
  const occupied = activeResourceIds(state, task.taskId);
  return scheduled.effectiveResources.every((resourceId) => !occupied.has(resourceId));
}

function deriveReadiness(state: CookingSessionState, nowMs: number) {
  const runtime: Record<string, TaskRuntimeState> = Object.fromEntries(
    Object.entries(state.runtime).map(([id, task]): [string, TaskRuntimeState] => {
    if (task.status !== "scheduled" && task.status !== "ready") return [id, task];
    const status = canBecomeReady(state, task, nowMs) ? "ready" : "scheduled";
    return [id, { ...task, status }];
    }),
  );
  return { ...state, runtime };
}

export function advanceSessionTime(
  state: CookingSessionState,
  now: string,
): CookingSessionState {
  const parsed = parseIsoInstant(now);
  if (!parsed.ok) return state;
  const nowMs = toEpochMs(parsed.value);
  const latestEventMs = Math.max(
    -Infinity,
    ...state.events.map((event) => toEpochMs(event.at)),
  );
  if (nowMs < latestEventMs) return state;
  const dueTasks = Object.values(state.runtime)
    .filter((task) => task.status === "running" && task.expectedEnd !== null
      && toEpochMs(task.expectedEnd) <= nowMs)
    .sort((left, right) => toEpochMs(left.expectedEnd!) - toEpochMs(right.expectedEnd!)
      || compareText(left.taskId, right.taskId));
  if (dueTasks.length === 0) return deriveReadiness(state, nowMs);

  let sequence = state.events.at(-1)?.sequence ?? 0;
  const dueEvents: SessionEvent[] = dueTasks.map((task) => ({
    sequence: ++sequence,
    type: "TASK_DUE",
    taskId: task.taskId,
    at: task.expectedEnd!,
  }));
  const runtime = { ...state.runtime };
  dueTasks.forEach((task) => {
    runtime[task.taskId] = { ...task, status: "due" };
  });
  return deriveReadiness(
    { ...state, runtime, events: [...state.events, ...dueEvents] },
    nowMs,
  );
}
