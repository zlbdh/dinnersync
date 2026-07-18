import type { FoodState, Recipe } from "@/modules/recipe-import";
import { describe, expect, it } from "vitest";

import { calculateNutrition } from "../calculate";
import { indexNutritionCatalog } from "../catalog";
import { findNutritionCandidates } from "../match";
import { resolveWeight } from "../scale";
import type { NutritionRecord } from "../types";

function record(overrides: Partial<NutritionRecord> = {}): NutritionRecord {
  return {
    id: "food-1",
    canonicalName: "Test food",
    foodState: "cooked",
    kcalPer100g: 100,
    sourceUrl: "https://example.test/food-1",
    sourceVersion: "test-v1",
    accessedAt: "2026-07-18",
    ...overrides,
  };
}

function recipe(foodState: FoodState): Recipe {
  return {
    id: "recipe-1",
    name: "Test recipe",
    sourceText: "Test recipe source",
    sourceServings: 1,
    targetServings: 1,
    ingredients: [{
      id: "ingredient-1",
      sourceText: "Test recipe source",
      name: "Test food",
      quantity: 100,
      unit: "g",
      foodState,
      sourceGrams: 100,
      plannedGrams: 100,
      nutritionRefId: "food-1",
      nutritionMatchStatus: "confirmed",
      status: "used",
    }],
    steps: [],
  };
}

describe("nutrition runtime gates", () => {
  it.each([
    ["food state", { foodState: "forged" }],
    ["source URL", { sourceUrl: "ftp://example.test/data" }],
    ["access date", { accessedAt: "2026-02-30" }],
    ["aliases", { aliases: ["valid", " "] }],
  ])("rejects a catalog record with invalid %s", (_name, overrides) => {
    const invalid = record(overrides as Partial<NutritionRecord>);
    expect(indexNutritionCatalog([invalid])).toEqual(new Map());
    expect(findNutritionCandidates("Test food", [invalid])).toEqual([]);
  });

  it("drops every duplicate ID independent of catalog order", () => {
    const first = record({ canonicalName: "Test food" });
    const second = record({ canonicalName: "Second food" });
    for (const catalog of [[first, second], [second, first]]) {
      expect(indexNutritionCatalog(catalog)).toEqual(new Map());
      expect(findNutritionCandidates("Test food", catalog)).toEqual([]);
    }
  });

  it("does not count matching forged food states or untraceable records", () => {
    const forgedState = "forged" as FoodState;
    const summary = calculateNutrition({
      recipes: [recipe(forgedState)],
      catalog: [record({
        foodState: forgedState,
        sourceUrl: "not-a-url",
        accessedAt: "not-a-date",
      })],
      diners: 1,
      targetKcalPerPerson: 100,
    });
    expect(summary).toMatchObject({
      completeness: "partial",
      knownMealKcal: 0,
      estimatedMealKcal: null,
      targetDeltaPerPerson: null,
      unresolvedIngredientIds: ["ingredient-1"],
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1])(
    "rejects invalid per-person targets: %s",
    (targetKcalPerPerson) => {
      expect(() => calculateNutrition({
        recipes: [recipe("cooked")],
        catalog: [record()],
        diners: 1,
        targetKcalPerPerson,
      })).toThrow(RangeError);
    },
  );

  it("fails closed when weight arithmetic overflows", () => {
    expect(resolveWeight({
      quantity: Number.MAX_VALUE,
      unit: "g",
      sourceServings: 1,
      targetServings: 2,
    })).toMatchObject({
      resolved: false,
      sourceGrams: null,
      plannedGrams: null,
      reason: "weight-overflow",
    });
  });
});
