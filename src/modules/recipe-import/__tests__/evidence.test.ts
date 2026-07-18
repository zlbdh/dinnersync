import { describe, expect, test } from "vitest";

import * as recipeImport from "../index";
import { makeAiDraft, RECIPE_SOURCE } from "./draft-fixture";

type ReviewIssue = { path: string; code: string; message: string };
type Result = { ok: true; value: unknown } | { ok: false; error: ReviewIssue[] };
type EvidenceApi = {
  parseAiRecipeDraft(value: unknown, expectedSourceText: string): Result;
  validateEvidence(sourceText: string, value: unknown, path?: string): Result;
  validateRecipeDraftEvidence(value: unknown): Result;
};

const api = recipeImport as typeof recipeImport & EvidenceApi;

function expectIssue(result: Result, path: string, code: string) {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContainEqual(expect.objectContaining({ path, code }));
}

describe("UTF-16 evidence", () => {
  test("uses JavaScript UTF-16 offsets before and after emoji", () => {
    const sourceText = "Add 🥕 then stir";
    const emojiStart = sourceText.indexOf("🥕");
    const afterStart = sourceText.indexOf("then");
    expect("🥕".length).toBe(2);
    expect(sourceText.slice(emojiStart, emojiStart + "🥕".length)).toBe("🥕");

    const emojiResult = api.validateEvidence(sourceText, {
      value: "carrot",
      provenance: "source",
      evidence: { start: emojiStart, end: emojiStart + 2, text: "🥕" },
      inferenceReason: null,
      confidence: 1,
      status: "needs-review",
    }, "name");
    const afterResult = api.validateEvidence(sourceText, {
      value: "then",
      provenance: "source",
      evidence: { start: afterStart, end: afterStart + 4, text: "then" },
      inferenceReason: null,
      confidence: 1,
      status: "needs-review",
    }, "instruction");

    expect(emojiResult.ok).toBe(true);
    expect(afterResult.ok).toBe(true);
  });

  test("returns stable paths for invalid ranges and text mismatches", () => {
    const empty = api.validateEvidence("abc", {
      value: "abc",
      provenance: "source",
      evidence: { start: 0, end: 0, text: "" },
      inferenceReason: null,
      confidence: 1,
      status: "needs-review",
    }, "name");
    const outOfRange = api.validateEvidence("abc", {
      value: "abc",
      provenance: "source",
      evidence: { start: 0, end: 4, text: "abc" },
      inferenceReason: null,
      confidence: 1,
      status: "needs-review",
    }, "name");
    const mismatch = api.validateEvidence("abc", {
      value: "abc",
      provenance: "source",
      evidence: { start: 0, end: 2, text: "ab!" },
      inferenceReason: null,
      confidence: 1,
      status: "needs-review",
    }, "name");

    expectIssue(empty, "name.evidence", "EVIDENCE_RANGE_INVALID");
    expectIssue(outOfRange, "name.evidence", "EVIDENCE_RANGE_INVALID");
    expectIssue(mismatch, "name.evidence", "EVIDENCE_TEXT_MISMATCH");
  });

  test("reports provenance metadata errors without throwing", () => {
    const source = api.validateEvidence("abc", {
      value: "abc",
      provenance: "source",
      evidence: null,
      inferenceReason: "guessed",
      confidence: 2,
      status: "needs-review",
    }, "name");
    const inferred = api.validateEvidence("abc", {
      value: "abc",
      provenance: "inferred",
      evidence: { start: 0, end: 3, text: "abc" },
      inferenceReason: " ",
      confidence: 0.5,
      status: "needs-review",
    }, "name");

    expectIssue(source, "name.evidence", "EVIDENCE_REQUIRED");
    expectIssue(source, "name.inferenceReason", "INFERENCE_REASON_FORBIDDEN");
    expectIssue(source, "name.confidence", "CONFIDENCE_OUT_OF_RANGE");
    expectIssue(inferred, "name.evidence", "EVIDENCE_FORBIDDEN");
    expectIssue(inferred, "name.inferenceReason", "INFERENCE_REASON_REQUIRED");
  });

  test("anchors every nested span and sourceText to RecipeDraft.sourceText", () => {
    const valid = makeAiDraft();
    expect(api.validateRecipeDraftEvidence(valid).ok).toBe(true);
    expect(api.parseAiRecipeDraft(valid, RECIPE_SOURCE).ok).toBe(true);

    const fragmentHost = makeAiDraft();
    fragmentHost.ingredients[0].sourceText = "200 g dry pasta";
    expectIssue(
      api.parseAiRecipeDraft(fragmentHost, RECIPE_SOURCE),
      "ingredients[0].sourceText",
      "DRAFT_SOURCE_MISMATCH",
    );

    const wrongRootSpan = makeAiDraft();
    wrongRootSpan.steps[0].instruction.evidence = {
      start: 0,
      end: "Boil the pasta".length,
      text: "Boil the pasta",
    };
    expectIssue(
      api.parseAiRecipeDraft(wrongRootSpan, RECIPE_SOURCE),
      "steps[0].instruction.evidence",
      "EVIDENCE_TEXT_MISMATCH",
    );
  });

  test("rejects a model root that differs from the submitted source", () => {
    expectIssue(
      api.parseAiRecipeDraft(makeAiDraft(), `${RECIPE_SOURCE}\n`),
      "sourceText",
      "SOURCE_TEXT_MISMATCH",
    );
  });

  test("preserves the root source text after parsing", () => {
    const result = api.parseAiRecipeDraft(makeAiDraft(), RECIPE_SOURCE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.value as { sourceText: string }).sourceText).toBe(RECIPE_SOURCE);
    }
  });
});
