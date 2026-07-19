"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import {
  advanceSessionTime,
  applySessionCommand,
  createCookingSession,
  type SessionCommand,
} from "@/modules/cooking-session";
import {
  DEMO_NUTRITION_CATALOG,
  DEMO_REVIEW_STATES,
  DEMO_SCENARIO,
  DEMO_SOURCE_RECIPES,
  nextDemoCommand,
} from "@/modules/demo";
import {
  buildDinnerPlan,
  createDinnerPlannerState,
  dinnerPlannerReducer,
  type DinnerPlanSettings,
} from "@/modules/dinner-planner";
import type { RecipeReviewAction } from "@/modules/recipe-import";
import { fromEpochMs, toEpochMs, type IsoInstant } from "@/shared";

import { requestLocalAiImport, type LocalAiImportMeta } from "./local-ai-import";
import {
  projectPlanningInstant,
  type PlanningMode,
} from "./planning-context";
import type { SetupFormValues } from "./setup-screen";
import { setupValuesToSettings } from "./setup-settings";
import { usePlannerPersistence } from "./use-planner-persistence";

export type { PlanningMode } from "./planning-context";

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

function laterInstant(current: IsoInstant, candidate: IsoInstant) {
  return toEpochMs(candidate) > toEpochMs(current) ? candidate : current;
}

function demoValues(): SetupFormValues {
  return {
    ...INITIAL_VALUES,
    recipeTexts: [
      DEMO_SOURCE_RECIPES[0].sourceText,
      DEMO_SOURCE_RECIPES[1].sourceText,
      DEMO_SOURCE_RECIPES[2].sourceText,
    ],
    targetKcalPerPerson: String(DEMO_SCENARIO.targetKcalPerPerson),
  };
}

export function useDinnerSyncController() {
  const [planner, dispatch] = useReducer(
    dinnerPlannerReducer,
    createDinnerPlannerState(INITIAL_SETTINGS, []),
  );
  const [mode, setMode] = useState<PlanningMode>("hosted");
  const [origin, setOrigin] = useState<PlanningMode | null>(null);
  const [values, setValues] = useState(INITIAL_VALUES);
  const [consentToSend, setConsentToSend] = useState(false);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const [localMeta, setLocalMeta] = useState<LocalAiImportMeta | null>(null);
  const [localBusy, setLocalBusy] = useState(false);
  const [now, setNow] = useState<IsoInstant>(DEMO_SCENARIO.availableFrom);
  const requestGeneration = useRef(0);
  const playbackGeneration = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const clockAnchor = useRef<{ virtualAt: IsoInstant; wallClockMs: number } | null>(null);
  const restoreUiContext = useCallback((
    nextOrigin: PlanningMode | null,
    instant: IsoInstant,
    wallClockMs: number,
  ) => {
    if (nextOrigin !== null) setMode(nextOrigin);
    setOrigin(nextOrigin);
    clockAnchor.current = { virtualAt: instant, wallClockMs };
    setNow(instant);
  }, []);
  const reanchorClock = useCallback((instant: IsoInstant) => {
    clockAnchor.current = { virtualAt: instant, wallClockMs: Date.now() };
    setNow(instant);
  }, []);
  const stored = usePlannerPersistence(
    planner,
    dispatch,
    origin,
    now,
    restoreUiContext,
    INITIAL_SETTINGS,
  );

  const stopAsyncWork = () => {
    requestGeneration.current += 1;
    playbackGeneration.current += 1;
    activeRequest.current?.abort();
    activeRequest.current = null;
    setLocalBusy(false);
  };

  useEffect(() => () => {
    requestGeneration.current += 1;
    playbackGeneration.current += 1;
    activeRequest.current?.abort();
  }, []);

  useEffect(() => {
    if (planner.stage !== "cook") return;
    const timer = window.setInterval(() => {
      const anchor = clockAnchor.current;
      if (!anchor) return;
      const next = projectPlanningInstant(anchor, Date.now());
      setNow(next);
      dispatch({ type: "SESSION_TIME_ADVANCED", now: next });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [planner.stage]);

  const changeMode = (nextMode: PlanningMode) => {
    stored.clearRestoredNotice();
    stopAsyncWork();
    setMode(nextMode);
    setOrigin(nextMode);
    setConsentToSend(false);
    setLocalNotice(null);
    setLocalMeta(null);
    setValues({ ...INITIAL_VALUES, recipeTexts: ["", "", ""] });
    dispatch({ type: "RESET", settings: INITIAL_SETTINGS, reviewStates: [] });
  };

  const loadDemo = () => {
    stored.clearRestoredNotice();
    stopAsyncWork();
    const nextValues = demoValues();
    const settings = setupValuesToSettings(nextValues);
    if (!settings.ok) {
      setLocalNotice(settings.message);
      return;
    }
    setMode("hosted");
    setOrigin("hosted");
    setConsentToSend(false);
    setLocalNotice(null);
    setLocalMeta(null);
    setValues(nextValues);
    dispatch({
      type: "RESET",
      settings: settings.value,
      reviewStates: DEMO_REVIEW_STATES.map((review) => structuredClone(review)),
    });
    dispatch({ type: "STAGE_CHANGED", stage: "review" });
  };

  const prepareLocalReview = async (recipeTexts: string[]) => {
    if (localBusy) return;
    const settings = setupValuesToSettings(values);
    if (!settings.ok) {
      setLocalNotice(settings.message);
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
    dispatch({ type: "SETTINGS_CHANGED", settings: settings.value });
    const result = await requestLocalAiImport({
      recipes: [...recipeTexts],
      diners: settings.value.diners,
      signal: controller.signal,
    });
    if (generation !== requestGeneration.current) return;
    if (!result.ok) {
      if (result.code !== "LOCAL_AI_ABORTED") setLocalNotice(result.message);
    } else {
      setLocalNotice(null);
      setLocalMeta(result.meta);
      setOrigin("local");
      dispatch({ type: "RESET", settings: settings.value, reviewStates: result.reviewStates });
      dispatch({ type: "STAGE_CHANGED", stage: "review" });
    }
    activeRequest.current = null;
    setLocalBusy(false);
  };

  const returnToSetup = () => {
    stored.clearRestoredNotice();
    stopAsyncWork();
    setLocalNotice(null);
    setLocalMeta(null);
    dispatch({ type: "RESET", settings: planner.settings, reviewStates: planner.reviewStates });
  };

  const planAttempt = useMemo(() => planner.stage === "review"
    ? buildDinnerPlan({
      settings: planner.settings,
      reviewStates: planner.reviewStates,
      nutritionCatalog: DEMO_NUTRITION_CATALOG,
    })
    : null, [planner.reviewStates, planner.settings, planner.stage]);

  const buildPlan = () => {
    if (!planAttempt) return;
    if (planAttempt.ok) dispatch({ type: "PLAN_BUILT", plan: planAttempt.value });
    else dispatch({ type: "ERRORS_CHANGED", errors: planAttempt.error });
  };

  const startCooking = () => {
    if (planner.stage !== "plan" || !planner.plan?.schedule.feasible) return;
    stored.clearRestoredNotice();
    const start = mode === "local"
      ? fromEpochMs(Date.now())
      : planner.settings.availableFrom;
    const session = advanceSessionTime(createCookingSession(
      planner.plan.scheduleRequest,
      planner.plan.schedule,
    ), start);
    reanchorClock(start);
    dispatch({ type: "SESSION_STARTED", session });
  };

  const dispatchCookCommand = (command: SessionCommand) => {
    reanchorClock(laterInstant(now, command.at));
    dispatch({ type: "SESSION_COMMAND", command });
  };

  const runAcceleratedDemo = async (
    send: (command: SessionCommand) => void | Promise<void>,
  ) => {
    if (planner.stage !== "cook" || !planner.session) return;
    const generation = playbackGeneration.current + 1;
    playbackGeneration.current = generation;
    let session = planner.session;
    for (let index = 0; index < 100 && generation === playbackGeneration.current; index += 1) {
      const beat = nextDemoCommand(session, now);
      if (!beat) break;
      await send(beat.command);
      session = applySessionCommand(
        advanceSessionTime(session, beat.command.at),
        beat.command,
      );
      await new Promise((resolve) => window.setTimeout(resolve, 25));
    }
  };

  return {
    planner, mode, origin, values, consentToSend, localNotice, localMeta, localBusy, now,
    hydrated: stored.hydrated,
    restoredFromStorage: stored.restoredFromStorage,
    setValues, setConsentToSend, changeMode, loadDemo, prepareLocalReview,
    returnToSetup,
    reviewChanged: (recipeId: string, action: RecipeReviewAction) =>
      dispatch({ type: "REVIEW_CHANGED", recipeId, action }),
    planAttempt, buildPlan, startCooking, dispatchCookCommand, runAcceleratedDemo,
    restart: () => changeMode("hosted"),
  };
}
