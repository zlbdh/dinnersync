import { fromEpochMs, parseIsoInstant, toEpochMs, type IsoInstant } from "@/shared";

export type PlanningMode = "hosted" | "local";

export type PlanningContextSnapshotV1 = {
  version: 1;
  revision: string;
  mode: PlanningMode;
  virtualAt: IsoInstant;
  wallClockMs: number;
};

const REVISION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isExactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

export function parsePlanningContext(
  serialized: string | null,
  expectedRevision: string | null,
): PlanningContextSnapshotV1 | null {
  if (serialized === null || expectedRevision === null
    || !REVISION_PATTERN.test(expectedRevision)
    || serialized.length > 2_048) return null;
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isExactRecord(value, ["version", "revision", "mode", "virtualAt", "wallClockMs"])
      || value.version !== 1
      || value.revision !== expectedRevision
      || typeof value.revision !== "string"
      || !REVISION_PATTERN.test(value.revision)
      || (value.mode !== "hosted" && value.mode !== "local")
      || !parseIsoInstant(value.virtualAt).ok
      || !Number.isSafeInteger(value.wallClockMs)
      || Number(value.wallClockMs) < 0) return null;
    return value as PlanningContextSnapshotV1;
  } catch {
    return null;
  }
}

export function projectPlanningInstant(
  snapshot: Pick<PlanningContextSnapshotV1, "virtualAt" | "wallClockMs">,
  wallClockMs: number,
): IsoInstant {
  if (!Number.isSafeInteger(wallClockMs)) return snapshot.virtualAt;
  const elapsed = Math.max(0, wallClockMs - snapshot.wallClockMs);
  const projected = toEpochMs(snapshot.virtualAt) + elapsed;
  if (!Number.isSafeInteger(projected)) return snapshot.virtualAt;
  try {
    return fromEpochMs(projected);
  } catch {
    return snapshot.virtualAt;
  }
}

export function serializePlanningContext(
  mode: PlanningMode,
  virtualAt: IsoInstant,
  wallClockMs: number,
  revision: string,
) {
  if (!REVISION_PATTERN.test(revision)) {
    throw new Error("Planning context revision must be a UUID v4.");
  }
  return JSON.stringify({ version: 1, revision, mode, virtualAt, wallClockMs });
}
