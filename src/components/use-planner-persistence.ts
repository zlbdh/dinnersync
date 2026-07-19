"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
} from "react";

import { DEMO_NUTRITION_CATALOG } from "@/modules/demo";
import {
  createDinnerPlannerPersistence,
  readDinnerPlannerRevision,
  type DinnerPlanSettings,
  type DinnerPlannerAction,
  type DinnerPlannerState,
  type DinnerPlannerWarning,
} from "@/modules/dinner-planner";
import { toEpochMs, type IsoInstant } from "@/shared";

import {
  parsePlanningContext,
  projectPlanningInstant,
  serializePlanningContext,
  type PlanningMode,
} from "./planning-context";

export const PLANNER_STORAGE_KEY = "dinnersync:planner:v1";
export const PLANNING_CONTEXT_STORAGE_KEY = "dinnersync:context:v1";

function createPersistenceRevision() {
  return globalThis.crypto.randomUUID();
}

function sessionCursor(state: DinnerPlannerState, candidate: IsoInstant) {
  let cursor = toEpochMs(candidate) > toEpochMs(state.settings.availableFrom)
    ? candidate
    : state.settings.availableFrom;
  for (const event of state.session?.events ?? []) {
    if (toEpochMs(event.at) > toEpochMs(cursor)) cursor = event.at;
  }
  return cursor;
}

type RestoreUiContext = (
  origin: PlanningMode | null,
  now: IsoInstant,
  wallClockMs: number,
) => void;

export function usePlannerPersistence(
  planner: DinnerPlannerState,
  dispatch: Dispatch<DinnerPlannerAction>,
  origin: PlanningMode | null,
  now: IsoInstant,
  restoreUiContext: RestoreUiContext,
  seedSettings: DinnerPlanSettings,
) {
  const persistence = useMemo(
    () => createDinnerPlannerPersistence(PLANNER_STORAGE_KEY),
    [],
  );
  const [restoredFromStorage, setRestoredFromStorage] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const persistedRevision = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    let hadSnapshot = false;
    let plannerSerialized: string | null = null;
    let contextSerialized: string | null = null;
    try {
      plannerSerialized = globalThis.localStorage.getItem(PLANNER_STORAGE_KEY);
      hadSnapshot = plannerSerialized !== null;
      contextSerialized = globalThis.localStorage.getItem(PLANNING_CONTEXT_STORAGE_KEY);
    } catch {
      // The persistence adapter records the storage warning.
    }
    const wallClockMs = Date.now();
    const plannerRevision = readDinnerPlannerRevision(plannerSerialized);
    const context = hadSnapshot
      ? parsePlanningContext(contextSerialized, plannerRevision)
      : null;
    const projectedNow = context
      ? projectPlanningInstant(context, wallClockMs)
      : seedSettings.availableFrom;
    const restored = persistence.restore({
      settings: seedSettings,
      reviewStates: [],
      nutritionCatalog: DEMO_NUTRITION_CATALOG,
    }, projectedNow);
    const recovered = restored.warnings.some((warning) =>
      warning.code === "SNAPSHOT_RECOVERED");
    const missingContext = hadSnapshot && !recovered && restored.stage !== "setup" && !context;
    const contextWarning: DinnerPlannerWarning | null = missingContext
      ? {
          category: "storage",
          code: "SNAPSHOT_RECOVERED" as const,
          message: "The saved cooking clock or origin was unavailable; recovery used the last verified event.",
        }
      : null;
    const cursor = sessionCursor(
      restored,
      recovered || missingContext ? restored.settings.availableFrom : projectedNow,
    );
    const restoredNotice = hadSnapshot
      && !recovered
      && (restored.stage === "cook" || restored.stage === "summary");
    dispatch({ type: "VALIDATED_STATE_RESTORED", state: restored });
    if (contextWarning) {
      // Add recovery UI after the exact persistence-validated state crosses the reducer.
      dispatch({ type: "STORAGE_WARNING", warning: contextWarning });
    }
    queueMicrotask(() => {
      if (!active) return;
      restoreUiContext(
        context && !recovered ? context.mode : restored.stage === "setup" ? "hosted" : null,
        cursor,
        wallClockMs,
      );
      setRestoredFromStorage(restoredNotice);
      setHydrated(true);
    });
    return () => {
      active = false;
    };
  }, [dispatch, persistence, restoreUiContext, seedSettings]);

  useEffect(() => {
    if (!hydrated) return;
    const revision = createPersistenceRevision();
    persistedRevision.current = revision;
    const saved = persistence.save(planner, revision);
    for (const warning of saved.warnings) {
      if (!planner.warnings.some((entry) => entry.code === warning.code)) {
        dispatch({ type: "STORAGE_WARNING", warning });
      }
    }
    if (origin === null) return;
    try {
      // A shared revision makes either half of a partial two-key write unusable.
      globalThis.localStorage.setItem(
        PLANNING_CONTEXT_STORAGE_KEY,
        serializePlanningContext(origin, now, Date.now(), revision),
      );
    } catch {
      dispatch({
        type: "STORAGE_WARNING",
        warning: {
          category: "storage",
          code: "STORAGE_UNAVAILABLE",
          message: "Browser storage is unavailable; this session is saved in memory only.",
        },
      });
    }
  }, [dispatch, hydrated, now, origin, persistence, planner]);

  useEffect(() => {
    const revision = persistedRevision.current;
    if (!hydrated || origin === null || revision === null) return;
    try {
      globalThis.localStorage.setItem(
        PLANNING_CONTEXT_STORAGE_KEY,
        serializePlanningContext(origin, now, Date.now(), revision),
      );
    } catch {
      dispatch({
        type: "STORAGE_WARNING",
        warning: {
          category: "storage",
          code: "STORAGE_UNAVAILABLE",
          message: "Browser storage is unavailable; this session is saved in memory only.",
        },
      });
    }
  }, [dispatch, hydrated, now, origin]);

  return {
    hydrated,
    restoredFromStorage,
    clearRestoredNotice() {
      setRestoredFromStorage(false);
    },
  };
}
