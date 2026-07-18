"use client";

import { useEffect, useReducer, useRef, useState } from "react";

import {
  DEMO_REVIEW_STATES,
  DEMO_NUTRITION_CATALOG,
  DEMO_SCENARIO,
  DEMO_SOURCE_RECIPES,
} from "@/modules/demo";
import {
  createDinnerPlannerState,
  buildDinnerPlan,
  dinnerPlannerReducer,
  type DinnerPlanSettings,
} from "@/modules/dinner-planner";
import type { RecipeReviewAction } from "@/modules/recipe-import";

import {
  requestLocalAiImport,
  type LocalAiImportMeta,
} from "./local-ai-import";
import { ReviewScreen } from "./review-screen";
import { SetupScreen, type SetupFormValues } from "./setup-screen";
import { setupValuesToSettings } from "./setup-settings";
import { PlanHandoff } from "./plan-handoff";
import { ProgressRail } from "./ui/progress-rail";
import { StatusChip } from "./ui/status-chip";

type Mode = "hosted" | "local";

const PROGRESS_STEP = {
  setup: "Setup",
  review: "Review",
  plan: "Plan",
  cook: "Cook",
  summary: "Summary",
} as const;

const INITIAL_VALUES: SetupFormValues = {
  recipeTexts: ["", "", ""],
  diners: DEMO_SCENARIO.diners,
  availableTime: "18:00",
  serveTime: "19:00",
  targetKcalPerPerson: "",
  burners: DEMO_SCENARIO.kitchen.burners,
  notes: "",
};

const INITIAL_SETTINGS = {
  diners: DEMO_SCENARIO.diners,
  availableFrom: DEMO_SCENARIO.availableFrom,
  serveAt: DEMO_SCENARIO.serveAt,
  targetKcalPerPerson: null,
  kitchen: { ...DEMO_SCENARIO.kitchen },
  serveToleranceMinutes: DEMO_SCENARIO.serveToleranceMinutes,
} satisfies DinnerPlanSettings;

const DEMO_SETTINGS = {
  ...INITIAL_SETTINGS,
  targetKcalPerPerson: DEMO_SCENARIO.targetKcalPerPerson,
} satisfies DinnerPlanSettings;

export function DinnerSyncApp() {
  const [planner, dispatch] = useReducer(
    dinnerPlannerReducer,
    createDinnerPlannerState(INITIAL_SETTINGS, []),
  );
  const [mode, setMode] = useState<Mode>("hosted");
  const [values, setValues] = useState(INITIAL_VALUES);
  const [consentToSend, setConsentToSend] = useState(false);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const [localMeta, setLocalMeta] = useState<LocalAiImportMeta | null>(null);
  const [localBusy, setLocalBusy] = useState(false);
  const requestGeneration = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => () => {
    requestGeneration.current += 1;
    activeRequest.current?.abort();
    activeRequest.current = null;
  }, []);

  const cancelLocalRequest = () => {
    requestGeneration.current += 1;
    activeRequest.current?.abort();
    activeRequest.current = null;
    setLocalBusy(false);
  };

  const changeMode = (nextMode: Mode) => {
    cancelLocalRequest();
    setMode(nextMode);
    setConsentToSend(false);
    setLocalNotice(null);
    setLocalMeta(null);
    setValues({ ...INITIAL_VALUES, recipeTexts: ["", "", ""] });
    dispatch({
      type: "RESET",
      settings: INITIAL_SETTINGS,
      reviewStates: [],
    });
  };

  const loadDemo = () => {
    cancelLocalRequest();
    setMode("hosted");
    setConsentToSend(false);
    setLocalNotice(null);
    setLocalMeta(null);
    setValues({
      ...INITIAL_VALUES,
      recipeTexts: [
        DEMO_SOURCE_RECIPES[0].sourceText,
        DEMO_SOURCE_RECIPES[1].sourceText,
        DEMO_SOURCE_RECIPES[2].sourceText,
      ],
      targetKcalPerPerson: String(DEMO_SCENARIO.targetKcalPerPerson),
    });
    dispatch({
      type: "RESET",
      settings: DEMO_SETTINGS,
      reviewStates: DEMO_REVIEW_STATES.map((review) => structuredClone(review)),
    });
    dispatch({ type: "STAGE_CHANGED", stage: "review" });
  };

  const prepareLocalReview = async (recipeTexts: string[]) => {
    if (localBusy) return;
    const nextSettings = setupValuesToSettings(values);
    if (!nextSettings.ok) {
      setLocalNotice(nextSettings.message);
      return;
    }

    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    const controller = new AbortController();
    activeRequest.current?.abort();
    activeRequest.current = controller;
    setLocalBusy(true);
    setLocalMeta(null);
    setLocalNotice("Checking local Codex availability before any recipe text is sent.");
    dispatch({ type: "SETTINGS_CHANGED", settings: nextSettings.value });

    const result = await requestLocalAiImport({
      recipes: [...recipeTexts],
      diners: nextSettings.value.diners,
      signal: controller.signal,
    });
    if (generation !== requestGeneration.current) return;

    if (!result.ok) {
      if (result.code !== "LOCAL_AI_ABORTED") setLocalNotice(result.message);
    } else {
      setLocalNotice(null);
      setLocalMeta(result.meta);
      dispatch({
        type: "RESET",
        settings: nextSettings.value,
        reviewStates: result.reviewStates,
      });
      dispatch({ type: "STAGE_CHANGED", stage: "review" });
    }

    if (generation === requestGeneration.current) {
      activeRequest.current = null;
      setLocalBusy(false);
    }
  };

  const returnToSetup = () => {
    cancelLocalRequest();
    setLocalNotice(null);
    setLocalMeta(null);
    dispatch({
      type: "RESET",
      settings: planner.settings,
      reviewStates: planner.reviewStates,
    });
  };

  const reviewChanged = (recipeId: string, action: RecipeReviewAction) => {
    dispatch({ type: "REVIEW_CHANGED", recipeId, action });
  };

  const planAttempt = planner.stage === "review"
    ? buildDinnerPlan({
      settings: planner.settings,
      reviewStates: planner.reviewStates,
      nutritionCatalog: DEMO_NUTRITION_CATALOG,
    })
    : null;

  const buildPlan = () => {
    if (!planAttempt) return;
    if (planAttempt.ok) {
      dispatch({ type: "PLAN_BUILT", plan: planAttempt.value });
    } else {
      dispatch({ type: "ERRORS_CHANGED", errors: planAttempt.error });
    }
  };

  return (
    <main className="app-shell" id="top">
      <header className="masthead">
        <a className="brand" href="#top" aria-label="DinnerSync home">
          <span aria-hidden="true">DS</span>
          <h1>DinnerSync</h1>
        </a>
        <p>Plan together. Cook on time.</p>
        <StatusChip tone={mode === "hosted" ? "complete" : "time"}>
          {mode === "hosted" ? "Hosted · no model" : "Local AI · Codex"}
        </StatusChip>
      </header>

      <ProgressRail current={PROGRESS_STEP[planner.stage]} />

      {planner.stage === "setup" ? (
        <>
          <SetupScreen
            mode={mode}
            values={values}
            consentToSend={consentToSend}
            isSubmitting={localBusy}
            localNotice={localNotice}
            onModeChange={changeMode}
            onValuesChange={setValues}
            onConsentChange={setConsentToSend}
            onLoadDemo={loadDemo}
            onSubmit={prepareLocalReview}
          />
        </>
      ) : planner.stage === "review" ? (
        <>
          {mode === "local" && localMeta && (
            <p className="local-notice" role="status">
              Verified import · {localMeta.provider} · {localMeta.model} · schema and source evidence checked. Every field still needs your review.
            </p>
          )}
          <ReviewScreen
            reviewStates={planner.reviewStates}
            nutritionCatalog={DEMO_NUTRITION_CATALOG}
            mode={mode}
            note={values.notes}
            planReady={planAttempt?.ok === true}
            planErrors={planAttempt && !planAttempt.ok ? planAttempt.error : []}
            onReviewChange={reviewChanged}
            onBuildPlan={buildPlan}
            onBack={returnToSetup}
          />
        </>
      ) : (
        <PlanHandoff onBack={returnToSetup} />
      )}
    </main>
  );
}
