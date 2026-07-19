// @vitest-environment node

import { describe, expect, test } from "vitest";

import {
  aiRecipeDraftJsonSchema,
  parseAiRecipeDraft,
} from "@/modules/recipe-import";
import type {
  RecipeDraft,
  ReviewValue,
} from "@/modules/recipe-import";
import {
  runCodexImport,
} from "@/modules/recipe-import/codex-import";
import { VERIFIED_CODEX_MODELS } from "@/modules/recipe-import/codex-types";
import type {
  CodexRunRequest,
  VerifiedCodexModel,
} from "@/modules/recipe-import/codex-types";

const ORIGINAL_RECIPE = [
  "Pantry Tomato Toast (serves 1)",
  "Ingredients: 1 slice bread; 2 tbsp tomato spread.",
  "Toast the bread for 4 minutes. Spread the tomato over the toast for 1 minute.",
].join("\n");
const RUN_REAL_CODEX = process.env.RUN_REAL_CODEX === "1";
const REAL_TEST_TIMEOUT_MS = 150_000;

type Runner = {
  run<T>(request: CodexRunRequest<T>): Promise<T>;
};

function sourceReview<T>(value: T, text: string): ReviewValue<T> {
  const start = ORIGINAL_RECIPE.indexOf(text);
  if (start < 0) throw new Error("Test fixture evidence is absent from its root source.");
  return {
    value,
    provenance: "source",
    evidence: { start, end: start + text.length, text },
    inferenceReason: null,
    confidence: 0.95,
    status: "needs-review",
  };
}

function inferredReview<T>(value: T, inferenceReason: string): ReviewValue<T> {
  return {
    value,
    provenance: "inferred",
    evidence: null,
    inferenceReason,
    confidence: 0.7,
    status: "needs-review",
  };
}

function fakeDraft(): RecipeDraft {
  return {
    id: "pantry-tomato-toast",
    sourceText: ORIGINAL_RECIPE,
    name: sourceReview("Pantry Tomato Toast", "Pantry Tomato Toast"),
    sourceServings: sourceReview(1, "serves 1"),
    ingredients: [
      {
        id: "bread",
        sourceText: ORIGINAL_RECIPE,
        name: sourceReview("bread", "bread"),
        quantity: sourceReview(1, "1 slice"),
        unit: sourceReview("slice", "slice"),
        foodState: inferredReview("cooked", "Bread is prepared by toasting"),
      },
      {
        id: "tomato-spread",
        sourceText: ORIGINAL_RECIPE,
        name: sourceReview("tomato spread", "tomato spread"),
        quantity: sourceReview(2, "2 tbsp"),
        unit: sourceReview("tbsp", "tbsp"),
        foodState: inferredReview(null, "The spread's food state is not explicit"),
      },
    ],
    steps: [
      {
        id: "toast-bread",
        sourceText: ORIGINAL_RECIPE,
        instruction: sourceReview("Toast the bread", "Toast the bread"),
        durationMinutes: sourceReview(4, "4 minutes"),
        mode: inferredReview("passive", "Toasting mainly waits after setup"),
        dependsOn: inferredReview([], "This is the first step"),
        resources: inferredReview(
          [{ resourceId: "oven:1" }],
          "Toasting requires the available oven",
        ),
        ovenOperation: inferredReview("cook", "The instruction says to toast"),
        ovenTemperatureC: inferredReview(null, "No oven temperature is stated"),
        isTerminal: inferredReview(false, "A spreading step follows"),
      },
      {
        id: "spread-tomato",
        sourceText: ORIGINAL_RECIPE,
        instruction: sourceReview(
          "Spread the tomato over the toast",
          "Spread the tomato over the toast",
        ),
        durationMinutes: sourceReview(1, "1 minute"),
        mode: inferredReview("active", "Spreading requires active attention"),
        dependsOn: inferredReview(["toast-bread"], "The bread must be toasted first"),
        resources: inferredReview([], "No limited appliance is required"),
        ovenOperation: inferredReview(null, "This step does not use the oven"),
        ovenTemperatureC: inferredReview(null, "This step has no oven temperature"),
        isTerminal: inferredReview(true, "This is the final step"),
      },
    ],
  };
}

function validateModelDraft(value: unknown): RecipeDraft {
  const result = parseAiRecipeDraft(value, ORIGINAL_RECIPE);
  if (!result.ok) {
    throw new Error(`RecipeDraft contract failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function recipeRequest(model: VerifiedCodexModel): CodexRunRequest<RecipeDraft> {
  return {
    model,
    schema: aiRecipeDraftJsonSchema,
    validate: validateModelDraft,
    timeoutMs: 120_000,
    maxOutputBytes: 262_144,
    prompt: [
      "Extract exactly one RecipeDraft from the original English recipe below.",
      "Return only JSON matching the supplied schema. Do not call tools.",
      "Every status must be needs-review. Never output calories, kcal, or nutrition IDs.",
      "Copy the entire original recipe into root and every nested sourceText.",
      "Source evidence uses JavaScript UTF-16 half-open offsets into that root sourceText.",
      "Inferred values have null evidence and a specific non-blank inferenceReason.",
      "ORIGINAL RECIPE:",
      ORIGINAL_RECIPE,
    ].join("\n"),
  };
}

function allReviews(value: unknown): ReviewValue<unknown>[] {
  const found: ReviewValue<unknown>[] = [];
  const visit = (entry: unknown) => {
    if (Array.isArray(entry)) return entry.forEach(visit);
    if (typeof entry !== "object" || entry === null) return;
    const record = entry as Record<string, unknown>;
    if (["value", "provenance", "evidence", "inferenceReason", "confidence", "status"]
      .every((key) => key in record)) {
      found.push(entry as ReviewValue<unknown>);
      return;
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  return found;
}

function assertBusinessContract(draft: RecipeDraft) {
  expect(draft.sourceText).toBe(ORIGINAL_RECIPE);
  const reviews = allReviews(draft);
  expect(reviews.length).toBeGreaterThan(0);
  expect(reviews.every((review) => review.status === "needs-review")).toBe(true);
  reviews.forEach((review) => {
    if (review.provenance === "source") {
      expect(review.evidence).not.toBeNull();
      if (review.evidence) {
        expect(draft.sourceText.slice(review.evidence.start, review.evidence.end))
          .toBe(review.evidence.text);
      }
      expect(review.inferenceReason).toBeNull();
    } else {
      expect(review.evidence).toBeNull();
      expect(review.inferenceReason?.trim().length).toBeGreaterThan(0);
    }
  });
  expect(JSON.stringify(draft)).not.toMatch(/kcal|nutritionRefId/i);
}

function explicitModel(): VerifiedCodexModel {
  const model = process.env.DINNERSYNC_CODEX_MODEL;
  if (!model || !VERIFIED_CODEX_MODELS.includes(model as VerifiedCodexModel)) {
    throw new Error("Set DINNERSYNC_CODEX_MODEL to one exact verified model ID.");
  }
  return model as VerifiedCodexModel;
}

describe("RecipeDraft Codex business gate", () => {
  test("wires the exact model, strict schema, validator, and bounded request", async () => {
    let captured: CodexRunRequest<unknown> | undefined;
    const runner: Runner = {
      run: async <T,>(request: CodexRunRequest<T>) => {
        captured = request as CodexRunRequest<unknown>;
        return request.validate(fakeDraft());
      },
    };
    const draft = await runner.run(recipeRequest("gpt-5.6-terra"));

    expect(captured?.model).toBe("gpt-5.6-terra");
    expect(captured?.schema).toBe(aiRecipeDraftJsonSchema);
    expect(captured?.timeoutMs).toBe(120_000);
    expect(captured?.prompt).toContain(ORIGINAL_RECIPE);
    assertBusinessContract(draft);
  });

  const realTest = RUN_REAL_CODEX ? test : test.skip;
  realTest(
    "REAL CODEX: validates one original recipe without fallback or fabricated PASS",
    { timeout: REAL_TEST_TIMEOUT_MS },
    async () => {
      const model = explicitModel();
      const result = await runCodexImport({
        recipes: [ORIGINAL_RECIPE],
        model,
        timeoutMs: 120_000,
      });
      expect(model).toBe(process.env.DINNERSYNC_CODEX_MODEL);
      if (!result.ok) throw new Error(`Real Codex gate failed safely: ${result.error.code}`);
      expect(result.ok).toBe(true);
      expect(result.value).toMatchObject({
        provider: "openai-codex-cli",
        model,
        schemaValidated: true,
        evidenceValidated: true,
      });
      expect(result.value.drafts).toHaveLength(1);
      assertBusinessContract(result.value.drafts[0]);
    },
  );
});
