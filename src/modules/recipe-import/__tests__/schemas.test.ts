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

function unboundedSchemaPaths(value: unknown, path = "$", found: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => unboundedSchemaPaths(entry, `${path}[${index}]`, found));
    return found;
  }
  if (typeof value !== "object" || value === null) return found;
  const record = value as Record<string, unknown>;
  if (record.type === "array" && typeof record.maxItems !== "number") found.push(`${path}:array`);
  if (record.type === "string"
    && !Array.isArray(record.enum)
    && !Object.hasOwn(record, "const")
    && typeof record.maxLength !== "number") found.push(`${path}:string`);
  Object.entries(record).forEach(([key, entry]) =>
    unboundedSchemaPaths(entry, `${path}.${key}`, found));
  return found;
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

  test("emits maximum lengths and item counts for every free string and array", () => {
    expect(unboundedSchemaPaths(api.aiRecipeDraftJsonSchema)).toEqual([]);
  });

  test("rejects oversized nested output before producing an unbounded issue list", () => {
    const draft = makeAiDraft();
    draft.ingredients = Array.from({ length: 100_000 }, () => ({ bad: true })) as never;

    const result = recipeImport.parseAiRecipeDraft(draft, draft.sourceText);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
      expect(result.error.length).toBeLessThanOrEqual(128);
    }
  });

  test("rejects strings and domain arrays beyond their explicit limits", () => {
    const longId = makeAiDraft();
    longId.id = "x".repeat(97);
    const dependencies = makeAiDraft();
    dependencies.steps[0].dependsOn.value = Array.from({ length: 129 }, (_, index) => `s${index}`);

    expect(api.aiRecipeDraftSchema.safeParse(longId).success).toBe(false);
    expect(api.aiRecipeDraftSchema.safeParse(dependencies).success).toBe(false);
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

  test.each([
    ["ingredient", (draft: ReturnType<typeof makeAiDraft>) => {
      draft.ingredients[1].id = draft.ingredients[0].id;
    }, "ingredients[1].id"],
    ["step", (draft: ReturnType<typeof makeAiDraft>) => {
      draft.steps[1].id = draft.steps[0].id;
    }, "steps[1].id"],
  ])("rejects duplicate %s ids in one draft", (_label, duplicate, path) => {
    const draft = makeAiDraft();
    duplicate(draft);

    const parsed = recipeImport.parseAiRecipeDraft(draft, draft.sourceText);

    expect(api.aiRecipeDraftSchema.safeParse(draft).success).toBe(false);
    expect(api.recipeDraftSchema.safeParse(draft).success).toBe(false);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "SCHEMA_INVALID", path }),
      ]));
    }
  });

  test("allows confirmed values only in the local review schema", () => {
    const draft = makeAiDraft();
    draft.name.status = "confirmed";
    expect(api.recipeDraftSchema.safeParse(draft).success).toBe(true);
    expect(api.aiRecipeDraftSchema.safeParse(draft).success).toBe(false);
  });

  test("allows the internal user-edit marker only in the local review schema", () => {
    const reviewed = makeAiDraft();
    Object.assign(reviewed.name, {
      provenance: "inferred",
      evidence: null,
      inferenceReason: "User edited this field during review.",
      confidence: 1,
      status: "confirmed",
      editedByUser: true,
    });
    const forgedModelDraft = makeAiDraft();
    Object.assign(forgedModelDraft.name, { editedByUser: true });

    expect(api.recipeDraftSchema.safeParse(reviewed).success).toBe(true);
    expect(api.aiRecipeDraftSchema.safeParse(forgedModelDraft).success).toBe(false);
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
