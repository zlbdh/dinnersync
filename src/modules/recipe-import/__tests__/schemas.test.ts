import { describe, expect, test } from "vitest";

import * as recipeImport from "../index";
import { makeAiDraft } from "./draft-fixture";

type SchemaApi = {
  aiRecipeDraftJsonSchema: Readonly<Record<string, unknown>>;
  aiRecipeDraftSchema: { safeParse(value: unknown): { success: boolean } };
  recipeDraftSchema: { safeParse(value: unknown): { success: boolean } };
};

const api = recipeImport as typeof recipeImport & SchemaApi;

function everyObjectIsClosed(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(everyObjectIsClosed);
  if (typeof value !== "object" || value === null) return true;
  const record = value as Record<string, unknown>;
  if (record.type === "object" && record.additionalProperties !== false) return false;
  return Object.values(record).every(everyObjectIsClosed);
}

describe("RecipeDraft AI schema", () => {
  test("exports a parseable strict schema", () => {
    expect(api.aiRecipeDraftSchema).toBeDefined();
    expect(api.aiRecipeDraftSchema.safeParse(makeAiDraft()).success).toBe(true);
  });

  test("emits recursively closed JSON Schema objects", () => {
    expect(api.aiRecipeDraftJsonSchema).toBeDefined();
    expect(everyObjectIsClosed(api.aiRecipeDraftJsonSchema)).toBe(true);
  });

  test.each([
    ["root kcal", (draft: ReturnType<typeof makeAiDraft>) => Object.assign(draft, { kcal: 500 })],
    ["ingredient nutrition id", (draft: ReturnType<typeof makeAiDraft>) =>
      Object.assign(draft.ingredients[0], { nutritionRefId: "model-invented" })],
    ["nested evidence key", (draft: ReturnType<typeof makeAiDraft>) =>
      Object.assign(draft.name.evidence as object, { excerptHost: "wrong" })],
    ["resource key", (draft: ReturnType<typeof makeAiDraft>) =>
      Object.assign((draft.steps[0].resources.value as object[])[0], { count: 1 })],
  ])("rejects unknown %s", (_name, mutate) => {
    const draft = makeAiDraft();
    mutate(draft);
    expect(api.aiRecipeDraftSchema.safeParse(draft).success).toBe(false);
  });

  test("requires every model field to remain needs-review", () => {
    const draft = makeAiDraft();
    (draft.steps[0].ovenTemperatureC as { status: string }).status = "confirmed";
    expect(api.aiRecipeDraftSchema.safeParse(draft).success).toBe(false);
  });

  test("allows confirmed values only in the local review schema", () => {
    const draft = makeAiDraft();
    draft.name.status = "confirmed";
    expect(api.recipeDraftSchema.safeParse(draft).success).toBe(true);
    expect(api.aiRecipeDraftSchema.safeParse(draft).success).toBe(false);
  });

  test("enforces source and inferred metadata invariants", () => {
    const sourceWithoutEvidence = makeAiDraft();
    sourceWithoutEvidence.name.evidence = null;
    const sourceWithEmptyEvidence = makeAiDraft();
    sourceWithEmptyEvidence.name.evidence = { start: 0, end: 0, text: "" };
    const inferredWithEvidence = makeAiDraft();
    (inferredWithEvidence.steps[0].mode as {
      evidence: { start: number; end: number; text: string } | null;
    }).evidence = { start: 0, end: 5, text: "Quick" };
    const inferredWithoutReason = makeAiDraft();
    inferredWithoutReason.steps[0].mode.inferenceReason = "  ";

    expect(api.aiRecipeDraftSchema.safeParse(sourceWithoutEvidence).success).toBe(false);
    expect(api.aiRecipeDraftSchema.safeParse(sourceWithEmptyEvidence).success).toBe(false);
    expect(api.aiRecipeDraftSchema.safeParse(inferredWithEvidence).success).toBe(false);
    expect(api.aiRecipeDraftSchema.safeParse(inferredWithoutReason).success).toBe(false);
  });

  test("rejects invalid confidence and minimally invalid domain values", () => {
    const lowConfidence = makeAiDraft();
    lowConfidence.name.confidence = -0.01;
    const infiniteConfidence = makeAiDraft();
    infiniteConfidence.name.confidence = Number.POSITIVE_INFINITY;
    const zeroDuration = makeAiDraft();
    zeroDuration.steps[0].durationMinutes.value = 0;
    const zeroQuantity = makeAiDraft();
    zeroQuantity.ingredients[0].quantity.value = 0;

    expect(api.aiRecipeDraftSchema.safeParse(lowConfidence).success).toBe(false);
    expect(api.aiRecipeDraftSchema.safeParse(infiniteConfidence).success).toBe(false);
    expect(api.aiRecipeDraftSchema.safeParse(zeroDuration).success).toBe(false);
    expect(api.aiRecipeDraftSchema.safeParse(zeroQuantity).success).toBe(false);
  });

  test("accepts nullable source servings and separate oven and food-state reviews", () => {
    const draft = makeAiDraft();
    draft.sourceServings.value = null;
    draft.sourceServings.provenance = "inferred";
    draft.sourceServings.evidence = null;
    draft.sourceServings.inferenceReason = "The source does not state a serving count";
    draft.ingredients[0].foodState.value = null;
    draft.ingredients[0].foodState.provenance = "inferred";
    draft.ingredients[0].foodState.evidence = null;
    draft.ingredients[0].foodState.inferenceReason = "State is not explicit";

    expect(api.aiRecipeDraftSchema.safeParse(draft).success).toBe(true);
  });
});
