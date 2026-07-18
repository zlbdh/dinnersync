"use client";

import { useId, useState } from "react";

import type { ReviewValue } from "@/modules/recipe-import";

export type ReviewEvidenceProps = {
  label: string;
  contextLabel?: string;
  sourceText: string;
  review: ReviewValue<unknown>;
};

function isUserCorrection(review: ReviewValue<unknown>) {
  return review.editedByUser === true;
}

function confidenceLabel(confidence: number) {
  const bounded = Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0;
  return `Model confidence ${Math.round(bounded * 100)}% · not verification`;
}

export function ReviewEvidence({ label, contextLabel, sourceText, review }: ReviewEvidenceProps) {
  const [expanded, setExpanded] = useState(false);
  const evidenceId = `${useId()}-evidence`;
  const contextSuffix = contextLabel ? ` in ${contextLabel}` : "";

  if (isUserCorrection(review)) {
    return <p className="review-provenance review-provenance--corrected">User-confirmed correction</p>;
  }

  if (review.provenance === "inferred") {
    return (
      <div className="review-provenance review-provenance--inferred">
        <strong>{review.status === "confirmed" ? "Inferred · confirmed by you" : "Inferred · needs your decision"}</strong>
        <span>Model rationale: {review.inferenceReason ?? "No source evidence was supplied for this proposal."}</span>
        <span>{confidenceLabel(review.confidence)}</span>
      </div>
    );
  }

  const span = review.evidence;
  const validSpan = span !== null
    && Number.isInteger(span.start)
    && Number.isInteger(span.end)
    && span.start >= 0
    && span.end > span.start
    && span.end <= sourceText.length
    && sourceText.slice(span.start, span.end) === span.text;

  return (
    <div className="review-provenance review-provenance--source">
      <strong>{review.status === "confirmed" ? "Source-backed · confirmed" : "Source-backed · pending review"}</strong>
      <span>{confidenceLabel(review.confidence)}</span>
      {validSpan ? (
        <>
          <button
            type="button"
            className="evidence-toggle"
            aria-controls={evidenceId}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Hide" : "Show"} source evidence for ${label}${contextSuffix}`}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "Hide" : "Show"} source evidence for {label}
          </button>
          {expanded && (
            <blockquote id={evidenceId} aria-label={`Source evidence for ${label}${contextSuffix}`}>
              {sourceText.slice(0, span.start)}
              <mark>{sourceText.slice(span.start, span.end)}</mark>
              {sourceText.slice(span.end)}
            </blockquote>
          )}
        </>
      ) : (
        <span>Source evidence is unavailable; edit or confirm only after checking the recipe.</span>
      )}
    </div>
  );
}
