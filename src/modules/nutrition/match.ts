import type { FoodState } from "@/modules/recipe-import";

import { indexNutritionCatalog } from "./catalog";
import type {
  NutritionCandidate,
  NutritionMatchKind,
  NutritionRecord,
} from "./types";

const MATCH_RANK: Record<NutritionMatchKind, number> = {
  "canonical-exact": 0,
  "alias-exact": 1,
  normalized: 2,
};

function stableTextCompare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeName(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function classifyMatch(
  name: string,
  normalizedName: string,
  record: NutritionRecord,
): NutritionMatchKind | null {
  if (record.canonicalName === name) return "canonical-exact";
  if ((record.aliases ?? []).includes(name)) return "alias-exact";
  const names = [record.canonicalName, ...(record.aliases ?? [])];
  return names.some((candidate) => normalizeName(candidate) === normalizedName)
    ? "normalized"
    : null;
}

export function findNutritionCandidates(
  name: string,
  catalog: readonly NutritionRecord[],
  foodState?: FoodState,
): NutritionCandidate[] {
  const normalizedName = normalizeName(name);
  if (normalizedName === "") return [];

  const candidates = new Map<string, NutritionCandidate>();
  for (const record of indexNutritionCatalog(catalog).values()) {
    if (foodState !== undefined && record.foodState !== foodState) continue;
    const matchKind = classifyMatch(name, normalizedName, record);
    if (!matchKind) continue;
    const existing = candidates.get(record.id);
    if (!existing || MATCH_RANK[matchKind] < MATCH_RANK[existing.matchKind]) {
      candidates.set(record.id, { record, matchKind });
    }
  }

  return [...candidates.values()].sort((left, right) =>
    MATCH_RANK[left.matchKind] - MATCH_RANK[right.matchKind]
    || stableTextCompare(left.record.id, right.record.id));
}
