import {
  advanceSessionTime,
  applySessionCommand,
} from "@/modules/cooking-session";
import type { CookingSessionState } from "@/modules/cooking-session";
import type { NutritionRecord } from "@/modules/nutrition";
import type { Recipe } from "@/modules/recipe-import";
import type { ScheduleRequest } from "@/modules/scheduling";

export const DEMO_SCENARIO = {
  diners: 2,
  availableFrom: "2026-07-18T18:00:00.000Z",
  serveAt: "2026-07-18T19:00:00.000Z",
  targetKcalPerPerson: 650,
  kitchen: { cooks: 1, ovens: 1, burners: 2 },
  serveToleranceMinutes: 5,
} as const;

const ACCESSED_AT = "2026-07-18";

function record(
  id: string,
  canonicalName: string,
  foodState: NutritionRecord["foodState"],
  kcalPer100g: number,
  fdcId: number,
  sourceVersion = `USDA FoodData Central SR Legacy, April 2018 final release, FDC ${fdcId}`,
): NutritionRecord {
  return {
    id,
    canonicalName,
    foodState,
    kcalPer100g,
    sourceUrl: `https://fdc.nal.usda.gov/fdc-app.html#/food-details/${fdcId}/nutrients`,
    sourceVersion,
    accessedAt: ACCESSED_AT,
  };
}

export const DEMO_NUTRITION_CATALOG: readonly NutritionRecord[] = [
  record("nutrition-chicken-breast-raw", "chicken breast", "raw", 120, 171077),
  record("nutrition-olive-oil", "olive oil", "other", 884, 171413),
  record("nutrition-lemon-juice-raw", "lemon juice", "raw", 22, 167747),
  record("nutrition-parsley-raw", "parsley", "raw", 36, 170416),
  record("nutrition-garlic-raw", "garlic", "raw", 149, 169230),
  record("nutrition-broccoli-raw", "broccoli", "raw", 34, 170379),
  record(
    "nutrition-red-bell-pepper-raw",
    "red bell pepper",
    "raw",
    31,
    2258590,
    "USDA FoodData Central Foundation Foods 2026-04, FDC 2258590; Energy (Atwater General Factors) 31.3256 kcal/100 g rounded to 31",
  ),
  record("nutrition-sweet-onion-raw", "sweet onion", "raw", 32, 170008),
  record("nutrition-long-grain-rice-dry", "long-grain white rice", "raw", 365, 169756),
  record("nutrition-unsalted-butter", "unsalted butter", "other", 717, 173430),
  record("nutrition-water", "water", "other", 0, 174158),
];

export function createDemoScheduleRequest(
  recipes: readonly Recipe[],
): ScheduleRequest {
  return {
    tasks: recipes.flatMap((recipe) => recipe.steps.map((task) => structuredClone(task))),
    kitchen: { ...DEMO_SCENARIO.kitchen },
    availableFrom: DEMO_SCENARIO.availableFrom,
    serveAt: DEMO_SCENARIO.serveAt,
    serveToleranceMinutes: DEMO_SCENARIO.serveToleranceMinutes,
  };
}

function start(
  state: CookingSessionState,
  taskId: string,
  at: string,
) {
  return applySessionCommand(advanceSessionTime(state, at), {
    type: "START",
    taskId,
    at,
  });
}

function complete(
  state: CookingSessionState,
  taskId: string,
  at: string,
) {
  return applySessionCommand(advanceSessionTime(state, at), {
    type: "COMPLETE",
    taskId,
    at,
  });
}

export function runDemoDelayScenario(
  initial: CookingSessionState,
): CookingSessionState {
  let state = start(initial, "chicken-preheat", "2026-07-18T18:06:00.000Z");
  state = start(state, "chicken-prep", "2026-07-18T18:10:00.000Z");
  state = complete(state, "chicken-preheat", "2026-07-18T18:16:00.000Z");
  state = complete(state, "chicken-prep", "2026-07-18T18:16:00.000Z");
  state = start(state, "chicken-roast", "2026-07-18T18:16:00.000Z");
  return applySessionCommand(state, {
    type: "DELAY",
    taskId: "chicken-roast",
    at: "2026-07-18T18:24:00.000Z",
    delayMinutes: 8,
  });
}
