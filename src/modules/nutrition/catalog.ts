import type { NutritionRecord } from "./types";

function isNonBlank(value: string) {
  return value.trim() !== "";
}

function isReliableRecord(record: NutritionRecord) {
  return isNonBlank(record.id)
    && isNonBlank(record.canonicalName)
    && Number.isFinite(record.kcalPer100g)
    && record.kcalPer100g >= 0
    && isNonBlank(record.sourceUrl)
    && isNonBlank(record.sourceVersion)
    && isNonBlank(record.accessedAt);
}

export function indexNutritionCatalog(catalog: readonly NutritionRecord[]) {
  const counts = new Map<string, number>();
  for (const record of catalog) {
    counts.set(record.id, (counts.get(record.id) ?? 0) + 1);
  }

  const index = new Map<string, NutritionRecord>();
  for (const record of catalog) {
    if (counts.get(record.id) === 1 && isReliableRecord(record)) {
      index.set(record.id, record);
    }
  }
  return index;
}
