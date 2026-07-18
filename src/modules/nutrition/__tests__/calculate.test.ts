import type { FoodState, Ingredient, Recipe } from "@/modules/recipe-import";
import { describe, expect, it } from "vitest";

import { calculateNutrition } from "../calculate";
import type { NutritionRecord } from "../types";

function nutritionRecord(
  id: string,
  kcalPer100g: number,
  foodState: FoodState = "cooked",
): NutritionRecord {
  return {
    id,
    canonicalName: id,
    foodState,
    kcalPer100g,
    sourceUrl: `https://example.test/${id}`,
    sourceVersion: "test-v1",
    accessedAt: "2026-07-18",
  };
}

function ingredient(
  id: string,
  overrides: Partial<Ingredient> = {},
): Ingredient {
  return {
    id,
    sourceText: `${id} source`,
    name: id,
    quantity: 100,
    unit: "g",
    foodState: "cooked",
    sourceGrams: 100,
    plannedGrams: 100,
    nutritionRefId: id,
    nutritionMatchStatus: "confirmed",
    status: "used",
    ...overrides,
  };
}

function recipe(
  id: string,
  ingredients: Ingredient[],
  overrides: Partial<Recipe> = {},
): Recipe {
  return {
    id,
    name: id,
    sourceText: `${id} source`,
    sourceServings: 2,
    targetServings: 2,
    ingredients,
    steps: [],
    ...overrides,
  };
}

describe("calculateNutrition", () => {
  it("calculates recipe, meal, per-person, and target totals when complete", () => {
    const chicken = recipe("chicken-dish", [ingredient("chicken", {
      sourceGrams: 100,
      plannedGrams: 200,
    })], { targetServings: 4 });
    const rice = recipe("rice-dish", [ingredient("rice", {
      sourceGrams: 150,
      plannedGrams: 150,
    })]);

    expect(calculateNutrition({
      recipes: [chicken, rice],
      catalog: [nutritionRecord("chicken", 200), nutritionRecord("rice", 130)],
      diners: 2,
      targetKcalPerPerson: 300,
    })).toEqual({
      completeness: "complete",
      knownMealKcal: 595,
      knownKcalPerPerson: 297.5,
      estimatedMealKcal: 595,
      estimatedKcalPerPerson: 297.5,
      targetDeltaPerPerson: -2.5,
      unresolvedIngredientIds: [],
      recipeSummaries: [
        {
          recipeId: "chicken-dish",
          completeness: "complete",
          knownKcal: 400,
          estimatedKcal: 400,
          unresolvedIngredientIds: [],
        },
        {
          recipeId: "rice-dish",
          completeness: "complete",
          knownKcal: 195,
          estimatedKcal: 195,
          unresolvedIngredientIds: [],
        },
      ],
    });
  });

  it("returns only a known subtotal when any used ingredient is unresolved", () => {
    const meal = recipe("meal", [
      ingredient("known"),
      ingredient("unknown", {
        nutritionRefId: null,
        nutritionMatchStatus: "unresolved",
      }),
    ]);

    expect(calculateNutrition({
      recipes: [meal],
      catalog: [nutritionRecord("known", 200)],
      diners: 2,
      targetKcalPerPerson: 150,
    })).toMatchObject({
      completeness: "partial",
      knownMealKcal: 200,
      knownKcalPerPerson: 100,
      estimatedMealKcal: null,
      estimatedKcalPerPerson: null,
      targetDeltaPerPerson: null,
      unresolvedIngredientIds: ["unknown"],
      recipeSummaries: [{
        recipeId: "meal",
        completeness: "partial",
        knownKcal: 200,
        estimatedKcal: null,
        unresolvedIngredientIds: ["unknown"],
      }],
    });
  });

  it.each([null, 0, -2])(
    "rejects stale planned grams when source servings are %s",
    (sourceServings) => {
      const stale = ingredient("stale", { sourceGrams: 100, plannedGrams: 999 });
      const input = recipe("invalid-servings", [stale], { sourceServings });

      expect(calculateNutrition({
        recipes: [input],
        catalog: [nutritionRecord("stale", 250)],
        diners: 2,
        targetKcalPerPerson: 300,
      })).toMatchObject({
        completeness: "partial",
        knownMealKcal: 0,
        estimatedMealKcal: null,
        targetDeltaPerPerson: null,
        unresolvedIngredientIds: ["stale"],
      });
      expect(stale.plannedGrams).toBe(999);
    },
  );

  it("rejects a planned weight that does not match the serving formula", () => {
    const stale = recipe("stale-recipe", [ingredient("stale", {
      sourceGrams: 100,
      plannedGrams: 180,
    })], { sourceServings: 2, targetServings: 4 });

    expect(calculateNutrition({
      recipes: [stale],
      catalog: [nutritionRecord("stale", 200)],
      diners: 4,
      targetKcalPerPerson: null,
    })).toMatchObject({
      completeness: "partial",
      knownMealKcal: 0,
      unresolvedIngredientIds: ["stale"],
    });
  });

  it.each([
    ["unconfirmed match", { nutritionMatchStatus: "unresolved" as const }],
    ["missing reference", { nutritionRefId: null }],
    ["food-state mismatch", { foodState: "raw" as const }],
    ["missing weight", { plannedGrams: null }],
  ])("keeps %s behind the confirmation gate", (_label, overrides) => {
    const gated = recipe("gated", [ingredient("gated-item", overrides)]);

    expect(calculateNutrition({
      recipes: [gated],
      catalog: [nutritionRecord("gated-item", 100)],
      diners: 2,
      targetKcalPerPerson: 100,
    })).toMatchObject({
      completeness: "partial",
      knownMealKcal: 0,
      targetDeltaPerPerson: null,
      unresolvedIngredientIds: ["gated-item"],
    });
  });

  it("does not count or report explicitly omitted ingredients", () => {
    const meal = recipe("meal", [
      ingredient("used"),
      ingredient("omitted", {
        status: "omitted",
        sourceGrams: null,
        plannedGrams: null,
        nutritionRefId: null,
        nutritionMatchStatus: "unresolved",
      }),
    ]);

    expect(calculateNutrition({
      recipes: [meal],
      catalog: [nutritionRecord("used", 123)],
      diners: 1,
      targetKcalPerPerson: 123,
    })).toMatchObject({
      completeness: "complete",
      knownMealKcal: 123,
      estimatedMealKcal: 123,
      targetDeltaPerPerson: 0,
      unresolvedIngredientIds: [],
    });
  });

  it("does not count an unknown runtime ingredient status as used", () => {
    const forged = recipe("forged", [ingredient("forged-item", {
      status: "ignored" as Ingredient["status"],
    })]);

    expect(calculateNutrition({
      recipes: [forged],
      catalog: [nutritionRecord("forged-item", 100)],
      diners: 1,
      targetKcalPerPerson: 100,
    })).toMatchObject({
      completeness: "partial",
      knownMealKcal: 0,
      estimatedMealKcal: null,
      targetDeltaPerPerson: null,
      unresolvedIngredientIds: ["forged-item"],
    });
  });

  it("sums unrounded ingredient values before stable two-decimal rounding", () => {
    const recipes = ["a", "b"].map((id) => recipe(id, [ingredient(id, {
      sourceGrams: 1,
      plannedGrams: 1,
    })]));

    expect(calculateNutrition({
      recipes,
      catalog: [nutritionRecord("a", 333.333), nutritionRecord("b", 333.333)],
      diners: 3,
      targetKcalPerPerson: 2,
    })).toMatchObject({
      knownMealKcal: 6.67,
      knownKcalPerPerson: 2.22,
      estimatedMealKcal: 6.67,
      estimatedKcalPerPerson: 2.22,
      targetDeltaPerPerson: 0.22,
      recipeSummaries: [
        { recipeId: "a", knownKcal: 3.33 },
        { recipeId: "b", knownKcal: 3.33 },
      ],
    });
  });
});
