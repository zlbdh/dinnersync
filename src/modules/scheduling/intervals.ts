import { isResourceId } from "@/shared";
import type { ResourceId } from "@/shared";

export type ResourceReservation = {
  taskId: string;
  startMs: number;
  endMs: number;
  resourceIds: ResourceId[];
};

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

export function canReserve(
  reservations: readonly ResourceReservation[],
  candidate: ResourceReservation,
) {
  if (!Array.isArray(reservations)) return false;
  const normalizedCandidate = normalize(candidate);
  if (!normalizedCandidate) return false;
  for (const current of reservations) {
    const normalizedCurrent = normalize(current);
    if (!normalizedCurrent) return false;
    if (overlaps(normalizedCurrent, normalizedCandidate)
      && sharesResource(normalizedCurrent, normalizedCandidate)) return false;
  }
  return true;
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
