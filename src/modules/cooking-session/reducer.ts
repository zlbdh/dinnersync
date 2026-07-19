import { fromEpochMs, parseIsoInstant, toEpochMs } from "@/shared";
import { replanRemainingTasks } from "@/modules/scheduling";
import type { Schedule, ScheduleResult } from "@/modules/scheduling";

import { advanceSessionTime } from "./clock";
import {
  canStartTask,
  selectActiveTaskLocks,
  selectCompletedTaskIds,
} from "./selectors";
import type {
  CookingSessionState,
  SessionCommand,
  SessionCommandIssue,
  SessionEvent,
} from "./types";

function rejectCommand(
  state: CookingSessionState,
  code: SessionCommandIssue["code"],
  taskId: string,
) {
  return { ...state, lastCommandIssue: { code, taskId } };
}

function safelyAddMinutes(baseMs: number, minutes: number) {
  const deltaMs = minutes * 60_000;
  const resultMs = baseMs + deltaMs;
  if (!Number.isSafeInteger(deltaMs) || !Number.isSafeInteger(resultMs)) return null;
  try {
    return fromEpochMs(resultMs);
  } catch {
    return null;
  }
}

function latestEventMs(state: CookingSessionState) {
  return Math.max(-Infinity, ...state.events.map((event) => toEpochMs(event.at)));
}

function hasResourceConflict(state: CookingSessionState, taskId: string) {
  const scheduled = state.schedule.tasks.find((task) => task.taskId === taskId);
  if (!scheduled) return false;
  const occupied = new Set(selectActiveTaskLocks(state)
    .filter((lock) => lock.taskId !== taskId)
    .flatMap((lock) => lock.effectiveResources));
  return scheduled.effectiveResources.some((resourceId) => occupied.has(resourceId));
}

function isDuplicate(state: CookingSessionState, command: SessionCommand) {
  const eventType = command.type === "START"
    ? "TASK_STARTED"
    : command.type === "DELAY" ? "TASK_DELAYED" : "TASK_COMPLETED";
  return state.events.some((event) => event.type === eventType
    && event.taskId === command.taskId
    && event.at === command.at
    && (command.type !== "DELAY"
      || (event.type === "TASK_DELAYED" && event.delayMinutes === command.delayMinutes)));
}

function selectedSchedule(current: Schedule, result: ScheduleResult): Schedule {
  if (result.feasible) return result;
  if (!result.earliestFeasible) return current;
  return { feasible: true, ...result.earliestFeasible };
}

function applyReplan(state: CookingSessionState, at: string) {
  const result = replanRemainingTasks({
    request: state.request,
    previous: state.schedule,
    now: at,
    completedTaskIds: selectCompletedTaskIds(state),
    activeTasks: selectActiveTaskLocks(state),
  });
  const schedule = selectedSchedule(state.schedule, result);
  const planned = new Map(schedule.tasks.map((task) => [task.taskId, task]));
  const runtime = Object.fromEntries(Object.entries(state.runtime).map(([id, task]) => {
    const next = planned.get(id);
    return [id, next && (task.status === "scheduled" || task.status === "ready")
      ? { ...task, plannedStart: next.plannedStart, plannedEnd: next.plannedEnd }
      : task];
  }));
  const warning = result.feasible ? null : {
    code: "SCHEDULE_INFEASIBLE" as const,
    message: result.earliestFeasible
      ? "The original dinner time is no longer feasible. DinnerSync is using the earliest safe timeline."
      : "Locked work makes the remaining schedule temporarily infeasible.",
  };
  const warnings = warning && !state.warnings.some((entry) =>
    entry.code === warning.code && entry.message === warning.message)
    ? [...state.warnings, warning] : state.warnings;
  return advanceSessionTime({
    ...state,
    schedule,
    runtime,
    lastReplan: result,
    warnings,
  }, at);
}

export function applySessionCommand(
  state: CookingSessionState,
  command: SessionCommand,
): CookingSessionState {
  const parsedAt = parseIsoInstant(command.at);
  if (isDuplicate(state, command) || !parsedAt.ok) return state;
  const atMs = toEpochMs(parsedAt.value);
  if (atMs < latestEventMs(state)) return state;
  const beforeAdvance = state.runtime[command.taskId];
  if (!beforeAdvance) return state;
  if (command.type === "DELAY") {
    if ((beforeAdvance.status !== "running" && beforeAdvance.status !== "due")
      || !Number.isSafeInteger(command.delayMinutes)
      || command.delayMinutes <= 0
      || beforeAdvance.actualStart === null
      || atMs < toEpochMs(beforeAdvance.actualStart)
      || beforeAdvance.expectedEnd === null) return state;
    const baseMs = Math.max(toEpochMs(beforeAdvance.expectedEnd), atMs);
    const expectedEnd = safelyAddMinutes(baseMs, command.delayMinutes);
    if (expectedEnd === null) {
      return rejectCommand(state, "INVALID_DELAY", command.taskId);
    }
    const advanced = advanceSessionTime(state, command.at);
    const current = advanced.runtime[command.taskId];
    const event: SessionEvent = {
      sequence: (advanced.events.at(-1)?.sequence ?? 0) + 1,
      type: "TASK_DELAYED",
      taskId: command.taskId,
      at: command.at,
      delayMinutes: command.delayMinutes,
    };
    return applyReplan({
      ...advanced,
      lastCommandIssue: null,
      runtime: {
        ...advanced.runtime,
        [command.taskId]: { ...current, status: "running", expectedEnd },
      },
      events: [...advanced.events, event],
    }, command.at);
  }
  if (command.type === "COMPLETE") {
    if ((beforeAdvance.status !== "running" && beforeAdvance.status !== "due")
      || beforeAdvance.actualStart === null
      || atMs < toEpochMs(beforeAdvance.actualStart)) return state;
    const advanced = advanceSessionTime(state, command.at);
    const current = advanced.runtime[command.taskId];
    const event: SessionEvent = {
      sequence: (advanced.events.at(-1)?.sequence ?? 0) + 1,
      type: "TASK_COMPLETED",
      taskId: command.taskId,
      at: command.at,
    };
    return applyReplan({
      ...advanced,
      lastCommandIssue: null,
      runtime: {
        ...advanced.runtime,
        [command.taskId]: { ...current, status: "completed", actualEnd: command.at },
      },
      events: [...advanced.events, event],
    }, command.at);
  }
  const advanced = advanceSessionTime(state, command.at);
  const current = advanced.runtime[command.taskId];
  if (command.type !== "START" || atMs < toEpochMs(current.plannedStart)) return state;
  if (beforeAdvance.status !== "ready") {
    return hasResourceConflict(advanced, command.taskId)
      ? rejectCommand(advanced, "RESOURCE_LOCKED", command.taskId)
      : state;
  }
  if (!canStartTask(advanced, command.taskId)) {
    return hasResourceConflict(advanced, command.taskId)
      ? rejectCommand(advanced, "RESOURCE_LOCKED", command.taskId)
      : state;
  }
  const definition = advanced.request.tasks.find((task) => task.id === command.taskId);
  if (!definition) return state;
  const expectedEnd = safelyAddMinutes(atMs, definition.durationMinutes);
  if (expectedEnd === null) return rejectCommand(state, "INVALID_START", command.taskId);
  const event: SessionEvent = {
    sequence: (advanced.events.at(-1)?.sequence ?? 0) + 1,
    type: "TASK_STARTED",
    taskId: command.taskId,
    at: command.at,
  };
  const runtime = {
    ...advanced.runtime,
    [command.taskId]: {
      ...current,
      status: "running" as const,
      actualStart: command.at,
      expectedEnd,
    },
  };
  return applyReplan(
    {
      ...advanced,
      runtime,
      events: [...advanced.events, event],
      lastCommandIssue: null,
    },
    command.at,
  );
}
