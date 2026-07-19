import {
  advanceSessionTime,
  applySessionCommand,
} from "@/modules/cooking-session";
import { recipeReviewReducer } from "@/modules/recipe-import";
import type { RecipeReviewState } from "@/modules/recipe-import";
import type { ScheduleIssue } from "@/modules/scheduling";

import type {
  DinnerPlan,
  DinnerPlanSettings,
  DinnerPlannerAction,
  DinnerPlannerError,
  DinnerPlannerState,
} from "./types";
import { isValidatedDinnerPlannerState } from "./snapshot-validation";

function scheduleErrors(plan: DinnerPlan): DinnerPlannerError[] {
  if (plan.schedule.feasible) return [];
  return plan.schedule.issues.map((issue: ScheduleIssue) => ({
    category: "schedule",
    code: issue.code,
    message: issue.taskIds.length > 0
      ? `Scheduling issue affects: ${issue.taskIds.join(", ")}.`
      : "The requested dinner schedule is infeasible.",
  }));
}

function invalidated(state: DinnerPlannerState): DinnerPlannerState {
  return {
    ...state,
    stage: "review",
    plan: null,
    session: null,
    errors: [],
  };
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameSettings(left: DinnerPlanSettings, right: DinnerPlanSettings) {
  return left.diners === right.diners
    && left.availableFrom === right.availableFrom
    && left.serveAt === right.serveAt
    && left.targetKcalPerPerson === right.targetKcalPerPerson
    && left.serveToleranceMinutes === right.serveToleranceMinutes
    && left.kitchen.cooks === right.kitchen.cooks
    && left.kitchen.ovens === right.kitchen.ovens
    && left.kitchen.burners === right.kitchen.burners;
}

function canFinishCooking(state: DinnerPlannerState) {
  return state.session !== null
    && Object.keys(state.session.runtime).length > 0
    && Object.values(state.session.runtime).every((task) => task.status === "completed");
}

export function createDinnerPlannerState(
  settings: DinnerPlanSettings,
  reviewStates: readonly RecipeReviewState[],
): DinnerPlannerState {
  return {
    stage: "setup",
    settings: structuredClone(settings),
    reviewStates: reviewStates.map((review) => structuredClone(review)),
    plan: null,
    session: null,
    errors: [],
    warnings: [],
  };
}

export function dinnerPlannerReducer(
  state: DinnerPlannerState,
  action: DinnerPlannerAction,
): DinnerPlannerState {
  if (action.type === "VALIDATED_STATE_RESTORED") {
    return isValidatedDinnerPlannerState(action.state)
      ? structuredClone(action.state)
      : state;
  }
  if (action.type === "REVIEW_CHANGED") {
    const index = state.reviewStates.findIndex((entry) =>
      entry.draft.id === action.recipeId);
    if (index < 0) return state;
    const currentReview = state.reviewStates[index];
    const nextReview = recipeReviewReducer(currentReview, action.action);
    if (nextReview === currentReview) return state;
    const reviewStates = [...state.reviewStates];
    reviewStates[index] = nextReview;
    return invalidated({ ...state, reviewStates });
  }
  if (action.type === "SETTINGS_CHANGED") {
    const settings = {
      ...state.settings,
      ...structuredClone(action.settings),
      kitchen: action.settings.kitchen
        ? { ...action.settings.kitchen }
        : state.settings.kitchen,
    };
    if (sameSettings(settings, state.settings)) return state;
    const changed = { ...state, settings };
    return state.stage === "setup"
      ? { ...changed, plan: null, session: null, errors: [] }
      : invalidated(changed);
  }
  if (action.type === "PLAN_BUILT") {
    if (state.stage !== "review") return state;
    return {
      ...state,
      stage: "plan",
      plan: structuredClone(action.plan),
      session: null,
      errors: scheduleErrors(action.plan),
    };
  }
  if (action.type === "SESSION_STARTED") {
    if (state.stage !== "plan" || !state.plan || !state.plan.schedule.feasible
      || !sameJson(action.session.request, state.plan.scheduleRequest)
      || !sameJson(action.session.initialSchedule, state.plan.schedule)) return state;
    return { ...state, stage: "cook", session: structuredClone(action.session) };
  }
  if (action.type === "SESSION_COMMAND") {
    if (state.stage !== "cook" || state.session === null) return state;
    const advanced = advanceSessionTime(state.session, action.command.at);
    const session = applySessionCommand(advanced, action.command);
    if (session === state.session) return state;
    const next = { ...state, session };
    return canFinishCooking(next) ? { ...next, stage: "summary" } : next;
  }
  if (action.type === "SESSION_TIME_ADVANCED") {
    if (state.stage !== "cook" || state.session === null) return state;
    const session = advanceSessionTime(state.session, action.now);
    return session === state.session ? state : { ...state, session };
  }
  if (action.type === "STAGE_CHANGED") {
    if (state.stage === "setup" && action.stage === "review"
      && state.reviewStates.length > 0) {
      return {
        ...state,
        stage: "review",
        reviewStates: state.reviewStates.map((review) => structuredClone(review)),
      };
    }
    if (state.stage === "cook" && action.stage === "summary"
      && canFinishCooking(state)) return { ...state, stage: "summary" };
    return state;
  }
  if (action.type === "ERRORS_CHANGED") {
    return { ...state, errors: structuredClone(action.errors) };
  }
  if (action.type === "STORAGE_WARNING") {
    if (state.warnings.some((entry) => entry.code === action.warning.code)) return state;
    return { ...state, warnings: [...state.warnings, structuredClone(action.warning)] };
  }
  return createDinnerPlannerState(action.settings, action.reviewStates);
}
