"use client";

import { useReducer, useState } from "react";

import {
  DEMO_REVIEW_STATES,
  DEMO_SCENARIO,
  DEMO_SOURCE_RECIPES,
} from "@/modules/demo";
import {
  createDinnerPlannerState,
  dinnerPlannerReducer,
  type DinnerPlanSettings,
} from "@/modules/dinner-planner";

import { SetupScreen, type SetupFormValues } from "./setup-screen";
import { Button } from "./ui/button";
import { Panel } from "./ui/panel";
import { ProgressRail } from "./ui/progress-rail";
import { StatusChip } from "./ui/status-chip";

type Mode = "hosted" | "local";

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

  const changeMode = (nextMode: Mode) => {
    setMode(nextMode);
    setConsentToSend(false);
    setLocalNotice(null);
    setValues({ ...INITIAL_VALUES, recipeTexts: ["", "", ""] });
    dispatch({
      type: "RESET",
      settings: INITIAL_SETTINGS,
      reviewStates: [],
    });
  };

  const loadDemo = () => {
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

  const prepareLocalReview = (recipeTexts: string[]) => {
    setLocalNotice(
      `${recipeTexts.length} recipe${recipeTexts.length === 1 ? " is" : "s are"} entered, but not parsed yet. Pasted text is never presented as AI output.`,
    );
  };

  const returnToSetup = () => dispatch({
    type: "RESET",
    settings: planner.settings,
    reviewStates: planner.reviewStates,
  });

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

      <ProgressRail current={planner.stage === "setup" ? "Setup" : "Review"} />

      {planner.stage === "setup" ? (
        <>
          <SetupScreen
            mode={mode}
            values={values}
            consentToSend={consentToSend}
            onModeChange={changeMode}
            onValuesChange={setValues}
            onConsentChange={setConsentToSend}
            onLoadDemo={loadDemo}
            onSubmit={prepareLocalReview}
          />
          {localNotice && <p className="local-notice" role="status">{localNotice}</p>}
        </>
      ) : (
        <Panel className="handoff" aria-labelledby="handoff-title">
          <p className="eyebrow">02 · Recipe review</p>
          <h2 id="handoff-title">Demo dinner loaded.</h2>
          <p>
            {`${planner.reviewStates.length} pre-generated, pre-reviewed fixtures are ready. No model request was made.`}
          </p>
          <div className="handoff__actions">
            <Button variant="secondary" onClick={returnToSetup}>Back to setup</Button>
            <StatusChip tone="time">Review screen next</StatusChip>
          </div>
        </Panel>
      )}
    </main>
  );
}
