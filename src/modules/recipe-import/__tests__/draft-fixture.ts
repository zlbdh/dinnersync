type ReviewOverrides = Partial<{
  value: unknown;
  provenance: "source" | "inferred";
  evidence: { start: number; end: number; text: string } | null;
  inferenceReason: string | null;
  confidence: number;
  status: "needs-review" | "confirmed";
}>;

export const RECIPE_SOURCE = [
  "Quick Tomato Pasta (serves 2)",
  "Use 200 g dry pasta and 150 g tomato sauce.",
  "Boil the pasta for 10 minutes, then warm and combine the sauce for 5 minutes.",
].join("\n");

export function sourceReview(value: unknown, text: string, overrides: ReviewOverrides = {}) {
  const start = RECIPE_SOURCE.indexOf(text);
  if (start < 0) throw new Error(`Fixture text not found: ${text}`);
  return {
    value,
    provenance: "source" as const,
    evidence: { start, end: start + text.length, text },
    inferenceReason: null,
    confidence: 0.96,
    status: "needs-review" as const,
    ...overrides,
  };
}

export function inferredReview(value: unknown, reason = "Derived from the recipe wording") {
  return {
    value,
    provenance: "inferred" as const,
    evidence: null,
    inferenceReason: reason,
    confidence: 0.72,
    status: "needs-review" as const,
  };
}

export function makeAiDraft() {
  return {
    id: "recipe-1",
    sourceText: RECIPE_SOURCE,
    name: sourceReview("Quick Tomato Pasta", "Quick Tomato Pasta"),
    sourceServings: sourceReview(2, "serves 2"),
    ingredients: [
      {
        id: "ingredient-pasta",
        sourceText: RECIPE_SOURCE,
        name: sourceReview("dry pasta", "dry pasta"),
        quantity: sourceReview(200, "200"),
        unit: sourceReview("g", "g dry pasta"),
        foodState: sourceReview("raw", "dry pasta"),
      },
      {
        id: "ingredient-sauce",
        sourceText: RECIPE_SOURCE,
        name: sourceReview("tomato sauce", "tomato sauce"),
        quantity: sourceReview(150, "150"),
        unit: sourceReview("g", "g tomato sauce"),
        foodState: inferredReview("cooked", "Sauce is described as ready to warm"),
      },
    ],
    steps: [
      {
        id: "step-boil",
        sourceText: RECIPE_SOURCE,
        instruction: sourceReview("Boil the pasta", "Boil the pasta"),
        durationMinutes: sourceReview(10, "10 minutes"),
        mode: inferredReview("passive", "Boiling mainly waits after setup"),
        dependsOn: inferredReview([], "This is the first cooking step"),
        resources: inferredReview(
          [{ resourceId: "burner:1" }],
          "Boiling uses one burner",
        ),
        ovenOperation: inferredReview(null, "No oven operation is described"),
        ovenTemperatureC: inferredReview(null, "No oven temperature is described"),
        isTerminal: inferredReview(false, "A combine step follows"),
      },
      {
        id: "step-combine",
        sourceText: RECIPE_SOURCE,
        instruction: sourceReview("warm and combine the sauce", "warm and combine the sauce"),
        durationMinutes: sourceReview(5, "5 minutes"),
        mode: inferredReview("active", "Combining needs active attention"),
        dependsOn: inferredReview(["step-boil"], "The pasta must be boiled first"),
        resources: inferredReview(
          [{ resourceId: "burner:1" }],
          "Warming uses one burner",
        ),
        ovenOperation: inferredReview(null, "No oven operation is described"),
        ovenTemperatureC: inferredReview(null, "No oven temperature is described"),
        isTerminal: inferredReview(true, "This is the final recipe step"),
      },
    ],
  };
}

export function confirmEveryReviewValue<T>(value: T): T {
  const clone = structuredClone(value);
  const visit = (entry: unknown) => {
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    if (typeof entry !== "object" || entry === null) return;
    const record = entry as Record<string, unknown>;
    if ("provenance" in record && "status" in record && "value" in record) {
      record.status = "confirmed";
      return;
    }
    Object.values(record).forEach(visit);
  };
  visit(clone);
  return clone;
}
