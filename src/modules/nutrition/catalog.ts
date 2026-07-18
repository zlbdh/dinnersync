import type { NutritionRecord } from "./types";

const FOOD_STATES = new Set(["raw", "cooked", "other"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isHttpUrl(value: unknown) {
  if (!isNonBlank(value)) return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function isIsoDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function isValidConversion(value: unknown) {
  if (!isObject(value)) return false;
  return isNonBlank(value.unit)
    && typeof value.gramsPerUnit === "number"
    && Number.isFinite(value.gramsPerUnit)
    && value.gramsPerUnit > 0
    && isNonBlank(value.source);
}

function isReliableRecord(value: unknown): value is NutritionRecord {
  if (!isObject(value)) return false;
  const record = value;
  return isNonBlank(record.id)
    && isNonBlank(record.canonicalName)
    && FOOD_STATES.has(record.foodState as string)
    && typeof record.kcalPer100g === "number"
    && Number.isFinite(record.kcalPer100g)
    && record.kcalPer100g >= 0
    && isHttpUrl(record.sourceUrl)
    && isNonBlank(record.sourceVersion)
    && isIsoDate(record.accessedAt)
    && (record.aliases === undefined
      || (Array.isArray(record.aliases) && record.aliases.every(isNonBlank)))
    && (record.unitConversions === undefined
      || (Array.isArray(record.unitConversions)
        && record.unitConversions.every(isValidConversion)));
}

export function indexNutritionCatalog(catalog: readonly NutritionRecord[]) {
  const counts = new Map<string, number>();
  for (const value of catalog as readonly unknown[]) {
    if (!isObject(value) || typeof value.id !== "string") continue;
    counts.set(value.id, (counts.get(value.id) ?? 0) + 1);
  }

  const index = new Map<string, NutritionRecord>();
  for (const value of catalog as readonly unknown[]) {
    if (isReliableRecord(value) && counts.get(value.id) === 1) {
      index.set(value.id, value);
    }
  }
  return index;
}
