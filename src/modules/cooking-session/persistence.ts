import {
  ovenTransitionIssueIds,
  resolveTaskResourceIds,
  scheduleDinner,
} from "@/modules/scheduling";
import type { Schedule, ScheduleRequest } from "@/modules/scheduling";
import { isResourceId, parseIsoInstant, toEpochMs } from "@/shared";
import type { ResourceId } from "@/shared";

import { advanceSessionTime } from "./clock";
import { applySessionCommand } from "./reducer";
import { createCookingSession } from "./state";
import type {
  CookingSessionState,
  SessionEvent,
  SessionSnapshotV1,
  SessionWarning,
} from "./types";

export type SessionSeed = {
  request: ScheduleRequest;
  initialSchedule: Schedule;
};

export type SessionStorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type SessionPersistence = {
  save(state: CookingSessionState): CookingSessionState;
  restore(seed: SessionSeed, now: string): CookingSessionState;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function validInitialSchedule(value: unknown, request: ScheduleRequest): value is Schedule {
  if (!isRecord(value) || value.feasible !== true || !Array.isArray(value.tasks)
    || !parseIsoInstant(value.serveAt).ok || value.tasks.length !== request.tasks.length) {
    return false;
  }
  const definitions = new Map(request.tasks.map((task) => [task.id, task]));
  const available = parseIsoInstant(request.availableFrom);
  const requestedServe = parseIsoInstant(request.serveAt);
  if (!available.ok || !requestedServe.ok
    || toEpochMs(value.serveAt as string) !== toEpochMs(requestedServe.value)) return false;
  const ids = new Set<string>();
  const scheduled = new Map<string, {
    startMs: number;
    endMs: number;
    resources: ResourceId[];
  }>();
  for (const raw of value.tasks) {
    if (!isRecord(raw) || typeof raw.taskId !== "string" || ids.has(raw.taskId)
      || !parseIsoInstant(raw.plannedStart).ok || !parseIsoInstant(raw.plannedEnd).ok
      || !Array.isArray(raw.effectiveResources)
      || !raw.effectiveResources.every(isResourceId)) return false;
    const task = definitions.get(raw.taskId);
    if (!task) return false;
    const expected = resolveTaskResourceIds(task).toSorted();
    if (raw.effectiveResources.toSorted().join("\0") !== expected.join("\0")) return false;
    const startMs = toEpochMs(raw.plannedStart as string);
    const endMs = toEpochMs(raw.plannedEnd as string);
    if (startMs < toEpochMs(available.value)
      || endMs - startMs !== task.durationMinutes * 60_000) return false;
    scheduled.set(raw.taskId, {
      startMs,
      endMs,
      resources: raw.effectiveResources as ResourceId[],
    });
    ids.add(raw.taskId);
  }
  if (ids.size !== definitions.size) return false;
  const serveMs = toEpochMs(value.serveAt as string);
  for (const task of request.tasks) {
    const entry = scheduled.get(task.id)!;
    if (task.dependsOn.some((id) => scheduled.get(id)!.endMs > entry.startMs)) return false;
    if (task.isTerminal
      && (entry.endMs < serveMs - 5 * 60_000 || entry.endMs > serveMs)) return false;
  }
  const entries = [...scheduled.entries()];
  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      const a = entries[left][1];
      const b = entries[right][1];
      const overlap = a.startMs < b.endMs && b.startMs < a.endMs;
      if (overlap && a.resources.some((id) => b.resources.includes(id))) return false;
    }
  }
  const ovenEntries = request.tasks.map((task) => ({
    task,
    startMs: scheduled.get(task.id)!.startMs,
    endMs: scheduled.get(task.id)!.endMs,
  }));
  return ovenTransitionIssueIds(ovenEntries).length === 0;
}

function validEvent(value: unknown, index: number, taskIds: ReadonlySet<string>) {
  if (!isRecord(value) || value.sequence !== index + 1
    || typeof value.taskId !== "string" || !taskIds.has(value.taskId)
    || !parseIsoInstant(value.at).ok) return false;
  if (value.type === "TASK_DELAYED") {
    return exactKeys(value, ["sequence", "type", "taskId", "at", "delayMinutes"])
      && Number.isSafeInteger(value.delayMinutes) && Number(value.delayMinutes) > 0
      && Number.isSafeInteger(Number(value.delayMinutes) * 60_000);
  }
  return (value.type === "TASK_STARTED" || value.type === "TASK_DUE"
      || value.type === "TASK_COMPLETED")
    && exactKeys(value, ["sequence", "type", "taskId", "at"]);
}

function parseSnapshot(serialized: string): SessionSnapshotV1 | null {
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value)
      || !exactKeys(value, ["version", "request", "initialSchedule", "events"])
      || value.version !== 1 || !isRecord(value.request)
      || !Array.isArray(value.events)) return null;
    const request = value.request as ScheduleRequest;
    if (!scheduleDinner(request).feasible
      || !validInitialSchedule(value.initialSchedule, request)) return null;
    const taskIds = new Set(request.tasks.map((task) => task.id));
    if (!value.events.every((event, index) => validEvent(event, index, taskIds))) {
      return null;
    }
    const eventTimes = value.events.map((event) =>
      toEpochMs((event as Record<string, unknown>).at as string));
    if (eventTimes.some((time, index) => index > 0 && time < eventTimes[index - 1])) {
      return null;
    }
    return value as SessionSnapshotV1;
  } catch {
    return null;
  }
}

function sameEvent(left: SessionEvent, right: SessionEvent) {
  return left.sequence === right.sequence && left.type === right.type
    && left.taskId === right.taskId && left.at === right.at
    && (left.type !== "TASK_DELAYED" || (right.type === "TASK_DELAYED"
      && left.delayMinutes === right.delayMinutes));
}

function replay(snapshot: SessionSnapshotV1): CookingSessionState | null {
  let state = createCookingSession(snapshot.request, snapshot.initialSchedule);
  let cursor = 0;
  while (cursor < snapshot.events.length) {
    const expected = snapshot.events[cursor];
    const before = state.events.length;
    if (expected.type === "TASK_STARTED") {
      state = advanceSessionTime(state, expected.at);
      state = applySessionCommand(state, {
        type: "START", taskId: expected.taskId, at: expected.at,
      });
    } else if (expected.type === "TASK_DELAYED") {
      state = applySessionCommand(state, {
        type: "DELAY", taskId: expected.taskId, at: expected.at,
        delayMinutes: expected.delayMinutes,
      });
    } else if (expected.type === "TASK_COMPLETED") {
      state = applySessionCommand(state, {
        type: "COMPLETE", taskId: expected.taskId, at: expected.at,
      });
    } else {
      state = advanceSessionTime(state, expected.at);
    }
    const produced = state.events.slice(before);
    if (produced.length === 0
      || cursor + produced.length > snapshot.events.length
      || produced.some((event, offset) =>
        !sameEvent(event, snapshot.events[cursor + offset]))) return null;
    cursor += produced.length;
  }
  return state;
}

function warning(
  state: CookingSessionState,
  entry: SessionWarning,
): CookingSessionState {
  if (state.warnings.some((current) => current.code === entry.code)) return state;
  return { ...state, warnings: [...state.warnings, entry] };
}

function reset(seed: SessionSeed, now: string) {
  return warning(
    advanceSessionTime(createCookingSession(seed.request, seed.initialSchedule), now),
    { code: "SNAPSHOT_RECOVERED", message: "会话数据无效，已安全重置。" },
  );
}

export function snapshotSession(state: CookingSessionState): SessionSnapshotV1 {
  return structuredClone({
    version: 1,
    request: state.request,
    initialSchedule: state.initialSchedule,
    events: state.events,
  });
}

export function serializeSession(state: CookingSessionState) {
  return JSON.stringify(snapshotSession(state));
}

export function restoreSession(
  serialized: string | null,
  seed: SessionSeed,
  now: string,
): CookingSessionState {
  if (serialized === null) {
    return advanceSessionTime(createCookingSession(seed.request, seed.initialSchedule), now);
  }
  const snapshot = parseSnapshot(serialized);
  if (!snapshot) return reset(seed, now);
  let restored: CookingSessionState | null;
  try {
    restored = replay(snapshot);
  } catch {
    restored = null;
  }
  return restored ? advanceSessionTime(restored, now) : reset(seed, now);
}

export function createSessionPersistence(
  key: string,
  getStorage: () => SessionStorageLike | null = () => globalThis.localStorage,
): SessionPersistence {
  let memory: string | null = null;
  let unavailable = false;
  const storageWarning: SessionWarning = {
    code: "STORAGE_UNAVAILABLE",
    message: "浏览器存储不可用，本次会话已降级为内存保存。",
  };
  const accessStorage = () => {
    if (unavailable) return null;
    try {
      const storage = getStorage();
      if (!storage || typeof storage.getItem !== "function"
        || typeof storage.setItem !== "function") {
        unavailable = true;
        return null;
      }
      return storage;
    } catch {
      unavailable = true;
      return null;
    }
  };
  const withWarning = (state: CookingSessionState) =>
    unavailable ? warning(state, storageWarning) : state;
  return {
    save(state) {
      memory = serializeSession(state);
      const storage = accessStorage();
      if (storage) {
        try {
          storage.setItem(key, memory);
        } catch {
          unavailable = true;
        }
      }
      return withWarning(state);
    },
    restore(seed, now) {
      let serialized = memory;
      const storage = accessStorage();
      if (storage) {
        try {
          serialized = storage.getItem(key) ?? memory;
        } catch {
          unavailable = true;
        }
      }
      return withWarning(restoreSession(serialized, seed, now));
    },
  };
}
