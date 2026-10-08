"use client";

import { useEffect, useId, useRef } from "react";

import type { DinnerPlan } from "@/modules/dinner-planner";
import type { NutritionSummary } from "@/modules/nutrition";
import type { ScheduleIssueCode } from "@/modules/scheduling";

import { ServiceTimeline } from "./service-timeline";
import { Button } from "./ui/button";

export type PlanScreenProps = {
  plan: DinnerPlan;
  onStartCooking(): void;
  onBack(): void;
};

const KCAL = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const CLOCK = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

const ISSUE_COPY: Record<ScheduleIssueCode, string> = {
  INVALID_TIME: "A service time is invalid.",
  INVALID_TASK: "A cooking step is not valid.",
  INVALID_DURATION: "A cooking duration is not valid.",
  MISSING_DEPENDENCY: "A cooking step depends on a missing step.",
  DEPENDENCY_CYCLE: "The cooking steps contain a dependency cycle.",
  INVALID_TERMINAL: "Each dish needs one valid finishing step.",
  INVALID_RESOURCE: "A cooking step requests an unavailable kitchen resource.",
  OVEN_TRANSITION_REQUIRED: "The oven needs an explicit temperature-change step.",
  DUPLICATE_TASK_ID: "Two cooking steps use the same identifier.",
  DUPLICATE_DEPENDENCY: "A cooking step repeats the same dependency.",
  RESOURCE_UNAVAILABLE: "A required kitchen resource is unavailable.",
  RESOURCE_CONFLICT: "Cook, oven, or burner work overlaps beyond capacity.",
  WINDOW_INFEASIBLE: "The available window is too short for every cooking step.",
};

function formatKcal(value: number) {
  return `${KCAL.format(value)} kcal`;
}

function formatDelta(value: number | null) {
  if (value === null) return "Not set";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${KCAL.format(Math.abs(value))} kcal`;
}

function NutritionPanel({
  nutrition,
  plan,
}: {
  nutrition: NutritionSummary;
  plan: DinnerPlan;
}) {
  const ingredientNames = new Map(plan.recipes.flatMap((recipe) =>
    recipe.ingredients.map((ingredient) => [
      ingredient.id,
      { name: ingredient.name, recipe: recipe.name },
    ])));

  return (
    <section className="plan-nutrition" aria-label="Nutrition summary">
      <p className="eyebrow">Source-backed nutrition</p>
      <h3>{nutrition.completeness === "complete" ? "Complete estimate" : "Known values only"}</h3>
      {nutrition.completeness === "complete" ? (
        <>
          <dl>
            <div>
              <dt>Total meal</dt>
              <dd>{formatKcal(nutrition.estimatedMealKcal ?? nutrition.knownMealKcal)}</dd>
            </div>
            <div>
              <dt>Per person</dt>
              <dd>{formatKcal(
                nutrition.estimatedKcalPerPerson ?? nutrition.knownKcalPerPerson,
              )}</dd>
            </div>
            <div>
              <dt>Target difference</dt>
              <dd>{formatDelta(nutrition.targetDeltaPerPerson)}</dd>
            </div>
          </dl>
          <p className="plan-nutrition__note">
            Calculated from the nutrition records you reviewed. This planning estimate is not dietary advice.
          </p>
        </>
      ) : (
        <>
          <dl>
            <div>
              <dt>Known subtotal</dt>
              <dd>{formatKcal(nutrition.knownMealKcal)}</dd>
            </div>
          </dl>
          <h4>Missing ingredients</h4>
          <ul className="plan-nutrition__missing">
            {nutrition.unresolvedIngredientIds.map((ingredientId) => {
              const ingredient = ingredientNames.get(ingredientId);
              return (
                <li key={ingredientId}>
                  <strong>{ingredient?.name ?? ingredientId}</strong>
                  {ingredient && <span>{ingredient.recipe}</span>}
                </li>
              );
            })}
          </ul>
          <p className="plan-nutrition__note">
            Unresolved ingredients are excluded; no total, per-person estimate, or target difference is inferred.
          </p>
        </>
      )}
    </section>
  );
}

function FeasibilityNotice({ plan }: { plan: DinnerPlan }) {
  if (plan.schedule.feasible) return null;
  return (
    <section className="plan-feasibility" aria-label="Schedule feasibility">
      <div>
        <p className="eyebrow">Schedule check</p>
        <h3>Requested service window is not feasible.</h3>
      </div>
      <ul>
        {plan.schedule.issues.map((issue, index) => (
          <li key={`${issue.code}-${index}`}>{ISSUE_COPY[issue.code]}</li>
        ))}
      </ul>
      {plan.schedule.earliestFeasible ? (
        <p className="plan-feasibility__earliest">
          <span>Earliest feasible finish</span>
          <time dateTime={plan.schedule.earliestFeasible.serveAt}>
            {CLOCK.format(new Date(plan.schedule.earliestFeasible.serveAt))}
          </time>
        </p>
      ) : (
        <p className="plan-feasibility__unresolved">
          Fix the recipe graph or resource request before a finish time can be calculated.
        </p>
      )}
    </section>
  );
}

export function PlanScreen({ plan, onStartCooking, onBack }: PlanScreenProps) {
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  return (
    <section className="plan-screen" aria-labelledby={titleId}>
      <header className="plan-intro">
        <p className="eyebrow">03 · Run of show</p>
        <h2 ref={titleRef} id={titleId} tabIndex={-1}>Service timeline ready.</h2>
        <p>
          Read left to right on a wide screen, or follow the chronological task list on a phone.
        </p>
      </header>

      <FeasibilityNotice plan={plan} />
      <div className="plan-layout">
        <ServiceTimeline plan={plan} />
        <NutritionPanel nutrition={plan.nutrition} plan={plan} />
      </div>

      <div className="plan-actions">
        <Button onClick={onStartCooking} disabled={!plan.schedule.feasible}>
          Start cooking
        </Button>
        <Button variant="secondary" onClick={onBack}>Back to setup</Button>
        {!plan.schedule.feasible && (
          <p>Cooking stays locked until the plan has a feasible resource timeline.</p>
        )}
      </div>
    </section>
  );
}
