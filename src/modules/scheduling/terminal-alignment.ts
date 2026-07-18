import type { ResourceId } from "@/shared";

import { findLatestResourceSlot, reserve } from "./intervals";
import type { ResourceReservation } from "./intervals";
import type { ScheduleTask } from "./types";

const MINUTE_MS = 60_000;

export type AlignableTask = {
  task: ScheduleTask;
  startMs: number;
  endMs: number;
  resourceIds: ResourceId[];
};

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stable(entries: readonly AlignableTask[]) {
  return [...entries].sort((left, right) =>
    left.startMs - right.startMs
    || left.endMs - right.endMs
    || compareText(left.task.id, right.task.id));
}

function addReservation(
  reservations: readonly ResourceReservation[],
  entry: AlignableTask,
) {
  if (entry.resourceIds.length === 0) return [...reservations];
  return reserve(reservations, {
    taskId: entry.task.id,
    startMs: entry.startMs,
    endMs: entry.endMs,
    resourceIds: entry.resourceIds,
  });
}

function placementOrder(left: AlignableTask, right: AlignableTask) {
  const leftOven = left.resourceIds.includes("oven:1");
  const rightOven = right.resourceIds.includes("oven:1");
  if (leftOven !== rightOven) return leftOven ? -1 : 1;
  if (leftOven) {
    return right.startMs - left.startMs || compareText(left.task.id, right.task.id);
  }
  return left.task.durationMinutes - right.task.durationMinutes
    || right.startMs - left.startMs
    || compareText(left.task.id, right.task.id);
}

function nextCandidate(
  currentMs: number,
  dependencyEndMs: number,
  entry: AlignableTask,
  baseReservations: readonly ResourceReservation[],
  placed: readonly AlignableTask[],
) {
  const durationMs = entry.task.durationMinutes * MINUTE_MS;
  const tailMs = Math.max(
    0,
    ...entry.resourceIds.map((resourceId) => placed
      .filter((terminal) => terminal.resourceIds.includes(resourceId))
      .reduce(
        (sum, terminal) => sum + terminal.task.durationMinutes * MINUTE_MS,
        0,
      )),
  );
  const boundaries = [
    dependencyEndMs,
    ...baseReservations
      .filter((reservation) => reservation.resourceIds
        .some((resourceId) => entry.resourceIds.includes(resourceId)))
      .map((reservation) => reservation.endMs),
  ];
  const candidates = boundaries
    .map((boundary) => boundary + durationMs + tailMs)
    .filter((candidate) => Number.isSafeInteger(candidate) && candidate > currentMs);
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

export function alignTerminalWindow(
  entries: readonly AlignableTask[],
  availableMs: number,
  toleranceMinutes: number,
): AlignableTask[] | null {
  const ordered = stable(entries);
  const terminals = ordered.filter((entry) => entry.task.isTerminal);
  const nonTerminals = ordered.filter((entry) => !entry.task.isTerminal);
  const byId = new Map(ordered.map((entry) => [entry.task.id, entry]));
  let baseReservations: ResourceReservation[] = [];
  for (const entry of nonTerminals) {
    const next = addReservation(baseReservations, entry);
    if (!next) return null;
    baseReservations = next;
  }
  let candidateServeMs = Math.max(...terminals.map((entry) => entry.endMs));
  const maxAttempts = terminals.length + baseReservations.length + 2;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const windowStartMs = candidateServeMs - toleranceMinutes * MINUTE_MS;
    let reservations = [...baseReservations];
    const aligned = [...nonTerminals];
    const placed: AlignableTask[] = [];
    let retryAt: number | null = null;
    for (const original of [...terminals].sort(placementOrder)) {
      const durationMs = original.task.durationMinutes * MINUTE_MS;
      const dependencyEndMs = Math.max(
        availableMs,
        ...original.task.dependsOn.map((id) => byId.get(id)!.endMs),
      );
      const slot = original.resourceIds.length === 0
        ? { startMs: candidateServeMs - durationMs, endMs: candidateServeMs }
        : findLatestResourceSlot(reservations, {
          taskId: original.task.id,
          notBeforeMs: dependencyEndMs,
          notAfterMs: candidateServeMs,
          durationMs,
          stepMs: MINUTE_MS,
          resourceIds: original.resourceIds,
        });
      if (!slot || slot.startMs < dependencyEndMs || slot.endMs < windowStartMs) {
        retryAt = nextCandidate(
          candidateServeMs,
          dependencyEndMs,
          original,
          baseReservations,
          placed,
        );
        break;
      }
      const entry = { ...original, ...slot };
      const next = addReservation(reservations, entry);
      if (!next) return null;
      reservations = next;
      placed.push(entry);
      aligned.push(entry);
    }
    if (retryAt === null && aligned.length === ordered.length) return stable(aligned);
    if (retryAt === null) return null;
    candidateServeMs = retryAt;
  }
  return null;
}
