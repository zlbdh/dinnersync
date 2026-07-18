"use client";

import { useId, useState } from "react";

import type { NutritionRecord } from "@/modules/nutrition";
import type {
  IngredientDraft,
  IngredientReviewDecision,
  RecipeReviewAction,
  RecipeReviewState,
  ReviewFieldTarget,
  ReviewValue,
} from "@/modules/recipe-import";

import { NutritionMatch } from "./nutrition-match";
import { ReviewField, type ReviewFieldKind } from "./review-field";

type BoundFieldProps = {
  label: string;
  kind: ReviewFieldKind;
  contextLabel: string;
  sourceText: string;
  review: ReviewValue<unknown>;
  target: ReviewFieldTarget;
  displayValue?: string;
  emit: (action: RecipeReviewAction) => void;
};

function BoundField(props: BoundFieldProps) {
  return (
    <ReviewField
      label={props.label}
      kind={props.kind}
      contextLabel={props.contextLabel}
      sourceText={props.sourceText}
      review={props.review}
      displayValue={props.displayValue}
      onConfirm={() => props.emit({ type: "confirm-field", target: props.target })}
      onEdit={(value, reason) => props.emit({
        type: "edit-field",
        target: props.target,
        value,
        reason,
      })}
    />
  );
}

function TargetServings({ state, emit, onValidityChange }: {
  state: RecipeReviewState;
  emit: (action: RecipeReviewAction) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  const [value, setValue] = useState(String(state.targetServings));
  const errorId = `${useId()}-error`;
  const parsed = Number(value);
  const valid = value !== "" && Number.isSafeInteger(parsed) && parsed > 0;
  return (
    <label className="target-servings">
      <span>Target servings</span>
      <input
        type="number"
        min="1"
        step="1"
        value={value}
        aria-label={`Target servings for ${state.draft.name.value}`}
        aria-invalid={!valid}
        aria-describedby={!valid ? errorId : undefined}
        onChange={(event) => {
          const next = event.target.value;
          const number = Number(next);
          const nextValid = next !== ""
            && Number.isSafeInteger(number)
            && number > 0;
          setValue(next);
          onValidityChange(nextValid);
          if (nextValid) emit({ type: "set-target-servings", value: number });
        }}
      />
      {!valid && (
        <small id={errorId}>Enter a positive whole number of target servings.</small>
      )}
    </label>
  );
}

const INGREDIENT_FIELDS = [
  ["name", "Ingredient name", "name"],
  ["quantity", "Quantity", "nullable-positive-number"],
  ["unit", "Unit", "nullable-text"],
  ["foodState", "Food state", "food-state"],
] as const;

function IngredientReview({ state, recipeIndex, ingredient, ingredientIndex, decision, catalog, emit }: {
  state: RecipeReviewState;
  recipeIndex: number;
  ingredient: IngredientDraft;
  ingredientIndex: number;
  decision: IngredientReviewDecision;
  catalog: readonly NutritionRecord[];
  emit: (action: RecipeReviewAction) => void;
}) {
  const titleId = useId();
  const statusGroup = `${useId()}-status`;
  const name = ingredient.name.value || "unnamed ingredient";
  const context = `recipe ${recipeIndex + 1}, ingredient ${ingredientIndex + 1} (${name})`;
  return (
    <section className="ingredient-review" aria-labelledby={titleId}>
      <div className="ingredient-review__header">
        <h4 id={titleId}>{name}</h4>
        <fieldset className="ingredient-decision">
          <legend>Use or omit</legend>
          {(["used", "omitted"] as const).map((status) => {
            const action = status === "used" ? `Use ${name}` : `Omit ${name}`;
            return (
              <label key={status}>
                <input
                  type="radio"
                  name={statusGroup}
                  aria-label={`${action} in ${context}`}
                  checked={decision.status === status}
                  onChange={() => emit({
                    type: "set-ingredient-status",
                    ingredientId: ingredient.id,
                    status,
                  })}
                />
                {action}
              </label>
            );
          })}
        </fieldset>
      </div>
      <p className="ingredient-review__warning">
        Omitting an ingredient resets all step confirmations and derived nutrition.
      </p>
      <div className="review-field-grid">
        {INGREDIENT_FIELDS.map(([field, label, kind]) => (
          <BoundField
            key={field}
            label={label}
            kind={kind}
            contextLabel={context}
            sourceText={state.draft.sourceText}
            review={ingredient[field]}
            target={{ scope: "ingredient", id: ingredient.id, field }}
            emit={emit}
          />
        ))}
      </div>
      {decision.status !== null && (
        <NutritionMatch
          contextLabel={context}
          ingredient={ingredient}
          decision={decision}
          sourceServings={state.draft.sourceServings.value}
          targetServings={state.targetServings}
          catalog={catalog}
          onConfirm={emit}
        />
      )}
    </section>
  );
}

const STEP_FIELDS = [
  ["instruction", "Instruction", "instruction"],
  ["durationMinutes", "Duration minutes", "positive-number"],
  ["mode", "Step mode", "mode"],
  ["dependsOn", "Dependencies", "string-list"],
  ["resources", "Resources", "resources"],
  ["ovenOperation", "Oven operation", "oven-operation"],
  ["ovenTemperatureC", "Oven temperature C", "nullable-temperature"],
  ["isTerminal", "Terminal step", "boolean"],
] as const;

function dependencyDisplay(value: unknown, labels: ReadonlyMap<string, string>) {
  if (!Array.isArray(value) || value.length === 0) return "None";
  return value.map((id) => typeof id === "string"
    ? `${id} — ${labels.get(id) ?? "unknown step"}`
    : "invalid dependency").join(", ");
}

export function RecipeReview({ state, recipeIndex, catalog, stepLabels, onChange, onTargetValidityChange }: {
  state: RecipeReviewState;
  recipeIndex: number;
  catalog: readonly NutritionRecord[];
  stepLabels: ReadonlyMap<string, string>;
  onChange: (recipeId: string, action: RecipeReviewAction) => void;
  onTargetValidityChange: (recipeId: string, valid: boolean) => void;
}) {
  const titleId = useId();
  const { draft } = state;
  const emit = (action: RecipeReviewAction) => onChange(draft.id, action);
  const recipeContext = `recipe ${recipeIndex + 1} (${draft.name.value})`;
  return (
    <article className="recipe-review" aria-labelledby={titleId}>
      <header className="recipe-review__header">
        <p className="eyebrow">Recipe review</p>
        <h3 id={titleId}>{draft.name.value}</h3>
        <TargetServings
          state={state}
          emit={emit}
          onValidityChange={(valid) => onTargetValidityChange(draft.id, valid)}
        />
      </header>
      <div className="review-field-grid review-field-grid--recipe">
        <BoundField label="Recipe name" kind="name" contextLabel={recipeContext} sourceText={draft.sourceText} review={draft.name} target={{ scope: "recipe", field: "name" }} emit={emit} />
        <BoundField label="Source servings" kind="nullable-positive-number" contextLabel={recipeContext} sourceText={draft.sourceText} review={draft.sourceServings} target={{ scope: "recipe", field: "sourceServings" }} emit={emit} />
      </div>

      <div className="recipe-band"><span>Ingredients</span><small>Use / Omit is always explicit</small></div>
      {draft.ingredients.map((ingredient, index) => (
        <IngredientReview
          key={ingredient.id}
          state={state}
          recipeIndex={recipeIndex}
          ingredient={ingredient}
          ingredientIndex={index}
          decision={state.ingredientDecisions[index]}
          catalog={catalog}
          emit={emit}
        />
      ))}

      <div className="recipe-band"><span>Cooking steps</span><small>Every scheduling input stays inspectable</small></div>
      <ol className="step-review-list">
        {draft.steps.map((step, index) => {
          const context = `recipe ${recipeIndex + 1}, step ${index + 1} (${draft.name.value})`;
          return (
            <li key={step.id}>
              <h4>Step {index + 1} · {step.instruction.value}<code>Step ID: {step.id}</code></h4>
              <div className="review-field-grid">
                {STEP_FIELDS.map(([field, label, kind]) => (
                  <BoundField
                    key={field}
                    label={label}
                    kind={kind}
                    contextLabel={context}
                    sourceText={draft.sourceText}
                    review={step[field]}
                    displayValue={field === "dependsOn"
                      ? dependencyDisplay(step[field].value, stepLabels)
                      : undefined}
                    target={{ scope: "step", id: step.id, field }}
                    emit={emit}
                  />
                ))}
              </div>
            </li>
          );
        })}
      </ol>
    </article>
  );
}
