import type { CookingSessionState, SessionCommand } from "@/modules/cooking-session";
import { fromEpochMs, toEpochMs, type IsoInstant } from "@/shared";

export type DemoPlaybackBeat = {
  command: SessionCommand;
  kind: "start" | "delay" | "complete";
};

function cursorMs(state: CookingSessionState, notBefore: IsoInstant) {
  return Math.max(
    toEpochMs(state.request.availableFrom),
    toEpochMs(notBefore),
    ...state.events.map((event) => toEpochMs(event.at)),
  );
}

function hasDemoDelay(state: CookingSessionState) {
  return state.events.some((event) => event.type === "TASK_DELAYED"
    && event.taskId === "chicken-roast" && event.delayMinutes === 8);
}

function completionBeats(state: CookingSessionState, nowMs: number) {
  return Object.values(state.runtime)
    .filter((task) => (task.status === "running" || task.status === "due")
      && task.expectedEnd !== null)
    .map((task): DemoPlaybackBeat => ({
      kind: "complete",
      command: {
        type: "COMPLETE",
        taskId: task.taskId,
        at: fromEpochMs(Math.max(nowMs, toEpochMs(task.expectedEnd!))),
      },
    }));
}

function startBeats(state: CookingSessionState, nowMs: number) {
  const definitions = new Map(state.request.tasks.map((task) => [task.id, task]));
  const completed = new Set(Object.values(state.runtime)
    .filter((task) => task.status === "completed")
    .map((task) => task.taskId));
  const scheduled = new Map(state.schedule.tasks.map((task) => [task.taskId, task]));
  const active = Object.values(state.runtime)
    .filter((task) => (task.status === "running" || task.status === "due")
      && task.expectedEnd !== null);

  return Object.values(state.runtime)
    .filter((task) => task.status === "ready" || task.status === "scheduled")
    .filter((task) => definitions.get(task.taskId)?.dependsOn.every((id) =>
      completed.has(id)) === true)
    .flatMap((task): DemoPlaybackBeat[] => {
      const atMs = Math.max(nowMs, toEpochMs(task.plannedStart));
      const resources = scheduled.get(task.taskId)?.effectiveResources ?? [];
      const blocked = active.some((running) => {
        if (toEpochMs(running.expectedEnd!) <= atMs) return false;
        const occupied = scheduled.get(running.taskId)?.effectiveResources ?? [];
        return resources.some((resourceId) => occupied.includes(resourceId));
      });
      return blocked ? [] : [{
        kind: "start",
        command: {
          type: "START",
          taskId: task.taskId,
          at: fromEpochMs(atMs),
        },
      }];
    });
}

const BEAT_ORDER: Record<DemoPlaybackBeat["kind"], number> = {
  delay: 0,
  complete: 1,
  start: 2,
};

function compareBeats(left: DemoPlaybackBeat, right: DemoPlaybackBeat) {
  return toEpochMs(left.command.at) - toEpochMs(right.command.at)
    || BEAT_ORDER[left.kind] - BEAT_ORDER[right.kind]
    || left.command.taskId.localeCompare(right.command.taskId);
}

function delayBeat(state: CookingSessionState, nowMs: number): DemoPlaybackBeat | null {
  const roast = state.runtime["chicken-roast"];
  if (!roast || (roast.status !== "running" && roast.status !== "due")
    || roast.actualStart === null || hasDemoDelay(state)) return null;
  const at = fromEpochMs(Math.max(nowMs, toEpochMs(roast.actualStart) + 8 * 60_000));
  return {
    kind: "delay",
    command: { type: "DELAY", taskId: roast.taskId, at, delayMinutes: 8 },
  };
}

export function nextDemoCommand(
  state: CookingSessionState,
  notBefore: IsoInstant = state.request.availableFrom,
): DemoPlaybackBeat | null {
  const tasks = Object.values(state.runtime);
  if (tasks.length === 0 || tasks.every((task) => task.status === "completed")) {
    return null;
  }

  const nowMs = cursorMs(state, notBefore);
  const candidates = [
    delayBeat(state, nowMs),
    ...completionBeats(state, nowMs),
    ...startBeats(state, nowMs),
  ].filter((beat): beat is DemoPlaybackBeat => beat !== null);
  return candidates.sort(compareBeats)[0] ?? null;
}
