import { describe, expect, it } from "vitest";

import { resolveWeight } from "../scale";

const servings = { sourceServings: 2, targetServings: 4 } as const;

describe("resolveWeight", () => {
  it.each([
    [500, "g", 500, 1_000],
    [0.5, "kg", 500, 1_000],
  ])(
    "converts %s %s and scales it with the serving ratio",
    (quantity, unit, sourceGrams, plannedGrams) => {
      expect(resolveWeight({ quantity, unit, ...servings })).toMatchObject({
        resolved: true,
        sourceGrams,
        plannedGrams,
        original: { quantity, unit },
        conversionSource: "metric-mass",
      });
    },
  );

  it.each([
    [500, "ml", 515, 1_030],
    [0.5, "L", 515, 1_030],
  ])(
    "uses an explicit density to convert %s %s",
    (quantity, unit, sourceGrams, plannedGrams) => {
      expect(resolveWeight({
        quantity,
        unit,
        ...servings,
        conversions: [{
          unit: "ml",
          gramsPerUnit: 1.03,
          source: "DinnerSync demo density v1",
        }],
      })).toEqual({
        resolved: true,
        sourceGrams,
        plannedGrams,
        original: { quantity, unit },
        conversionSource: "DinnerSync demo density v1",
      });
    },
  );

  it("uses only an explicitly configured demo cup conversion", () => {
    expect(resolveWeight({
      quantity: 1.5,
      unit: "cup",
      sourceServings: 3,
      targetServings: 2,
      conversions: [{
        unit: "cup",
        gramsPerUnit: 160,
        source: "DinnerSync demo measure v1",
      }],
    })).toEqual({
      resolved: true,
      sourceGrams: 240,
      plannedGrams: 160,
      original: { quantity: 1.5, unit: "cup" },
      conversionSource: "DinnerSync demo measure v1",
    });
  });

  it.each(["piece", "pinch", "brand pack"])(
    "does not guess unsupported unit %s",
    (unit) => {
      expect(resolveWeight({ quantity: 1, unit, ...servings })).toEqual({
        resolved: false,
        sourceGrams: null,
        plannedGrams: null,
        reason: "unsupported-unit",
        original: { quantity: 1, unit },
      });
    },
  );

  it("does not assume that a volume unit is equal to grams", () => {
    expect(resolveWeight({ quantity: 250, unit: "ml", ...servings })).toMatchObject({
      resolved: false,
      sourceGrams: null,
      plannedGrams: null,
      reason: "missing-volume-conversion",
    });
  });

  it.each([null, 0, -2])(
    "forces planned grams to null when source servings are %s",
    (sourceServings) => {
      expect(resolveWeight({
        quantity: 100,
        unit: "g",
        sourceServings,
        targetServings: 2,
      })).toMatchObject({
        resolved: false,
        sourceGrams: null,
        plannedGrams: null,
        reason: "invalid-source-servings",
      });
    },
  );

  it("preserves the original input when the quantity cannot be resolved", () => {
    expect(resolveWeight({ quantity: null, unit: null, ...servings })).toEqual({
      resolved: false,
      sourceGrams: null,
      plannedGrams: null,
      reason: "invalid-quantity",
      original: { quantity: null, unit: null },
    });
  });
});
