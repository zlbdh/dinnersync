"use client";

import { useLayoutEffect, useRef } from "react";

import type { CookingSessionState } from "@/modules/cooking-session";
import type { DinnerPlan } from "@/modules/dinner-planner";
import { parseIsoInstant } from "@/shared";

import { criticalPathAdvice } from "./summary-screen-advice";
import { Button } from "./ui/button";
import { StatusChip } from "./ui/status-chip";

export type SummaryScreenProps = {
  plan: DinnerPlan | null;
  session: CookingSessionState | null;
  diners: number;
  onReturnToSetup: () => void;
  onRestart: () => void;
};

function validInstant(value: unknown): value is string {
  return typeof value === "string" && parseIsoInstant(value).ok;
}

function formatClock(value: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function TimeValue({ value, label }: { value: string | null; label: string }) {
  return value && validInstant(value)
    ? <time aria-label={label} dateTime={value}>{formatClock(value)}</time>
    : <span aria-label={label}>Not recorded</span>;
}

function plannedFinish(plan: DinnerPlan | null, session: CookingSessionState | null) {
  if (session && validInstant(session.initialSchedule.serveAt)) {
    return session.initialSchedule.serveAt;
  }
  return plan?.schedule.feasible && validInstant(plan.schedule.serveAt)
    ? plan.schedule.serveAt
    : null;
}

function actualFinish(session: CookingSessionState | null) {
  if (!session || session.request.tasks.length === 0) return null;
  const ends: string[] = [];
  for (const task of session.request.tasks) {
    const runtime = session.runtime[task.id];
    if (!runtime || runtime.status !== "completed" || !validInstant(runtime.actualEnd)) {
      return null;
    }
    ends.push(runtime.actualEnd);
  }
  return ends.reduce((latest, value) =>
    Date.parse(value) > Date.parse(latest) ? value : latest);
}

function formatNumber(value: number, maximumFractionDigits = 1) {
  return new Intl.NumberFormat("en", { maximumFractionDigits }).format(value);
}

function minuteLabel(value: number) {
  return `${formatNumber(Math.abs(value))} min`;
}

function varianceLabel(planned: string | null, actual: string | null) {
  if (!planned || !actual) return "Variance unavailable";
  const difference = (Date.parse(actual) - Date.parse(planned)) / 60_000;
  if (!Number.isFinite(difference)) return "Variance unavailable";
  const rounded = Math.round(difference * 10) / 10;
  if (rounded === 0) return "On plan";
  return `${minuteLabel(rounded)} ${rounded > 0 ? "late" : "early"}`;
}

function completionStatus(
  plan: DinnerPlan | null,
  session: CookingSessionState | null,
  planned: string | null,
  actual: string | null,
) {
  if (!plan) return "Summary unavailable because no validated dinner plan is present.";
  if (!session || !actual) return "Cooking record incomplete. Actual completion is not available.";
  const variance = varianceLabel(planned, actual);
  return variance === "On plan"
    ? "Dinner record complete. Actual service matched the original plan."
    : `Dinner record complete. Actual service finished ${variance}.`;
}

function kcal(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? `${formatNumber(value, 2)} kcal`
    : "Not available";
}

export function SummaryScreen({
  plan,
  session,
  diners,
  onReturnToSetup,
  onRestart,
}: SummaryScreenProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => titleRef.current?.focus(), []);

  const planned = plannedFinish(plan, session);
  const actual = actualFinish(session);
  const delayEvents = session?.events.filter((event) => event.type === "TASK_DELAYED") ?? [];
  const delayMinutes = delayEvents.reduce((sum, event) => sum + event.delayMinutes, 0);
  const replanPasses = session?.events.filter((event) =>
    event.type === "TASK_STARTED"
    || event.type === "TASK_DELAYED"
    || event.type === "TASK_COMPLETED").length ?? 0;
  const nutrition = plan?.nutrition ?? null;
  const partial = nutrition?.completeness === "partial";
  const recipeNames = new Map(plan?.recipes.map((recipe) => [recipe.id, recipe.name]) ?? []);
  const mealPerPerson = nutrition
    ? partial ? nutrition.knownKcalPerPerson : nutrition.estimatedKcalPerPerson
    : null;
  const mealPerPersonLabel = typeof mealPerPerson === "number"
    && Number.isFinite(mealPerPerson) && mealPerPerson >= 0
    ? `${formatNumber(mealPerPerson, 2)}${partial ? " known" : ""} kcal / person`
    : "Per-person energy unavailable";

  return (
    <section className="summary-screen" aria-labelledby="summary-title">
      <header className="summary-intro">
        <p className="eyebrow">05 · After service</p>
        <h2 ref={titleRef} id="summary-title" tabIndex={-1}>
          Dinner landed. Here is the record.
        </h2>
        <p className="summary-status" role="status" aria-live="polite">
          {completionStatus(plan, session, planned, actual)}
        </p>
      </header>

      <div className="summary-ledger">
        <section className="summary-finish" aria-labelledby="finish-title">
          <div className="summary-section-heading">
            <p className="eyebrow">Finish line</p>
            <StatusChip tone={actual ? "complete" : "time"}>
              {actual ? "Complete record" : "Incomplete record"}
            </StatusChip>
          </div>
          <h3 id="finish-title">Plan against plate.</h3>
          <dl className="summary-clock">
            <div><dt>Planned</dt><dd><TimeValue value={planned} label="Planned dinner completion" /></dd></div>
            <div><dt>Actual</dt><dd><TimeValue value={actual} label="Actual dinner completion" /></dd></div>
          </dl>
          <p className="summary-variance">{varianceLabel(planned, actual)}</p>
        </section>

        <section className="summary-run-record" role="group" aria-label="Run record">
          <p className="eyebrow">Event ledger</p>
          <dl>
            <div><dt>Recorded delays</dt><dd>{delayEvents.length}</dd></div>
            <div><dt>Delay minutes</dt><dd>{formatNumber(delayMinutes)}</dd></div>
            <div><dt>Replan passes</dt><dd>{replanPasses}</dd></div>
          </dl>
          <p>Replan passes count accepted start, delay, and completion events that invoke the scheduler.</p>
        </section>
      </div>

      <section className="summary-nutrition" aria-labelledby="nutrition-title">
        <div className="summary-nutrition__heading">
          <div><p className="eyebrow">Energy ledger</p><h3 id="nutrition-title">Dish by dish.</h3></div>
          <strong>{nutrition ? mealPerPersonLabel : "No verified total"}</strong>
        </div>
        {partial && nutrition && (
          <p className="summary-warning" role="alert">
            <strong>Known subtotal only.</strong> {nutrition.unresolvedIngredientIds.length > 0
              ? `${nutrition.unresolvedIngredientIds.length} unresolved ingredient${nutrition.unresolvedIngredientIds.length === 1 ? "" : "s"};`
              : "Unresolved ingredient details were not recorded;"} these values are not a complete meal estimate.
          </p>
        )}
        {nutrition && nutrition.recipeSummaries.length > 0 ? (
          <ul className="summary-dishes" aria-label="Dish energy summary">
            {nutrition.recipeSummaries.map((recipe) => {
              const total = recipe.completeness === "partial"
                ? recipe.knownKcal
                : recipe.estimatedKcal;
              const perPerson = Number.isSafeInteger(diners) && diners > 0
                && typeof total === "number" && Number.isFinite(total)
                ? total / diners
                : null;
              return (
                <li key={recipe.recipeId}>
                  <div><h4>{recipeNames.get(recipe.recipeId) ?? "Unnamed dish"}</h4><small>{recipe.completeness === "partial" ? "Known subtotal" : "Complete estimate"}</small></div>
                  <strong>{kcal(total)}</strong>
                  <span>{perPerson === null ? "Per-person value unavailable" : `${kcal(perPerson)} / person`}</span>
                </li>
              );
            })}
          </ul>
        ) : <p className="summary-empty">Nutrition unavailable</p>}
      </section>

      <aside className="summary-advice" role="note" aria-label="Next service note">
        <p className="eyebrow">Next service note</p>
        <h3>One timing lesson, from this run only.</h3>
        <p>{criticalPathAdvice(session, actual)}</p>
      </aside>

      {session && session.warnings.length > 0 && (
        <section className="summary-session-warnings" aria-labelledby="session-warnings-title">
          <h3 id="session-warnings-title">Recorded session warnings</h3>
          <ul>{session.warnings.map((warning) =>
            <li key={`${warning.code}-${warning.message}`}>{warning.message}</li>)}</ul>
        </section>
      )}

      <footer className="summary-actions" aria-label="Summary actions">
        <Button variant="secondary" onClick={onReturnToSetup}>Return to setup</Button>
        <Button onClick={onRestart}>Start another dinner</Button>
      </footer>
    </section>
  );
}
