"use client";

import { useId, useMemo, useState } from "react";

import {
  findNutritionCandidates,
  resolveWeight,
  type NutritionRecord,
  type WeightResolution,
} from "@/modules/nutrition";
import type {
  IngredientDraft,
  IngredientReviewDecision,
  RecipeReviewAction,
} from "@/modules/recipe-import";

import { Button } from "./ui/button";

export type NutritionMatchProps = {
  contextLabel: string;
  ingredient: IngredientDraft;
  decision: IngredientReviewDecision;
  sourceServings: number | null;
  targetServings: number;
  catalog: readonly NutritionRecord[];
  onConfirm: (action: Extract<RecipeReviewAction, { type: "confirm-nutrition" }>) => void;
};

function unresolvedReason(resolution: WeightResolution | null) {
  if (!resolution || resolution.resolved) return null;
  return resolution.reason.replaceAll("-", " ");
}

export function NutritionMatch({
  contextLabel,
  ingredient,
  decision,
  sourceServings,
  targetServings,
  catalog,
  onConfirm,
}: NutritionMatchProps) {
  const radioGroupName = `${useId()}-nutrition`;
  const candidates = useMemo(() => findNutritionCandidates(
    ingredient.name.value,
    catalog,
    ingredient.foodState.value ?? undefined,
  ), [catalog, ingredient.foodState.value, ingredient.name.value]);
  const decisionKey = decision.nutritionMatchStatus === "confirmed"
    ? `confirmed:${decision.nutritionRefId}`
    : "unresolved";
  const [selection, setSelection] = useState(() => ({
    decisionKey,
    id: decision.nutritionRefId ?? "",
  }));
  const selectedId = selection.decisionKey === decisionKey
    ? selection.id
    : decision.nutritionRefId ?? "";
  const selected = candidates.find((candidate) => candidate.record.id === selectedId);
  const resolution = selected ? resolveWeight({
    quantity: ingredient.quantity.value,
    unit: ingredient.unit.value,
    sourceServings,
    targetServings,
    conversions: selected.record.unitConversions,
  }) : null;
  const foodReady = ingredient.foodState.status === "confirmed"
    && ingredient.foodState.value !== null;
  const canConfirm = decision.status === "used" && foodReady
    && selected !== undefined && resolution?.resolved === true;

  const confirm = () => {
    if (!canConfirm || !selected || !resolution?.resolved) return;
    setSelection({ decisionKey: `submitted:${selected.record.id}`, id: selected.record.id });
    onConfirm({
      type: "confirm-nutrition",
      ingredientId: ingredient.id,
      nutritionRefId: selected.record.id,
      sourceGrams: resolution.sourceGrams,
      plannedGrams: resolution.plannedGrams,
    });
  };

  return (
    <fieldset className="nutrition-match">
      <legend>Nutrition record · explicit confirmation</legend>
      {candidates.length === 0 ? (
        <p className="nutrition-match__empty">No nutrition record candidate matches this name and food state.</p>
      ) : (
        <div className="nutrition-match__candidates">
          {candidates.map(({ record, matchKind }) => (
            <article className="nutrition-candidate" key={record.id}>
              <label>
                <input
                  type="radio"
                  name={radioGroupName}
                  aria-label={`${record.canonicalName} · ${record.foodState} · ${record.sourceVersion} for ${contextLabel}`}
                  value={record.id}
                  checked={selectedId === record.id}
                  onChange={() => setSelection({ decisionKey, id: record.id })}
                />
                <strong>{record.canonicalName}</strong> · {record.foodState}
              </label>
              <p>Food state: {record.foodState} · {record.kcalPer100g} kcal / 100 g · {matchKind}</p>
              <p>{record.sourceVersion} · Accessed {record.accessedAt}</p>
              <a aria-label={`Open nutrition source: ${record.canonicalName} · ${record.foodState} · ${record.sourceVersion} for ${contextLabel}`} href={record.sourceUrl} target="_blank" rel="noreferrer">Open nutrition source</a>
            </article>
          ))}
        </div>
      )}

      {decision.status !== "used" && (
        <p className="nutrition-match__gate">Set this ingredient to Use before confirming nutrition.</p>
      )}
      {decision.status === "used" && !foodReady && (
        <p className="nutrition-match__gate">Confirm the food state first; a food-state mismatch changes the record.</p>
      )}
      {selected && resolution && !resolution.resolved && (
        <p className="nutrition-match__gate">
          Weight cannot be resolved ({unresolvedReason(resolution)}). Keep this used ingredient unresolved or enter a supported amount.
        </p>
      )}
      {decision.status === "used" && decision.nutritionMatchStatus === "unresolved" && (
        <p className="nutrition-match__subtotal">
          This ingredient remains unresolved; totals will show only the known calorie subtotal.
        </p>
      )}
      {resolution?.resolved && (
        <p className="nutrition-match__weight">
          {resolution.sourceGrams} g source · {resolution.plannedGrams} g planned · Conversion: {resolution.conversionSource}
        </p>
      )}
      {decision.nutritionMatchStatus === "confirmed" && (
        <p className="nutrition-match__confirmed">Confirmed nutrition record: {decision.nutritionRefId}</p>
      )}
      <Button aria-label={`Confirm nutrition match for ${contextLabel}`} variant="secondary" disabled={!canConfirm} onClick={confirm}>
        Confirm nutrition match
      </Button>
    </fieldset>
  );
}
