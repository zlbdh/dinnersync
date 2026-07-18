import type {
  CookingStepDraft,
  FoodState,
  IngredientDraft,
  RecipeDraft,
  RecipeReviewState,
  ReviewValue,
} from "@/modules/recipe-import";
import type { ResourceRequirement } from "@/shared";

import { CHICKEN_SOURCE, RICE_SOURCE, VEGETABLE_SOURCE } from "./source-recipes";

type IngredientSeed = readonly [
  id: string,
  name: string,
  quantity: number,
  evidence: string,
  foodState: FoodState,
  stateEvidence: string | null,
];

type StepSeed = {
  id: string;
  instruction: string;
  evidence: string;
  duration: number;
  mode: "active" | "passive";
  dependsOn: string[];
  resources: ResourceRequirement[];
  ovenOperation: "preheat" | "cook" | null;
  ovenTemperatureC: number | null;
  terminal: boolean;
};

function sourceValue<T>(
  source: string,
  value: T,
  evidenceText: string,
  fromIndex = 0,
): ReviewValue<T> {
  const start = source.indexOf(evidenceText, fromIndex);
  if (start < 0) throw new Error(`Demo evidence not found: ${evidenceText}`);
  return {
    value,
    provenance: "source",
    evidence: { start, end: start + evidenceText.length, text: evidenceText },
    inferenceReason: null,
    confidence: 1,
    status: "needs-review",
  };
}

function inferredValue<T>(value: T, reason: string): ReviewValue<T> {
  return {
    value,
    provenance: "inferred",
    evidence: null,
    inferenceReason: reason,
    confidence: 0.9,
    status: "needs-review",
  };
}

function ingredient(source: string, seed: IngredientSeed): IngredientDraft {
  const [id, name, quantity, evidence, foodState, stateEvidence] = seed;
  const ingredientStart = source.indexOf(evidence);
  const lineStart = source.lastIndexOf("\n", ingredientStart) + 1;
  const lineEnd = source.indexOf("\n", ingredientStart);
  const amountText = `${quantity} g`;
  const amount = sourceValue(source, quantity, amountText, lineStart);
  if (amount.evidence && lineEnd >= 0 && amount.evidence.end > lineEnd) {
    throw new Error(`Demo amount is not on the ${id} ingredient line.`);
  }
  return {
    id,
    sourceText: source,
    name: sourceValue(source, name, evidence),
    quantity: amount,
    unit: sourceValue(source, "g", amountText, lineStart),
    foodState: stateEvidence
      ? sourceValue(source, foodState, stateEvidence)
      : inferredValue(foodState, `${name} is cataloged in its non-raw pantry state.`),
  };
}

function step(source: string, seed: StepSeed): CookingStepDraft {
  const instructionStart = source.indexOf(seed.evidence);
  const lineStart = source.lastIndexOf("\n", instructionStart) + 1;
  const nextLine = source.indexOf("\n", instructionStart);
  const lineEnd = nextLine < 0 ? source.length : nextLine;
  const inLine = <T>(value: T, evidenceText: string) => {
    const review = sourceValue(source, value, evidenceText, lineStart);
    if (review.evidence && review.evidence.end > lineEnd) {
      throw new Error(`Demo evidence is not on the ${seed.id} step line.`);
    }
    return review;
  };
  return {
    id: seed.id,
    sourceText: source,
    instruction: inLine(seed.instruction, seed.evidence),
    durationMinutes: inLine(seed.duration, `${seed.duration} minutes`),
    mode: inferredValue(seed.mode, "Mode follows whether continuous cook attention is required."),
    dependsOn: inferredValue(seed.dependsOn, "Dependencies preserve source order and joins."),
    resources: inferredValue(seed.resources, "Resources follow the named appliance or cooking action."),
    ovenOperation: inferredValue(seed.ovenOperation, "Oven operation follows the stated heating action."),
    ovenTemperatureC: seed.ovenTemperatureC === null
      ? inferredValue(null, "This step has no oven temperature.")
      : inLine(seed.ovenTemperatureC, `${seed.ovenTemperatureC} C`),
    isTerminal: seed.terminal
      ? inLine(true, "This is the final step.")
      : inferredValue(false, "A later recipe step follows."),
  };
}

function draft(
  id: RecipeDraft["id"],
  source: string,
  name: string,
  ingredientSeeds: IngredientSeed[],
  stepSeeds: StepSeed[],
): RecipeDraft {
  return {
    id,
    sourceText: source,
    name: sourceValue(source, name, name),
    sourceServings: sourceValue(source, 2, "Serves 2"),
    ingredients: ingredientSeeds.map((seed) => ingredient(source, seed)),
    steps: stepSeeds.map((seed) => step(source, seed)),
  };
}

const CHICKEN_DRAFT = draft(
  "lemon-herb-chicken",
  CHICKEN_SOURCE,
  "Lemon Herb Chicken",
  [
    ["chicken-breast", "chicken breast", 320, "raw boneless skinless chicken breast", "raw", "raw boneless skinless chicken breast"],
    ["chicken-oil", "olive oil", 13, "olive oil", "other", null],
    ["lemon-juice", "lemon juice", 30, "raw lemon juice", "raw", "raw lemon juice"],
    ["parsley", "parsley", 6, "raw parsley", "raw", "raw parsley"],
    ["chicken-garlic", "garlic", 6, "raw garlic", "raw", "raw garlic"],
  ],
  [
    { id: "chicken-preheat", instruction: "Heat the oven to 200 C", evidence: "Heat the oven to 200 C", duration: 10, mode: "passive", dependsOn: [], resources: [{ resourceId: "oven:1" }], ovenOperation: "preheat", ovenTemperatureC: 200, terminal: false },
    { id: "chicken-prep", instruction: "Coat the chicken and reserve the lemon mixture", evidence: "Coat the chicken with half the oil, parsley, and half the garlic; reserve the lemon juice and remaining oil for the pan sauce", duration: 6, mode: "active", dependsOn: [], resources: [], ovenOperation: null, ovenTemperatureC: null, terminal: false },
    { id: "chicken-roast", instruction: "Roast the chicken at 200 C", evidence: "Roast the chicken at 200 C", duration: 22, mode: "passive", dependsOn: ["chicken-preheat", "chicken-prep"], resources: [{ resourceId: "oven:1" }], ovenOperation: "cook", ovenTemperatureC: 200, terminal: false },
    { id: "chicken-sauce", instruction: "Warm the reserved lemon mixture on burner 2", evidence: "Warm the reserved lemon mixture on burner 2", duration: 4, mode: "active", dependsOn: ["chicken-prep"], resources: [{ resourceId: "burner:2" }], ovenOperation: null, ovenTemperatureC: null, terminal: false },
    { id: "chicken-finish", instruction: "Rest, slice, and spoon the warm mixture over the chicken", evidence: "Rest, slice, and spoon the warm mixture over the chicken", duration: 3, mode: "active", dependsOn: ["chicken-roast", "chicken-sauce"], resources: [], ovenOperation: null, ovenTemperatureC: null, terminal: true },
  ],
);

const VEGETABLE_DRAFT = draft(
  "roasted-garden-vegetables",
  VEGETABLE_SOURCE,
  "Roasted Garden Vegetables",
  [
    ["broccoli", "broccoli", 180, "raw broccoli florets", "raw", "raw broccoli florets"],
    ["red-pepper", "red bell pepper", 160, "raw red bell pepper", "raw", "raw red bell pepper"],
    ["sweet-onion", "sweet onion", 100, "raw sweet onion", "raw", "raw sweet onion"],
    ["veg-oil", "olive oil", 13, "olive oil", "other", null],
  ],
  [
    { id: "veg-prep", instruction: "Cut and toss the vegetables with the olive oil", evidence: "Cut and toss the vegetables with the olive oil", duration: 7, mode: "active", dependsOn: [], resources: [], ovenOperation: null, ovenTemperatureC: null, terminal: false },
    { id: "veg-roast", instruction: "Roast the vegetables at 200 C", evidence: "roast the vegetables at 200 C", duration: 20, mode: "passive", dependsOn: ["veg-prep", "chicken-preheat"], resources: [{ resourceId: "oven:1" }], ovenOperation: "cook", ovenTemperatureC: 200, terminal: false },
    { id: "veg-finish", instruction: "Transfer the vegetables to a serving bowl", evidence: "Transfer the vegetables to a serving bowl", duration: 2, mode: "active", dependsOn: ["veg-roast"], resources: [], ovenOperation: null, ovenTemperatureC: null, terminal: true },
  ],
);

const RICE_DRAFT = draft(
  "garlic-butter-rice",
  RICE_SOURCE,
  "Garlic Butter Rice",
  [
    ["dry-rice", "long-grain white rice", 122, "raw long-grain white rice", "raw", "raw long-grain white rice"],
    ["butter", "unsalted butter", 10, "unsalted butter", "other", null],
    ["rice-garlic", "garlic", 6, "raw garlic", "raw", "raw garlic"],
    ["water", "water", 320, "water", "other", null],
  ],
  [
    { id: "rice-toast", instruction: "Melt the butter with the garlic and stir in the rice on burner 1", evidence: "Melt the butter with the garlic and stir in the rice on burner 1", duration: 4, mode: "active", dependsOn: [], resources: [{ resourceId: "burner:1" }], ovenOperation: null, ovenTemperatureC: null, terminal: false },
    { id: "rice-simmer", instruction: "Add the water, cover, and simmer on burner 1", evidence: "Add the water, cover, and simmer on burner 1", duration: 18, mode: "passive", dependsOn: ["rice-toast"], resources: [{ resourceId: "burner:1" }], ovenOperation: null, ovenTemperatureC: null, terminal: false },
    { id: "rice-rest", instruction: "Move the covered pot off the burner and rest", evidence: "Move the covered pot off the burner and rest", duration: 5, mode: "passive", dependsOn: ["rice-simmer"], resources: [], ovenOperation: null, ovenTemperatureC: null, terminal: false },
    { id: "rice-fluff", instruction: "Fluff the rice", evidence: "Fluff the rice", duration: 2, mode: "active", dependsOn: ["rice-rest"], resources: [], ovenOperation: null, ovenTemperatureC: null, terminal: true },
  ],
);

export const DEMO_AI_DRAFTS: readonly RecipeDraft[] = [
  CHICKEN_DRAFT,
  VEGETABLE_DRAFT,
  RICE_DRAFT,
];

const NUTRITION_IDS: Record<string, string> = {
  "chicken-breast": "nutrition-chicken-breast-raw",
  "chicken-oil": "nutrition-olive-oil",
  "lemon-juice": "nutrition-lemon-juice-raw",
  parsley: "nutrition-parsley-raw",
  "chicken-garlic": "nutrition-garlic-raw",
  broccoli: "nutrition-broccoli-raw",
  "red-pepper": "nutrition-red-bell-pepper-raw",
  "sweet-onion": "nutrition-sweet-onion-raw",
  "veg-oil": "nutrition-olive-oil",
  "dry-rice": "nutrition-long-grain-rice-dry",
  butter: "nutrition-unsalted-butter",
  "rice-garlic": "nutrition-garlic-raw",
  water: "nutrition-water",
};

function confirmedState(source: RecipeDraft): RecipeReviewState {
  const draft = structuredClone(source);
  const confirm = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(confirm);
    if (typeof value !== "object" || value === null) return;
    const record = value as Record<string, unknown>;
    if ("provenance" in record && "value" in record && "status" in record) {
      record.status = "confirmed";
      return;
    }
    Object.values(record).forEach(confirm);
  };
  confirm(draft);
  return {
    draft,
    targetServings: 2,
    ingredientDecisions: draft.ingredients.map((entry) => ({
      ingredientId: entry.id,
      status: "used",
      sourceGrams: entry.quantity.value,
      plannedGrams: entry.quantity.value,
      nutritionRefId: NUTRITION_IDS[entry.id],
      nutritionMatchStatus: "confirmed",
    })),
  };
}

export const DEMO_REVIEW_STATES: readonly RecipeReviewState[] =
  DEMO_AI_DRAFTS.map(confirmedState);
