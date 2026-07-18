import type {
  CookingSessionState,
  SessionSnapshotV1,
} from "@/modules/cooking-session";
import type { NutritionRecord, NutritionSummary } from "@/modules/nutrition";
import type {
  Recipe,
  RecipeReviewAction,
  RecipeReviewState,
} from "@/modules/recipe-import";
import type {
  ScheduleRequest,
  ScheduleResult,
} from "@/modules/scheduling";
import type { IsoInstant, KitchenResources, Result } from "@/shared";

export type DinnerPlannerStage = "setup" | "review" | "plan" | "cook" | "summary";

export type DinnerPlannerErrorCategory =
  | "field"
  | "review"
  | "nutrition"
  | "schedule"
  | "storage"
  | "ai";

export type DinnerPlannerError = {
  category: DinnerPlannerErrorCategory;
  code: string;
  message: string;
  path?: string;
};

export type DinnerPlannerWarning = {
  category: "storage";
  code: "STORAGE_UNAVAILABLE" | "SNAPSHOT_RECOVERED";
  message: string;
};

export type DinnerPlanSettings = {
  diners: number;
  availableFrom: IsoInstant;
  serveAt: IsoInstant;
  targetKcalPerPerson: number | null;
  kitchen: KitchenResources;
  serveToleranceMinutes: 5;
};

export type DinnerPlan = {
  recipes: Recipe[];
  nutrition: NutritionSummary;
  scheduleRequest: ScheduleRequest;
  schedule: ScheduleResult;
};

export type BuildDinnerPlanInput = {
  settings: DinnerPlanSettings;
  reviewStates: readonly RecipeReviewState[];
  nutritionCatalog: readonly NutritionRecord[];
};

export type BuildDinnerPlanResult = Result<DinnerPlan, DinnerPlannerError[]>;

export type DinnerPlannerState = {
  stage: DinnerPlannerStage;
  settings: DinnerPlanSettings;
  reviewStates: RecipeReviewState[];
  plan: DinnerPlan | null;
  session: CookingSessionState | null;
  errors: DinnerPlannerError[];
  warnings: DinnerPlannerWarning[];
};

export type DinnerPlannerAction =
  | {
    type: "REVIEW_CHANGED";
    recipeId: string;
    action: RecipeReviewAction;
  }
  | { type: "SETTINGS_CHANGED"; settings: Partial<DinnerPlanSettings> }
  | { type: "PLAN_BUILT"; plan: DinnerPlan }
  | { type: "SESSION_STARTED"; session: CookingSessionState }
  | { type: "STAGE_CHANGED"; stage: DinnerPlannerStage }
  | { type: "ERRORS_CHANGED"; errors: DinnerPlannerError[] }
  | { type: "STORAGE_WARNING"; warning: DinnerPlannerWarning }
  | { type: "RESET"; settings: DinnerPlanSettings; reviewStates: RecipeReviewState[] };

export type DinnerPlannerSnapshotV1 = {
  version: 1;
  stage: DinnerPlannerStage;
  settings: DinnerPlanSettings;
  reviewStates: RecipeReviewState[];
  recipes: Recipe[];
  nutrition: NutritionSummary | null;
  scheduleRequest: ScheduleRequest | null;
  schedule: ScheduleResult | null;
  session: SessionSnapshotV1 | null;
};

export type DinnerPlannerPersistenceSeed = {
  settings: DinnerPlanSettings;
  reviewStates: readonly RecipeReviewState[];
  nutritionCatalog: readonly NutritionRecord[];
};

export type DinnerPlannerStorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type DinnerPlannerPersistence = {
  save(state: DinnerPlannerState): DinnerPlannerState;
  restore(
    seed: DinnerPlannerPersistenceSeed,
    now: IsoInstant,
  ): DinnerPlannerState;
};
