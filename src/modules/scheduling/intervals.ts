import { isResourceId } from "@/shared";
import type { ResourceId } from "@/shared";

export type ResourceReservation = {
  taskId: string;
  startMs: number;
  endMs: number;
  resourceIds: ResourceId[];
};

export type ResourceSlotSearch = {
  taskId: string;
  notBeforeMs: number;
  notAfterMs: number;
  durationMs: number;
  stepMs: number;
  resourceIds: ResourceId[];
};

export type ResourceSlot = { startMs: number; endMs: number };

const RESOURCE_ORDER: readonly ResourceId[] = [
  "cook:1",
  "oven:1",
  "burner:1",
  "burner:2",
];

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalize(
  value: ResourceReservation,
): ResourceReservation | null {
  if (typeof value !== "object" || value === null
    || typeof value.taskId !== "string" || value.taskId.trim() === ""
    || !Number.isSafeInteger(value.startMs)
    || !Number.isSafeInteger(value.endMs)
    || value.endMs <= value.startMs
    || !Array.isArray(value.resourceIds)
    || value.resourceIds.length === 0
    || !value.resourceIds.every(isResourceId)) return null;
  const selected = new Set(value.resourceIds);
  return {
    taskId: value.taskId,
    startMs: value.startMs,
    endMs: value.endMs,
    resourceIds: RESOURCE_ORDER.filter((resourceId) => selected.has(resourceId)),
  };
}

function overlaps(left: ResourceReservation, right: ResourceReservation) {
  return left.startMs < right.endMs && right.startMs < left.endMs;
}

function sharesResource(left: ResourceReservation, right: ResourceReservation) {
  const occupied = new Set(left.resourceIds);
  return right.resourceIds.some((resourceId) => occupied.has(resourceId));
}

function compareReservation(
  left: ResourceReservation,
  right: ResourceReservation,
) {
  return left.startMs - right.startMs
    || left.endMs - right.endMs
    || compareText(left.taskId, right.taskId)
    || compareText(left.resourceIds.join("\0"), right.resourceIds.join("\0"));
}

function conflictSet(
  reservations: readonly ResourceReservation[],
  candidate: ResourceReservation,
) {
  if (!Array.isArray(reservations)) return null;
  const normalizedCandidate = normalize(candidate);
  if (!normalizedCandidate) return null;
  const normalizedReservations: ResourceReservation[] = [];
  for (const reservation of reservations) {
    const normalized = normalize(reservation);
    if (!normalized) return null;
    normalizedReservations.push(normalized);
  }
  return normalizedReservations.filter((reservation) =>
    overlaps(reservation, normalizedCandidate)
    && sharesResource(reservation, normalizedCandidate));
}

export function canReserve(
  reservations: readonly ResourceReservation[],
  candidate: ResourceReservation,
) {
  const conflicts = conflictSet(reservations, candidate);
  return conflicts !== null && conflicts.length === 0;
}

export function reserve(
  reservations: readonly ResourceReservation[],
  candidate: ResourceReservation,
): ResourceReservation[] | null {
  if (!canReserve(reservations, candidate)) return null;
  const normalizedCandidate = normalize(candidate)!;
  return [...reservations.map((entry) => normalize(entry)!), normalizedCandidate]
    .sort(compareReservation);
}

function validSearch(search: ResourceSlotSearch) {
  return typeof search === "object" && search !== null
    && typeof search.taskId === "string" && search.taskId.trim() !== ""
    && Number.isSafeInteger(search.notBeforeMs)
    && Number.isSafeInteger(search.notAfterMs)
    && Number.isSafeInteger(search.durationMs) && search.durationMs > 0
    && Number.isSafeInteger(search.stepMs) && search.stepMs > 0
    && search.notBeforeMs + search.durationMs <= search.notAfterMs
    && Number.isSafeInteger(search.notBeforeMs + search.durationMs)
    && Array.isArray(search.resourceIds)
    && search.resourceIds.length > 0
    && search.resourceIds.every(isResourceId);
}

function alignForward(value: number, origin: number, stepMs: number) {
  return origin + Math.ceil((value - origin) / stepMs) * stepMs;
}

function alignBackward(value: number, origin: number, stepMs: number) {
  return origin - Math.ceil((origin - value) / stepMs) * stepMs;
}

export function findEarliestResourceSlot(
  reservations: readonly ResourceReservation[],
  search: ResourceSlotSearch,
): ResourceSlot | null {
  if (!validSearch(search)) return null;
  let startMs = search.notBeforeMs;
  for (let attempt = 0; attempt <= reservations.length; attempt += 1) {
    const endMs = startMs + search.durationMs;
    if (!Number.isSafeInteger(endMs) || endMs > search.notAfterMs) return null;
    const conflicts = conflictSet(reservations, {
      taskId: search.taskId,
      startMs,
      endMs,
      resourceIds: search.resourceIds,
    });
    if (conflicts === null) return null;
    if (conflicts.length === 0) return { startMs, endMs };
    const boundary = Math.max(...conflicts.map((entry) => entry.endMs));
    const next = alignForward(boundary, search.notBeforeMs, search.stepMs);
    if (!Number.isSafeInteger(next) || next <= startMs) return null;
    startMs = next;
  }
  return null;
}

export function findLatestResourceSlot(
  reservations: readonly ResourceReservation[],
  search: ResourceSlotSearch,
): ResourceSlot | null {
  if (!validSearch(search)) return null;
  let endMs = search.notAfterMs;
  for (let attempt = 0; attempt <= reservations.length; attempt += 1) {
    const startMs = endMs - search.durationMs;
    if (!Number.isSafeInteger(startMs) || startMs < search.notBeforeMs) return null;
    const conflicts = conflictSet(reservations, {
      taskId: search.taskId,
      startMs,
      endMs,
      resourceIds: search.resourceIds,
    });
    if (conflicts === null) return null;
    if (conflicts.length === 0) return { startMs, endMs };
    const boundary = Math.min(...conflicts.map((entry) => entry.startMs));
    const next = alignBackward(boundary, search.notAfterMs, search.stepMs);
    if (!Number.isSafeInteger(next) || next >= endMs) return null;
    endMs = next;
  }
  return null;
}
