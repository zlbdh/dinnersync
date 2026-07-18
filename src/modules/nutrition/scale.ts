import type {
  UnitConversion,
  UnresolvedWeight,
  WeightInput,
  WeightResolution,
} from "./types";

const MASS_FACTORS = new Map([
  ["g", 1],
  ["gram", 1],
  ["grams", 1],
  ["kg", 1_000],
  ["kilogram", 1_000],
  ["kilograms", 1_000],
]);

const VOLUME_FACTORS = new Map([
  ["ml", 1],
  ["milliliter", 1],
  ["milliliters", 1],
  ["millilitre", 1],
  ["millilitres", 1],
  ["l", 1_000],
  ["liter", 1_000],
  ["liters", 1_000],
  ["litre", 1_000],
  ["litres", 1_000],
]);

function normalizeUnit(unit: string) {
  return unit.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function roundWeight(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function unresolved(
  input: WeightInput,
  reason: UnresolvedWeight["reason"],
): UnresolvedWeight {
  return {
    resolved: false,
    sourceGrams: null,
    plannedGrams: null,
    reason,
    original: { quantity: input.quantity, unit: input.unit },
  };
}

function validConversions(conversions: readonly UnitConversion[]) {
  return conversions
    .filter((entry) => Number.isFinite(entry.gramsPerUnit) && entry.gramsPerUnit > 0)
    .filter((entry) => entry.source.trim() !== "")
    .toSorted((left, right) => {
      const sourceOrder = left.source < right.source
        ? -1
        : left.source > right.source ? 1 : 0;
      return sourceOrder || left.gramsPerUnit - right.gramsPerUnit;
    });
}

function findConversion(
  conversions: readonly UnitConversion[],
  normalizedUnit: string,
) {
  return validConversions(conversions).find(
    (entry) => normalizeUnit(entry.unit) === normalizedUnit,
  );
}

export function resolveWeight(input: WeightInput): WeightResolution {
  const original = { quantity: input.quantity, unit: input.unit };
  if (!Number.isFinite(input.sourceServings) || (input.sourceServings ?? 0) <= 0) {
    return unresolved(input, "invalid-source-servings");
  }
  if (!Number.isFinite(input.targetServings) || input.targetServings <= 0) {
    return unresolved(input, "invalid-target-servings");
  }
  if (!Number.isFinite(input.quantity) || (input.quantity ?? 0) <= 0) {
    return unresolved(input, "invalid-quantity");
  }
  if (typeof input.unit !== "string" || input.unit.trim() === "") {
    return unresolved(input, "invalid-unit");
  }

  const unit = normalizeUnit(input.unit);
  const massFactor = MASS_FACTORS.get(unit);
  let gramsPerInputUnit = massFactor;
  let conversionSource = "metric-mass";

  const volumeFactor = VOLUME_FACTORS.get(unit);
  if (volumeFactor !== undefined) {
    const density = findConversion(input.conversions ?? [], "ml");
    if (!density) return unresolved(input, "missing-volume-conversion");
    gramsPerInputUnit = density.gramsPerUnit * volumeFactor;
    conversionSource = density.source;
  } else if (gramsPerInputUnit === undefined) {
    const conversion = findConversion(input.conversions ?? [], unit);
    if (!conversion) return unresolved(input, "unsupported-unit");
    gramsPerInputUnit = conversion.gramsPerUnit;
    conversionSource = conversion.source;
  }

  const sourceGrams = roundWeight((input.quantity as number) * gramsPerInputUnit);
  const plannedGrams = roundWeight(
    sourceGrams * input.targetServings / (input.sourceServings as number),
  );
  return { resolved: true, sourceGrams, plannedGrams, original, conversionSource };
}
