import { calculateNutrition } from "@/modules/nutrition";
import { convertDraftToRecipe } from "@/modules/recipe-import";
import { scheduleDinner } from "@/modules/scheduling";

import type {
  BuildDinnerPlanInput,
  BuildDinnerPlanResult,
  DinnerPlanSettings,
  DinnerPlannerError,
} from "./types";

function fieldError(code: string, message: string): DinnerPlannerError {
  return { category: "field", code, message };
}

function settingsErrors(settings: DinnerPlanSettings): DinnerPlannerError[] {
  const errors: DinnerPlannerError[] = [];
  if (!Number.isSafeInteger(settings.diners) || settings.diners <= 0) {
    errors.push(fieldError("DINERS_INVALID", "Diners must be a positive safe integer."));
  }
  if (settings.targetKcalPerPerson !== null
    && (!Number.isFinite(settings.targetKcalPerPerson)
      || settings.targetKcalPerPerson <= 0)) {
    errors.push(fieldError("TARGET_KCAL_INVALID", "The calorie target must be positive."));
  }
  if (settings.serveToleranceMinutes !== 5) {
    errors.push(fieldError("SERVE_TOLERANCE_INVALID", "DinnerSync uses a five-minute window."));
  }
  return errors;
}

export function buildDinnerPlan(
  input: BuildDinnerPlanInput,
): BuildDinnerPlanResult {
  const errors = settingsErrors(input.settings);
  const recipes = input.reviewStates.flatMap((state) => {
    const converted = convertDraftToRecipe(state);
    if (converted.ok) return [converted.value];
    errors.push(...converted.error.map((entry): DinnerPlannerError => ({
      category: entry.code === "FIELD_NOT_CONFIRMED" ? "review" : "field",
      code: entry.code,
      message: entry.message,
      path: entry.path,
    })));
    return [];
  });
  if (errors.length > 0) return { ok: false, error: errors };

  let nutrition;
  try {
    nutrition = calculateNutrition({
      recipes,
      catalog: input.nutritionCatalog,
      diners: input.settings.diners,
      targetKcalPerPerson: input.settings.targetKcalPerPerson,
    });
  } catch (error) {
    return {
      ok: false,
      error: [{
        category: "nutrition",
        code: "NUTRITION_CALCULATION_FAILED",
        message: error instanceof Error ? error.message : "Nutrition calculation failed.",
      }],
    };
  }

  const scheduleRequest = {
    tasks: recipes.flatMap((recipe) => recipe.steps.map((task) => structuredClone(task))),
    kitchen: { ...input.settings.kitchen },
    availableFrom: input.settings.availableFrom,
    serveAt: input.settings.serveAt,
    serveToleranceMinutes: input.settings.serveToleranceMinutes,
  };
  return {
    ok: true,
    value: {
      recipes,
      nutrition,
      scheduleRequest,
      schedule: scheduleDinner(scheduleRequest),
    },
  };
}
