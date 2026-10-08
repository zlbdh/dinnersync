import {
  restoreSession,
  snapshotSession,
} from "@/modules/cooking-session";

import { buildDinnerPlan } from "./build-plan";
import { createDinnerPlannerState, dinnerPlannerReducer } from "./reducer";
import {
  markValidatedDinnerPlannerState,
  validDinnerPlanSettings,
  validRecipeReviewStates,
} from "./snapshot-validation";
import type {
  DinnerPlan,
  DinnerPlannerPersistence,
  DinnerPlannerPersistenceSeed,
  DinnerPlannerSnapshotV1,
  DinnerPlannerStage,
  DinnerPlannerState,
  DinnerPlannerStorageLike,
  DinnerPlannerWarning,
} from "./types";

const SNAPSHOT_KEYS = [
  "version",
  "revision",
  "stage",
  "settings",
  "reviewStates",
  "recipes",
  "nutrition",
  "scheduleRequest",
  "schedule",
  "session",
] as const;
const STAGES = new Set<DinnerPlannerStage>([
  "setup", "review", "plan", "cook", "summary",
]);
const MAX_SERIALIZED_SNAPSHOT_CHARS = 4 * 1024 * 1024;
const REVISION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORAGE_WARNING: DinnerPlannerWarning = {
  category: "storage",
  code: "STORAGE_UNAVAILABLE",
  message: "Browser storage is unavailable. This plan is stored in memory only.",
};
const RECOVERY_WARNING: DinnerPlannerWarning = {
  category: "storage",
  code: "SNAPSHOT_RECOVERED",
  message: "Invalid planning data was safely reset.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function addWarning(
  state: DinnerPlannerState,
  warning: DinnerPlannerWarning,
) {
  if (state.warnings.some((entry) => entry.code === warning.code)) return state;
  return { ...state, warnings: [...state.warnings, structuredClone(warning)] };
}

function fresh(seed: DinnerPlannerPersistenceSeed) {
  return createDinnerPlannerState(
    structuredClone(seed.settings),
    structuredClone(seed.reviewStates),
  );
}

function reset(seed: DinnerPlannerPersistenceSeed) {
  return addWarning(fresh(seed), RECOVERY_WARNING);
}

function parseSnapshot(serialized: string): DinnerPlannerSnapshotV1 | null {
  if (serialized.length > MAX_SERIALIZED_SNAPSHOT_CHARS) return null;
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value) || !exactKeys(value, SNAPSHOT_KEYS)
      || value.version !== 1
      || (value.revision !== null
        && (typeof value.revision !== "string" || !REVISION_PATTERN.test(value.revision)))
      || !STAGES.has(value.stage as DinnerPlannerStage)
      || !validDinnerPlanSettings(value.settings)
      || !validRecipeReviewStates(value.reviewStates)
      || !Array.isArray(value.recipes)) return null;
    return value as DinnerPlannerSnapshotV1;
  } catch {
    return null;
  }
}

function hasStoredPlan(snapshot: DinnerPlannerSnapshotV1) {
  const values = [snapshot.nutrition, snapshot.scheduleRequest, snapshot.schedule];
  const allPresent = values.every((value) => value !== null);
  const allMissing = values.every((value) => value === null)
    && snapshot.recipes.length === 0;
  return { allPresent, allMissing };
}

function recomputePlan(
  snapshot: DinnerPlannerSnapshotV1,
  seed: DinnerPlannerPersistenceSeed,
): DinnerPlan | null | false {
  const stored = hasStoredPlan(snapshot);
  if (stored.allMissing) return null;
  if (!stored.allPresent) return false;
  let result;
  try {
    result = buildDinnerPlan({
      settings: snapshot.settings,
      reviewStates: snapshot.reviewStates,
      nutritionCatalog: seed.nutritionCatalog,
    });
  } catch {
    return false;
  }
  if (!result.ok) return false;
  const plan = result.value;
  return sameJson(snapshot.recipes, plan.recipes)
    && sameJson(snapshot.nutrition, plan.nutrition)
    && sameJson(snapshot.scheduleRequest, plan.scheduleRequest)
    && sameJson(snapshot.schedule, plan.schedule)
    ? plan : false;
}

function hasReachableSnapshotShape(snapshot: DinnerPlannerSnapshotV1) {
  if (snapshot.stage !== "setup" && snapshot.reviewStates.length === 0) return false;
  const stored = hasStoredPlan(snapshot);
  if (snapshot.stage === "setup" || snapshot.stage === "review") {
    return stored.allMissing && snapshot.session === null;
  }
  if (snapshot.stage === "plan") {
    return stored.allPresent && snapshot.session === null;
  }
  return stored.allPresent && snapshot.session !== null;
}

function restoreValid(
  snapshot: DinnerPlannerSnapshotV1,
  seed: DinnerPlannerPersistenceSeed,
  now: string,
): DinnerPlannerState | null {
  if (!hasReachableSnapshotShape(snapshot)) return null;
  const plan = recomputePlan(snapshot, seed);
  if (plan === false) return null;
  const noPlanStage = snapshot.stage === "setup" || snapshot.stage === "review";
  if ((plan === null) !== noPlanStage) return null;
  let state = createDinnerPlannerState(snapshot.settings, snapshot.reviewStates);
  state = { ...state, stage: snapshot.stage };
  if (plan) {
    state = { ...state, stage: "review" };
    state = dinnerPlannerReducer(state, { type: "PLAN_BUILT", plan });
    state = { ...state, stage: snapshot.stage };
  }

  if (snapshot.session === null) {
    return snapshot.stage === "cook" || snapshot.stage === "summary"
      ? null : state;
  }
  if (!plan || !plan.schedule.feasible
    || (snapshot.stage !== "cook" && snapshot.stage !== "summary")
    || !isRecord(snapshot.session)
    || !sameJson(snapshot.session.request, plan.scheduleRequest)
    || !sameJson(snapshot.session.initialSchedule, plan.schedule)) return null;
  const session = restoreSession(
    JSON.stringify(snapshot.session),
    { request: plan.scheduleRequest, initialSchedule: plan.schedule },
    now,
  );
  if (session.warnings.some((warning) => warning.code === "SNAPSHOT_RECOVERED")) {
    return null;
  }
  const runtime = Object.values(session.runtime);
  if (snapshot.stage === "summary"
    && (runtime.length === 0 || runtime.some((task) => task.status !== "completed"))) {
    return null;
  }
  return { ...state, session };
}

export function snapshotDinnerPlanner(
  state: DinnerPlannerState,
  revision: string | null = null,
): DinnerPlannerSnapshotV1 {
  if (revision !== null && !REVISION_PATTERN.test(revision)) {
    throw new Error("Planner persistence revision must be a UUID v4.");
  }
  return structuredClone({
    version: 1,
    revision,
    stage: state.stage,
    settings: state.settings,
    reviewStates: state.reviewStates,
    recipes: state.plan?.recipes ?? [],
    nutrition: state.plan?.nutrition ?? null,
    scheduleRequest: state.plan?.scheduleRequest ?? null,
    schedule: state.plan?.schedule ?? null,
    session: state.session ? snapshotSession(state.session) : null,
  });
}

export function serializeDinnerPlanner(
  state: DinnerPlannerState,
  revision: string | null = null,
) {
  return JSON.stringify(snapshotDinnerPlanner(state, revision));
}

export function readDinnerPlannerRevision(serialized: string | null) {
  if (serialized === null) return null;
  return parseSnapshot(serialized)?.revision ?? null;
}

export function restoreDinnerPlanner(
  serialized: string | null,
  seed: DinnerPlannerPersistenceSeed,
  now: string,
): DinnerPlannerState {
  if (serialized === null) return markValidatedDinnerPlannerState(fresh(seed));
  const snapshot = parseSnapshot(serialized);
  if (!snapshot) return markValidatedDinnerPlannerState(reset(seed));
  try {
    return markValidatedDinnerPlannerState(
      restoreValid(snapshot, seed, now) ?? reset(seed),
    );
  } catch {
    return markValidatedDinnerPlannerState(reset(seed));
  }
}

export function createDinnerPlannerPersistence(
  key: string,
  getStorage: () => DinnerPlannerStorageLike | null = () => globalThis.localStorage,
): DinnerPlannerPersistence {
  let memory: string | null = null;
  let unavailable = false;
  const accessStorage = () => {
    if (unavailable) return null;
    try {
      const storage = getStorage();
      if (!storage || typeof storage.getItem !== "function"
        || typeof storage.setItem !== "function") {
        unavailable = true;
        return null;
      }
      return storage;
    } catch {
      unavailable = true;
      return null;
    }
  };
  const warn = (state: DinnerPlannerState) =>
    unavailable ? addWarning(state, STORAGE_WARNING) : state;
  return {
    save(state, revision = null) {
      memory = serializeDinnerPlanner(state, revision);
      const storage = accessStorage();
      if (storage) {
        try {
          storage.setItem(key, memory);
        } catch {
          unavailable = true;
        }
      }
      return warn(state);
    },
    restore(seed, now) {
      let serialized = memory;
      const storage = accessStorage();
      if (storage) {
        try {
          serialized = storage.getItem(key) ?? memory;
        } catch {
          unavailable = true;
        }
      }
      return warn(restoreDinnerPlanner(serialized, seed, now));
    },
  };
}
