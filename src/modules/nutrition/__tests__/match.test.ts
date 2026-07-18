import { describe, expect, it } from "vitest";

import type { NutritionRecord } from "../types";
import { findNutritionCandidates } from "../match";

function record(
  id: string,
  canonicalName: string,
  aliases: readonly string[] = [],
  foodState: NutritionRecord["foodState"] = "cooked",
): NutritionRecord {
  return {
    id,
    canonicalName,
    aliases,
    foodState,
    kcalPer100g: 100,
    sourceUrl: `https://example.test/${id}`,
    sourceVersion: "test-v1",
    accessedAt: "2026-07-18",
  };
}

describe("findNutritionCandidates", () => {
  it("ranks canonical exact, alias exact, then normalized matches", () => {
    const catalog = [
      record("canonical-z", "Chicken Breast"),
      record("normalized-a", "chicken-breast"),
      record("alias-z", "Poultry Fillet", ["Chicken Breast"]),
      record("canonical-a", "Chicken Breast"),
    ];

    expect(findNutritionCandidates("Chicken Breast", catalog).map((candidate) => ({
      id: candidate.record.id,
      kind: candidate.matchKind,
    }))).toEqual([
      { id: "canonical-a", kind: "canonical-exact" },
      { id: "canonical-z", kind: "canonical-exact" },
      { id: "alias-z", kind: "alias-exact" },
      { id: "normalized-a", kind: "normalized" },
    ]);
  });

  it("normalizes case, Unicode width, punctuation, and whitespace", () => {
    const catalog = [record("chicken", "Chicken Breast")];

    expect(findNutritionCandidates("  ＣＨＩＣＫＥＮ—breast  ", catalog)).toMatchObject([
      { record: { id: "chicken" }, matchKind: "normalized" },
    ]);
  });

  it("does not use fuzzy or substring matching", () => {
    expect(findNutritionCandidates("chicken", [
      record("chicken-breast", "Chicken Breast"),
    ])).toEqual([]);
  });

  it("filters candidates by an explicitly known food state", () => {
    const catalog = [
      record("raw", "Chicken Breast", [], "raw"),
      record("cooked", "Chicken Breast", [], "cooked"),
    ];

    expect(findNutritionCandidates("Chicken Breast", catalog, "cooked")
      .map((candidate) => candidate.record.id)).toEqual(["cooked"]);
  });

  it("deduplicates a record using its strongest match", () => {
    const catalog = [record("same", "Chicken Breast", ["Chicken Breast"])];

    expect(findNutritionCandidates("Chicken Breast", catalog)).toMatchObject([
      { record: { id: "same" }, matchKind: "canonical-exact" },
    ]);
  });

  it("does not mutate catalog records while proposing candidates", () => {
    const catalog = [record("chicken", "Chicken Breast")];
    const before = structuredClone(catalog);

    findNutritionCandidates("Chicken Breast", catalog);

    expect(catalog).toEqual(before);
  });

  it("returns no candidate for an empty name", () => {
    expect(findNutritionCandidates("   ", [record("chicken", "Chicken Breast")]))
      .toEqual([]);
  });
});
