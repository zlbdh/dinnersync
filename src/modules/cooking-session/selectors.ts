import type { ActiveTaskLock } from "@/modules/scheduling";

import type { CookingSessionState, TaskRuntimeState } from "./types";

export function selectTaskState(
  state: CookingSessionState,
  taskId: string,
): TaskRuntimeState | null {
  return state.runtime[taskId] ?? null;
}

export function selectCompletedTaskIds(state: CookingSessionState): string[] {
  return Object.values(state.runtime)
    .filter((task) => task.status === "completed")
    .map((task) => task.taskId)
    .sort();
}

export function selectActiveTaskLocks(state: CookingSessionState): ActiveTaskLock[] {
  const schedule = new Map(state.schedule.tasks.map((task) => [task.taskId, task]));
  return Object.values(state.runtime)
    .filter((task) => (task.status === "running" || task.status === "due")
      && task.actualStart !== null && task.expectedEnd !== null)
    .sort((left, right) => left.taskId.localeCompare(right.taskId))
    .map((task) => ({
      taskId: task.taskId,
      status: task.status as "running" | "due",
      actualStart: task.actualStart!,
      expectedEnd: task.expectedEnd!,
      lockUntil: task.status === "running" ? task.expectedEnd! : null,
      effectiveResources: [...(schedule.get(task.taskId)?.effectiveResources ?? [])],
    }) as ActiveTaskLock);
}

export function canStartTask(state: CookingSessionState, taskId: string) {
  const runtime = state.runtime[taskId];
  const definition = state.request.tasks.find((task) => task.id === taskId);
  const scheduled = state.schedule.tasks.find((task) => task.taskId === taskId);
  if (!runtime || runtime.status !== "ready" || !definition || !scheduled) return false;
  if (!definition.dependsOn.every((id) => state.runtime[id]?.status === "completed")) {
    return false;
  }
  const occupied = new Set(selectActiveTaskLocks(state)
    .filter((lock) => lock.taskId !== taskId)
    .flatMap((lock) => lock.effectiveResources));
  return scheduled.effectiveResources.every((resourceId) => !occupied.has(resourceId));
}
