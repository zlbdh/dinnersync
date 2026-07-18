import type { Result } from "./result";

export type IsoInstant = string;

export type IsoInstantParseError = {
  code: "INVALID_ISO_INSTANT";
  message: string;
};

type InstantParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  offsetMinutes: number;
};

const ISO_INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;

function parseParts(input: string): InstantParts | undefined {
  const match = ISO_INSTANT_PATTERN.exec(input);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = Number((match[7] ?? "0").padEnd(3, "0"));
  const offsetHour = match[8] === "Z" ? 0 : Number(match[10]);
  const offsetMinute = match[8] === "Z" ? 0 : Number(match[11]);

  if (
    month < 1 || month > 12 ||
    hour > 23 || minute > 59 || second > 59 ||
    offsetHour > 23 || offsetMinute > 59
  ) {
    return undefined;
  }

  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, millisecond);
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== hour ||
    local.getUTCMinutes() !== minute ||
    local.getUTCSeconds() !== second ||
    local.getUTCMilliseconds() !== millisecond
  ) {
    return undefined;
  }

  const offsetSign = match[9] === "-" ? -1 : 1;
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    millisecond,
    offsetMinutes: offsetSign * (offsetHour * 60 + offsetMinute),
  };
}

function partsToEpochMs(parts: InstantParts): number {
  const local = new Date(0);
  local.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  local.setUTCHours(
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
  return local.getTime() - parts.offsetMinutes * 60_000;
}

export function parseIsoInstant(
  input: unknown,
): Result<IsoInstant, IsoInstantParseError> {
  if (typeof input === "string" && parseParts(input)) {
    return { ok: true, value: input };
  }

  return {
    ok: false,
    error: {
      code: "INVALID_ISO_INSTANT",
      message: "The value is not a strict ISO 8601 instant.",
    },
  };
}

export function toEpochMs(instant: IsoInstant): number {
  const parts = typeof instant === "string" ? parseParts(instant) : undefined;
  if (!parts) {
    throw new TypeError("instant must be a parsed ISO 8601 instant");
  }
  return partsToEpochMs(parts);
}

export function fromEpochMs(epochMs: number): IsoInstant {
  if (typeof epochMs !== "number" || !Number.isFinite(epochMs)) {
    throw new TypeError("epochMs must be a finite number");
  }
  if (!Number.isSafeInteger(epochMs)) {
    throw new RangeError("epochMs must be a safe integer");
  }

  const instant = new Date(epochMs);
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError("epochMs is outside the supported Date range");
  }
  return instant.toISOString();
}

export function addMinutes(
  instant: IsoInstant,
  minutes: number,
): IsoInstant {
  if (typeof minutes !== "number" || !Number.isFinite(minutes)) {
    throw new TypeError("minutes must be a finite number");
  }
  if (!Number.isSafeInteger(minutes)) {
    throw new RangeError("minutes must be a safe integer");
  }

  const deltaMs = minutes * 60_000;
  if (!Number.isSafeInteger(deltaMs)) {
    throw new RangeError("minutes are outside the supported range");
  }
  return fromEpochMs(toEpochMs(instant) + deltaMs);
}
