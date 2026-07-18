import type { Schedule, ScheduleRequest } from "@/modules/scheduling";

import type { CookingSessionState, TaskRuntimeState } from "./types";

function copySchedule(schedule: Schedule): Schedule {
  return {
    ...schedule,
    tasks: schedule.tasks.map((task) => ({
      ...task,
      effectiveResources: [...task.effectiveResources],
    })),
  };
}

export function createCookingSession(
  request: ScheduleRequest,
  initialSchedule: Schedule,
): CookingSessionState {
  const sessionRequest = structuredClone(request);
  const runtime = Object.fromEntries(initialSchedule.tasks.map((task): [string, TaskRuntimeState] => [
    task.taskId,
    {
      taskId: task.taskId,
      status: "scheduled",
      plannedStart: task.plannedStart,
      plannedEnd: task.plannedEnd,
      actualStart: null,
      actualEnd: null,
      expectedEnd: null,
    },
  ]));
  return {
    request: sessionRequest,
    initialSchedule: copySchedule(initialSchedule),
    schedule: copySchedule(initialSchedule),
    runtime,
    events: [],
    lastReplan: null,
    lastCommandIssue: null,
    warnings: [],
  };
}
