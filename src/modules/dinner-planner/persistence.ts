import {
  restoreSession,
  snapshotSession,
} from "@/modules/cooking-session";

import { buildDinnerPlan } from "./build-plan";
import { createDinnerPlannerState, dinnerPlannerReducer } from "./reducer";
import {
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
const STORAGE_WARNING: DinnerPlannerWarning = {
  category: "storage",
  code: "STORAGE_UNAVAILABLE",
  message: "浏览器存储不可用，本次规划已降级为内存保存。",
};
const RECOVERY_WARNING: DinnerPlannerWarning = {
  category: "storage",
  code: "SNAPSHOT_RECOVERED",
  message: "规划数据无效，已安全重置。",
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
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value) || !exactKeys(value, SNAPSHOT_KEYS)
      || value.version !== 1 || !STAGES.has(value.stage as DinnerPlannerStage)
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

function restoreValid(
  snapshot: DinnerPlannerSnapshotV1,
  seed: DinnerPlannerPersistenceSeed,
  now: string,
): DinnerPlannerState | null {
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
): DinnerPlannerSnapshotV1 {
  return structuredClone({
    version: 1,
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

export function serializeDinnerPlanner(state: DinnerPlannerState) {
  return JSON.stringify(snapshotDinnerPlanner(state));
}

export function restoreDinnerPlanner(
  serialized: string | null,
  seed: DinnerPlannerPersistenceSeed,
  now: string,
): DinnerPlannerState {
  if (serialized === null) return fresh(seed);
  const snapshot = parseSnapshot(serialized);
  if (!snapshot) return reset(seed);
  try {
    return restoreValid(snapshot, seed, now) ?? reset(seed);
  } catch {
    return reset(seed);
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
    save(state) {
      memory = serializeDinnerPlanner(state);
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
