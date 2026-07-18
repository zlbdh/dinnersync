import type { Result } from "@/shared";

import type { RecipeDraft, ReviewIssue, ReviewValue } from "./types";

type EvidenceResult<T> = Result<T, ReviewIssue[]>;

function issue(path: string, code: string, message: string): ReviewIssue {
  return { path, code, message };
}

function validRange(start: unknown, end: unknown, sourceLength: number) {
  return Number.isInteger(start)
    && Number.isInteger(end)
    && (start as number) >= 0
    && (end as number) > (start as number)
    && (end as number) <= sourceLength;
}

export function validateEvidence<T>(
  recipeSourceText: string,
  review: ReviewValue<T>,
  path = "$",
): EvidenceResult<ReviewValue<T>> {
  const issues: ReviewIssue[] = [];
  if (!Number.isFinite(review.confidence)
    || review.confidence < 0
    || review.confidence > 1) {
    issues.push(issue(
      `${path}.confidence`,
      "CONFIDENCE_OUT_OF_RANGE",
      "Confidence must be a finite number from 0 to 1.",
    ));
  }

  if (review.provenance === "source") {
    if (review.evidence === null) {
      issues.push(issue(`${path}.evidence`, "EVIDENCE_REQUIRED", "Source values require evidence."));
    } else if (!validRange(review.evidence.start, review.evidence.end, recipeSourceText.length)) {
      issues.push(issue(
        `${path}.evidence`,
        "EVIDENCE_RANGE_INVALID",
        "Evidence must use an in-range UTF-16 half-open span.",
      ));
    } else if (recipeSourceText.slice(review.evidence.start, review.evidence.end)
      !== review.evidence.text) {
      issues.push(issue(
        `${path}.evidence`,
        "EVIDENCE_TEXT_MISMATCH",
        "Evidence text does not match the root recipe source.",
      ));
    }
    if (review.inferenceReason !== null) {
      issues.push(issue(
        `${path}.inferenceReason`,
        "INFERENCE_REASON_FORBIDDEN",
        "Source values cannot include an inference reason.",
      ));
    }
  } else if (review.provenance === "inferred") {
    if (review.evidence !== null) {
      issues.push(issue(
        `${path}.evidence`,
        "EVIDENCE_FORBIDDEN",
        "Inferred values cannot claim source evidence.",
      ));
    }
    if (typeof review.inferenceReason !== "string" || review.inferenceReason.trim() === "") {
      issues.push(issue(
        `${path}.inferenceReason`,
        "INFERENCE_REASON_REQUIRED",
        "Inferred values require a non-blank reason.",
      ));
    }
  } else {
    issues.push(issue(`${path}.provenance`, "PROVENANCE_INVALID", "Provenance is invalid."));
  }

  return issues.length > 0 ? { ok: false, error: issues } : { ok: true, value: review };
}

function collect<T>(
  sourceText: string,
  review: ReviewValue<T>,
  path: string,
  issues: ReviewIssue[],
) {
  const result = validateEvidence(sourceText, review, path);
  if (!result.ok) issues.push(...result.error);
}

export function validateRecipeDraftEvidence(
  draft: RecipeDraft,
): EvidenceResult<RecipeDraft> {
  const issues: ReviewIssue[] = [];
  collect(draft.sourceText, draft.name, "name", issues);
  collect(draft.sourceText, draft.sourceServings, "sourceServings", issues);

  draft.ingredients.forEach((ingredient, index) => {
    const base = `ingredients[${index}]`;
    if (ingredient.sourceText !== draft.sourceText) {
      issues.push(issue(
        `${base}.sourceText`,
        "DRAFT_SOURCE_MISMATCH",
        "Ingredient sourceText must equal the root recipe sourceText.",
      ));
    }
    collect(draft.sourceText, ingredient.name, `${base}.name`, issues);
    collect(draft.sourceText, ingredient.quantity, `${base}.quantity`, issues);
    collect(draft.sourceText, ingredient.unit, `${base}.unit`, issues);
    collect(draft.sourceText, ingredient.foodState, `${base}.foodState`, issues);
  });

  draft.steps.forEach((step, index) => {
    const base = `steps[${index}]`;
    if (step.sourceText !== draft.sourceText) {
      issues.push(issue(
        `${base}.sourceText`,
        "DRAFT_SOURCE_MISMATCH",
        "Step sourceText must equal the root recipe sourceText.",
      ));
    }
    collect(draft.sourceText, step.instruction, `${base}.instruction`, issues);
    collect(draft.sourceText, step.durationMinutes, `${base}.durationMinutes`, issues);
    collect(draft.sourceText, step.mode, `${base}.mode`, issues);
    collect(draft.sourceText, step.dependsOn, `${base}.dependsOn`, issues);
    collect(draft.sourceText, step.resources, `${base}.resources`, issues);
    collect(draft.sourceText, step.ovenOperation, `${base}.ovenOperation`, issues);
    collect(draft.sourceText, step.ovenTemperatureC, `${base}.ovenTemperatureC`, issues);
    collect(draft.sourceText, step.isTerminal, `${base}.isTerminal`, issues);
  });

  return issues.length > 0 ? { ok: false, error: issues } : { ok: true, value: draft };
}
