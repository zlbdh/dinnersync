import {
  convertDraftToRecipe,
  parseAiRecipeDraft,
  validateRecipeDraftEvidence,
} from "@/modules/recipe-import";
import { calculateNutrition, findNutritionCandidates } from "@/modules/nutrition";
import { scheduleDinner } from "@/modules/scheduling";
import { createCookingSession } from "@/modules/cooking-session";
import { describe, expect, it } from "vitest";

import {
  DEMO_AI_DRAFTS,
  DEMO_NUTRITION_CATALOG,
  DEMO_REVIEW_STATES,
  DEMO_SCENARIO,
  DEMO_SOURCE_RECIPES,
  createDemoScheduleRequest,
  runDemoDelayScenario,
} from "../index";

const APPROVED_SOURCES = [
  [
    "Lemon Herb Chicken",
    "Serves 2.",
    "Ingredients:",
    "- 320 g raw boneless skinless chicken breast",
    "- 13 g olive oil",
    "- 30 g raw lemon juice",
    "- 6 g raw parsley, chopped",
    "- 6 g raw garlic, minced",
    "Steps:",
    "1. Heat the oven to 200 C for 10 minutes.",
    "2. Coat the chicken with half the oil, parsley, and half the garlic; reserve the lemon juice and remaining oil for the pan sauce. Work for 6 minutes.",
    "3. Roast the chicken at 200 C for 22 minutes.",
    "4. Warm the reserved lemon mixture on burner 2 for 4 minutes.",
    "5. Rest, slice, and spoon the warm mixture over the chicken for 3 minutes. This is the final step.",
  ].join("\n"),
  [
    "Roasted Garden Vegetables",
    "Serves 2.",
    "Ingredients:",
    "- 180 g raw broccoli florets",
    "- 160 g raw red bell pepper",
    "- 100 g raw sweet onion",
    "- 13 g olive oil",
    "Steps:",
    "1. Cut and toss the vegetables with the olive oil for 7 minutes.",
    "2. After the oven reaches 200 C, roast the vegetables at 200 C for 20 minutes.",
    "3. Transfer the vegetables to a serving bowl for 2 minutes. This is the final step.",
  ].join("\n"),
  [
    "Garlic Butter Rice",
    "Serves 2.",
    "Ingredients:",
    "- 122 g raw long-grain white rice",
    "- 10 g unsalted butter",
    "- 6 g raw garlic, minced",
    "- 320 g water",
    "Steps:",
    "1. Melt the butter with the garlic and stir in the rice on burner 1 for 4 minutes.",
    "2. Add the water, cover, and simmer on burner 1 for 18 minutes.",
    "3. Move the covered pot off the burner and rest for 5 minutes.",
    "4. Fluff the rice for 2 minutes. This is the final step.",
  ].join("\n"),
] as const;

function everyReviewStatus(value: unknown, expected: string): boolean {
  if (Array.isArray(value)) return value.every((entry) => everyReviewStatus(entry, expected));
  if (typeof value !== "object" || value === null) return true;
  const record = value as Record<string, unknown>;
  if ("provenance" in record && "value" in record && "status" in record) {
    return record.status === expected;
  }
  return Object.values(record).every((entry) => everyReviewStatus(entry, expected));
}

function confirmedRecipes() {
  return DEMO_REVIEW_STATES.map((state) => {
    const result = convertDraftToRecipe(state);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    return result.value;
  });
}

describe("DinnerSync approved demo fixtures", () => {
  it("keeps the three approved original source texts verbatim", () => {
    expect(DEMO_SOURCE_RECIPES.map((recipe) => recipe.sourceText)).toEqual(APPROVED_SOURCES);
  });

  it("keeps every AI field needs-review and validates schema plus root evidence", () => {
    expect(DEMO_AI_DRAFTS).toHaveLength(3);
    DEMO_AI_DRAFTS.forEach((draft, index) => {
      expect(everyReviewStatus(draft, "needs-review")).toBe(true);
      expect(parseAiRecipeDraft(draft, APPROVED_SOURCES[index])).toEqual({
        ok: true,
        value: draft,
      });
      expect(validateRecipeDraftEvidence(draft).ok).toBe(true);
    });
  });

  it("anchors duplicate 6 g quantity and unit evidence to each ingredient line", () => {
    const chicken = DEMO_AI_DRAFTS[0];
    const parsley = chicken.ingredients.find((entry) => entry.id === "parsley")!;
    const garlic = chicken.ingredients.find((entry) => entry.id === "chicken-garlic")!;
    const amountStart = (name: string) => {
      const nameStart = chicken.sourceText.indexOf(name);
      const lineStart = chicken.sourceText.lastIndexOf("\n", nameStart) + 1;
      return chicken.sourceText.indexOf("6 g", lineStart);
    };
    const parsleyStart = amountStart("raw parsley");
    const garlicStart = amountStart("raw garlic");

    expect(parsley.quantity.evidence?.start).toBe(parsleyStart);
    expect(parsley.unit.evidence?.start).toBe(parsleyStart);
    expect(garlic.quantity.evidence?.start).toBe(garlicStart);
    expect(garlic.unit.evidence?.start).toBe(garlicStart);
    expect(garlicStart).not.toBe(parsleyStart);
  });

  it("anchors every source-provenance step field to that step's source line", () => {
    DEMO_AI_DRAFTS.forEach((draft) => draft.steps.forEach((step) => {
      const instruction = step.instruction.evidence!;
      const lineStart = draft.sourceText.lastIndexOf("\n", instruction.start) + 1;
      const nextLine = draft.sourceText.indexOf("\n", instruction.end);
      const lineEnd = nextLine < 0 ? draft.sourceText.length : nextLine;
      const reviews = [
        step.instruction,
        step.durationMinutes,
        step.mode,
        step.dependsOn,
        step.resources,
        step.ovenOperation,
        step.ovenTemperatureC,
        step.isTerminal,
      ];
      reviews.filter((review) => review.provenance === "source").forEach((review) => {
        expect(review.evidence!.start).toBeGreaterThanOrEqual(lineStart);
        expect(review.evidence!.end).toBeLessThanOrEqual(lineEnd);
      });
    }));

    const chicken = DEMO_AI_DRAFTS[0];
    const roast = chicken.steps.find((step) => step.id === "chicken-roast")!;
    const roastLine = chicken.sourceText.indexOf("3. Roast the chicken");
    expect(roast.ovenTemperatureC.evidence?.start)
      .toBe(chicken.sourceText.indexOf("200 C", roastLine));
    expect(roast.ovenTemperatureC.evidence?.start)
      .not.toBe(chicken.sourceText.indexOf("200 C"));
  });

  it("keeps the sauce independent from the rice so both burners can overlap", () => {
    const sauce = DEMO_AI_DRAFTS[0].steps.find((entry) =>
      entry.id === "chicken-sauce")!;
    expect(sauce.dependsOn.value).not.toContain("rice-simmer");
  });

  it("provides detached, fully confirmed review states with explicit nutrition decisions", () => {
    expect(DEMO_REVIEW_STATES).toHaveLength(3);
    DEMO_REVIEW_STATES.forEach((state, index) => {
      expect(state.draft).not.toBe(DEMO_AI_DRAFTS[index]);
      expect(everyReviewStatus(state.draft, "confirmed")).toBe(true);
      expect(state.ingredientDecisions).toHaveLength(state.draft.ingredients.length);
      expect(state.ingredientDecisions.every((decision) =>
        decision.status === "used"
        && decision.nutritionMatchStatus === "confirmed"
        && decision.nutritionRefId !== null)).toBe(true);
    });
    expect(everyReviewStatus(DEMO_AI_DRAFTS, "needs-review")).toBe(true);
  });

  it("backs every used nutrition decision with a name and food-state candidate", () => {
    DEMO_REVIEW_STATES.forEach((state) => {
      state.ingredientDecisions.filter((decision) => decision.status === "used")
        .forEach((decision) => {
          const ingredient = state.draft.ingredients.find((entry) =>
            entry.id === decision.ingredientId)!;
          const candidateIds = findNutritionCandidates(
            ingredient.name.value,
            DEMO_NUTRITION_CATALOG,
            ingredient.foodState.value ?? undefined,
          ).map((candidate) => candidate.record.id);
          expect(candidateIds).toContain(decision.nutritionRefId);
        });
    });
  });

  it("uses traceable catalog records and reproduces the approved 650 kcal totals", () => {
    expect(DEMO_NUTRITION_CATALOG).toHaveLength(11);
    expect(DEMO_AI_DRAFTS[1].ingredients).toContainEqual(expect.objectContaining({ id: "sweet-onion", name: expect.objectContaining({ value: "sweet onion" }) }));
    expect(DEMO_REVIEW_STATES[1].ingredientDecisions).toContainEqual(expect.objectContaining({ ingredientId: "sweet-onion", nutritionRefId: "nutrition-sweet-onion-raw" }));
    const expectedFdc = [
      ["nutrition-chicken-breast-raw", 171077], ["nutrition-olive-oil", 171413],
      ["nutrition-lemon-juice-raw", 167747], ["nutrition-parsley-raw", 170416],
      ["nutrition-garlic-raw", 169230], ["nutrition-broccoli-raw", 170379],
      ["nutrition-red-bell-pepper-raw", 2258590], ["nutrition-sweet-onion-raw", 170008],
      ["nutrition-long-grain-rice-dry", 169756], ["nutrition-unsalted-butter", 173430],
      ["nutrition-water", 174158],
    ] as const;
    const itemUrls = new Set<string>();
    const fdcIds = new Set<number>();
    expectedFdc.forEach(([id, fdcId]) => {
      const record = DEMO_NUTRITION_CATALOG.find((entry) => entry.id === id)!;
      const legacyVersion = `USDA FoodData Central SR Legacy, April 2018 final release, FDC ${fdcId}`;
      expect(record.sourceUrl).toBe(`https://fdc.nal.usda.gov/fdc-app.html#/food-details/${fdcId}/nutrients`);
      expect(record.sourceVersion).toBe(fdcId === 2258590
        ? "USDA FoodData Central Foundation Foods 2026-04, FDC 2258590; Energy (Atwater General Factors) 31.3256 kcal/100 g rounded to 31"
        : legacyVersion);
      expect(record.accessedAt).toBe("2026-07-18");
      itemUrls.add(record.sourceUrl);
      fdcIds.add(Number(record.sourceUrl.match(/food-details\/(\d+)\/nutrients$/)?.[1]));
    });
    expect(itemUrls.size).toBe(11);
    expect(fdcIds.size).toBe(11);
    expect([...itemUrls]).not.toContain("https://fdc.nal.usda.gov/");

    const summary = calculateNutrition({
      recipes: confirmedRecipes(),
      catalog: DEMO_NUTRITION_CATALOG,
      diners: DEMO_SCENARIO.diners,
      targetKcalPerPerson: DEMO_SCENARIO.targetKcalPerPerson,
    });
    expect(summary).toMatchObject({
      completeness: "complete",
      knownMealKcal: 1_300.28,
      knownKcalPerPerson: 650.14,
      estimatedMealKcal: 1_300.28,
      estimatedKcalPerPerson: 650.14,
      targetDeltaPerPerson: 0.14,
      recipeSummaries: [
        { recipeId: "lemon-herb-chicken", knownKcal: 516.62 },
        { recipeId: "roasted-garden-vegetables", knownKcal: 257.72 },
        { recipeId: "garlic-butter-rice", knownKcal: 525.94 },
      ],
    });
  });

  it("uses the real scheduler to produce the approved synchronized timeline", () => {
    expect(DEMO_SCENARIO).toEqual({
      diners: 2,
      availableFrom: "2026-07-18T18:00:00.000Z",
      serveAt: "2026-07-18T19:00:00.000Z",
      targetKcalPerPerson: 650,
      kitchen: { cooks: 1, ovens: 1, burners: 2 },
      serveToleranceMinutes: 5,
    });
    const request = createDemoScheduleRequest(confirmedRecipes());
    const result = scheduleDinner(request);
    expect(result.feasible).toBe(true);
    if (!result.feasible) return;
    const tasks = new Map(result.tasks.map((task) => [task.taskId, task]));
    expect(tasks.get("chicken-preheat")?.plannedStart).toBe("2026-07-18T18:06:00.000Z");
    expect(tasks.get("chicken-prep")?.plannedStart).toBe("2026-07-18T18:10:00.000Z");
    expect(tasks.get("chicken-roast")?.plannedStart).toBe("2026-07-18T18:16:00.000Z");
    expect(tasks.get("rice-toast")?.plannedStart).toBe("2026-07-18T18:27:00.000Z");
    expect(tasks.get("veg-prep")?.plannedStart).toBe("2026-07-18T18:31:00.000Z");
    expect(tasks.get("rice-simmer")?.plannedStart).toBe("2026-07-18T18:33:00.000Z");
    expect(tasks.get("veg-roast")?.plannedStart).toBe("2026-07-18T18:38:00.000Z");
    expect(tasks.get("chicken-sauce")?.plannedStart).toBe("2026-07-18T18:49:00.000Z");
    expect(tasks.get("chicken-finish")?.plannedEnd).toBe("2026-07-18T18:56:00.000Z");
    expect(tasks.get("rice-fluff")?.plannedEnd).toBe("2026-07-18T18:58:00.000Z");
    expect(tasks.get("veg-finish")?.plannedEnd).toBe("2026-07-18T19:00:00.000Z");
    const simmer = tasks.get("rice-simmer")!;
    const sauce = tasks.get("chicken-sauce")!;
    expect(Date.parse(simmer.plannedStart)).toBeLessThan(Date.parse(sauce.plannedEnd));
    expect(Date.parse(sauce.plannedStart)).toBeLessThan(Date.parse(simmer.plannedEnd));
    expect(simmer.effectiveResources).toEqual(["burner:1"]);
    expect(sauce.effectiveResources).toEqual(["cook:1", "burner:2"]);
  });

  it("dispatches the fixed +8 delay through the cooking-session API", () => {
    const request = createDemoScheduleRequest(confirmedRecipes());
    const schedule = scheduleDinner(request);
    expect(schedule.feasible).toBe(true);
    if (!schedule.feasible) return;
    const delayed = runDemoDelayScenario(createCookingSession(request, schedule));

    expect(delayed.runtime["chicken-roast"]).toMatchObject({
      status: "running",
      actualStart: "2026-07-18T18:16:00.000Z",
      expectedEnd: "2026-07-18T18:46:00.000Z",
    });
    expect(delayed.events).toContainEqual(expect.objectContaining({
      type: "TASK_DELAYED",
      taskId: "chicken-roast",
      at: "2026-07-18T18:24:00.000Z",
      delayMinutes: 8,
    }));
    expect(delayed.lastReplan).toMatchObject({
      feasible: false,
      earliestFeasible: { serveAt: "2026-07-18T19:08:00.000Z" },
    });
    expect(delayed.schedule.serveAt).toBe("2026-07-18T19:08:00.000Z");
    expect(delayed.schedule.tasks.find((task) => task.taskId === "chicken-roast")?.plannedEnd)
      .toBe("2026-07-18T18:38:00.000Z");
  });
});
