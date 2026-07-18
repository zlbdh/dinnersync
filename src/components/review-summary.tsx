import type { RecipeReviewState } from "@/modules/recipe-import";

import { Button } from "./ui/button";

export type ReviewPlanError = {
  message: string;
  path?: string;
};

export type ReviewSummaryProps = {
  reviewStates: readonly RecipeReviewState[];
  note: string;
  planReady: boolean;
  planErrors: readonly ReviewPlanError[];
  onBuildPlan: () => void;
};

const MAX_VISIBLE_ERRORS = 8;

export function ReviewSummary({
  reviewStates,
  note,
  planReady,
  planErrors,
  onBuildPlan,
}: ReviewSummaryProps) {
  const unresolvedUsed = reviewStates.reduce((count, state) => count
    + state.ingredientDecisions.filter((decision) =>
    decision.status === "used" && decision.nutritionMatchStatus === "unresolved").length, 0);
  const visibleErrors = planErrors.slice(0, MAX_VISIBLE_ERRORS);
  const hiddenErrorCount = planErrors.length - visibleErrors.length;

  return (
    <aside className="review-summary" aria-labelledby="review-summary-title">
      <p className="eyebrow">Decision ledger</p>
      <h2 id="review-summary-title" tabIndex={-1}>Before the clock starts</h2>
      <dl>
        <div><dt>Recipes</dt><dd>{reviewStates.length}</dd></div>
        <div><dt>Nutrition unresolved</dt><dd>{unresolvedUsed}</dd></div>
      </dl>

      <section className="review-note" aria-labelledby="review-note-title">
        <h3 id="review-note-title">Your note · not analyzed or safety-checked</h3>
        <p>{note.trim() || "No note supplied."}</p>
      </section>

      {unresolvedUsed > 0 && (
        <p className="review-summary__caution">
          {unresolvedUsed} used ingredient{unresolvedUsed === 1 ? " remains" : "s remain"} nutrition-unresolved. The plan may proceed with a known subtotal.
        </p>
      )}

      {planErrors.length > 0 && (
        <>
          <p className="review-error-count" role="status" aria-live="polite" aria-atomic="true">
            {planErrors.length} timeline blocker{planErrors.length === 1 ? " remains" : "s remain"}.
            {hiddenErrorCount > 0 ? ` Showing the first ${MAX_VISIBLE_ERRORS}.` : ""}
          </p>
          <ul className="review-errors" aria-label="Timeline blockers">
            {visibleErrors.map((error, index) => (
              <li key={`${error.path ?? "plan"}-${index}`}>
                <strong>{error.message}</strong>
                {error.path && <code>{error.path}</code>}
              </li>
            ))}
            {hiddenErrorCount > 0 && (
              <li className="review-errors__remainder">
                <strong>{hiddenErrorCount} more blockers are not repeated here.</strong>
                <span>Resolve the visible review fields to refresh this list.</span>
              </li>
            )}
          </ul>
        </>
      )}

      {!planReady && (
        <p className="review-summary__locked" id="timeline-lock-reason">
          Timeline is locked until the listed review decisions are resolved.
        </p>
      )}
      <div className="review-summary__actions">
        <Button
          disabled={!planReady}
          aria-describedby={!planReady ? "timeline-lock-reason" : undefined}
          onClick={onBuildPlan}
        >
          Build the service timeline
        </Button>
      </div>
    </aside>
  );
}
