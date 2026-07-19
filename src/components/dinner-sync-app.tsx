"use client";

import { DEMO_NUTRITION_CATALOG } from "@/modules/demo";

import { CookScreen } from "./cook-screen";
import { PlanScreen } from "./plan-screen";
import { ReviewScreen } from "./review-screen";
import { SetupScreen } from "./setup-screen";
import { SummaryScreen } from "./summary-screen";
import { ProgressRail } from "./ui/progress-rail";
import { StatusChip } from "./ui/status-chip";
import { useDinnerSyncController } from "./use-dinner-sync-controller";

const PROGRESS_STEP = {
  setup: "Setup",
  review: "Review",
  plan: "Plan",
  cook: "Cook",
  summary: "Summary",
} as const;

export function DinnerSyncApp() {
  const flow = useDinnerSyncController();
  const { planner } = flow;
  const originTone = !flow.hydrated
    ? "neutral"
    : flow.origin === "hosted" ? "complete" : flow.origin === "local" ? "time" : "neutral";
  const originLabel = !flow.hydrated
    ? "Checking saved session"
    : flow.origin === "hosted"
      ? "Hosted · no model"
      : flow.origin === "local" ? "Local AI · Codex" : "Restored · origin unavailable";

  return (
    <main className="app-shell" id="top">
      <header className="masthead">
        <a className="brand" href="#top" aria-label="DinnerSync home">
          <span aria-hidden="true">DS</span>
          <h1>DinnerSync</h1>
        </a>
        <p>Plan together. Cook on time.</p>
        <StatusChip tone={originTone}>{originLabel}</StatusChip>
      </header>

      <ProgressRail current={PROGRESS_STEP[planner.stage]} />

      {flow.hydrated && planner.stage !== "cook" && planner.warnings.length > 0 && (
        <aside className="local-notice" role="status" aria-label="Planner storage warnings">
          <strong>Saved session notice</strong>
          <ul>{planner.warnings.map((warning) => (
            <li key={`${warning.code}:${warning.message}`}>{warning.message}</li>
          ))}</ul>
        </aside>
      )}

      {flow.hydrated && planner.stage === "setup" && (
        <SetupScreen
          mode={flow.mode}
          values={flow.values}
          consentToSend={flow.consentToSend}
          isSubmitting={flow.localBusy}
          localNotice={flow.localNotice}
          onModeChange={flow.changeMode}
          onValuesChange={flow.setValues}
          onConsentChange={flow.setConsentToSend}
          onLoadDemo={flow.loadDemo}
          onSubmit={flow.prepareLocalReview}
        />
      )}

      {flow.hydrated && planner.stage === "review" && (
        <>
          {flow.mode === "local" && flow.localMeta && (
            <p className="local-notice" role="status">
              Verified import · {flow.localMeta.provider} · {flow.localMeta.model} · schema and source evidence checked. Every field still needs your review.
            </p>
          )}
          <ReviewScreen
            reviewStates={planner.reviewStates}
            nutritionCatalog={DEMO_NUTRITION_CATALOG}
            mode={flow.origin ?? "unknown"}
            note={flow.values.notes}
            planReady={flow.planAttempt?.ok === true}
            planErrors={flow.planAttempt && !flow.planAttempt.ok ? flow.planAttempt.error : []}
            onReviewChange={flow.reviewChanged}
            onBuildPlan={flow.buildPlan}
            onBack={flow.returnToSetup}
          />
        </>
      )}

      {flow.hydrated && planner.stage === "plan" && planner.plan && (
        <PlanScreen
          plan={planner.plan}
          onStartCooking={flow.startCooking}
          onBack={flow.returnToSetup}
        />
      )}

      {flow.hydrated && planner.stage === "cook" && planner.session && (
        <CookScreen
          session={planner.session}
          now={flow.now}
          onDispatch={flow.dispatchCookCommand}
          onAccelerate={flow.runAcceleratedDemo}
          playbackRate={60}
          restoredFromStorage={flow.restoredFromStorage}
          plannerWarnings={planner.warnings}
        />
      )}

      {flow.hydrated && planner.stage === "summary" && (
        <SummaryScreen
          plan={planner.plan}
          session={planner.session}
          diners={planner.settings.diners}
          onReturnToSetup={flow.returnToSetup}
          onRestart={flow.restart}
        />
      )}
    </main>
  );
}
