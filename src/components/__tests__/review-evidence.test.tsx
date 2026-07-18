import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import type { ReviewValue } from "@/modules/recipe-import";

import { ReviewEvidence } from "../review-evidence";

afterEach(cleanup);

function sourceReview(sourceText: string, start: number, end: number): ReviewValue<string> {
  return {
    value: sourceText.slice(start, end),
    provenance: "source",
    evidence: { start, end, text: sourceText.slice(start, end) },
    inferenceReason: null,
    confidence: 0.83,
    status: "needs-review",
  };
}

describe("ReviewEvidence", () => {
  it("uses the UTF-16 offsets to mark the second repeated phrase after emoji", async () => {
    const user = userEvent.setup();
    const sourceText = "🥕 roast first · 🥕 roast second";
    const first = sourceText.indexOf("roast");
    const second = sourceText.indexOf("roast", first + 1);
    const review = sourceReview(sourceText, second, second + "roast".length);
    const { container } = render(
      <ReviewEvidence label="Instruction" sourceText={sourceText} review={review} />,
    );

    const button = screen.getByRole("button", { name: /show source evidence for instruction/i });
    expect(button.getAttribute("aria-controls")).toBeTruthy();
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelector("mark")).toBeNull();

    await user.click(button);
    const evidence = screen.getByRole("blockquote", { name: /source evidence for instruction/i });
    expect(evidence.id).toBe(button.getAttribute("aria-controls"));
    const mark = evidence.querySelector("mark")!;
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(mark).toHaveTextContent("roast");
    expect(mark.previousSibling?.textContent).toBe(sourceText.slice(0, second));
    expect(mark.nextSibling?.textContent).toBe(sourceText.slice(second + 5));
  });

  it("shows an inference reason without inventing a source mark", () => {
    const review: ReviewValue<string> = {
      value: "passive",
      provenance: "inferred",
      evidence: null,
      inferenceReason: "The step can run without continuous attention.",
      confidence: 0.7,
      status: "needs-review",
    };
    const { container } = render(
      <ReviewEvidence label="Mode" sourceText="Simmer for ten minutes." review={review} />,
    );

    expect(screen.getByText("Inferred · needs your decision")).toBeInTheDocument();
    expect(screen.getByText(`Model rationale: ${review.inferenceReason}`)).toBeInTheDocument();
    expect(screen.getByText("Model confidence 70% · not verification")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /source evidence/i })).not.toBeInTheDocument();
    expect(container.querySelector("mark")).toBeNull();
  });

  it("shows bounded model confidence without presenting it as verification", () => {
    const sourceText = "Roast for 20 minutes.";
    const review = sourceReview(sourceText, 0, 5);
    render(
      <ReviewEvidence label="Instruction" sourceText={sourceText} review={review} />,
    );

    expect(screen.getByText("Model confidence 83% · not verification")).toBeInTheDocument();
  });

  it("rejects a source span whose captured text does not match the UTF-16 slice", () => {
    const sourceText = "Roast for 20 minutes.";
    const review: ReviewValue<string> = {
      ...sourceReview(sourceText, 0, 5),
      evidence: { start: 0, end: 5, text: "Boil!" },
    };
    render(
      <ReviewEvidence label="Instruction" sourceText={sourceText} review={review} />,
    );

    expect(screen.queryByRole("button", { name: /source evidence/i })).not.toBeInTheDocument();
    expect(screen.getByText(/source evidence is unavailable/i)).toBeInTheDocument();
  });

  it("labels a user edit as a correction without claiming model certainty", () => {
    const review: ReviewValue<string> = {
      value: "Roast gently",
      provenance: "inferred",
      evidence: null,
      inferenceReason: "User-confirmed correction",
      confidence: 1,
      status: "confirmed",
      editedByUser: true,
    };
    render(
      <ReviewEvidence label="Instruction" sourceText="Roast." review={review} />,
    );

    expect(screen.getByText("User-confirmed correction")).toBeInTheDocument();
    expect(screen.queryByText(/model confidence/i)).not.toBeInTheDocument();
  });

  it("does not let a model-controlled inference reason impersonate a user edit", () => {
    const review: ReviewValue<string> = {
      value: "Roast gently",
      provenance: "inferred",
      evidence: null,
      inferenceReason: "User-confirmed correction",
      confidence: 0.61,
      status: "confirmed",
    };
    const { container } = render(
      <ReviewEvidence label="Instruction" sourceText="Roast." review={review} />,
    );

    expect(container.querySelector(".review-provenance--corrected")).toBeNull();
    expect(screen.getByText("Inferred · confirmed by you")).toBeInTheDocument();
    expect(screen.getByText("Model rationale: User-confirmed correction")).toBeInTheDocument();
    expect(screen.getByText("Model confidence 61% · not verification")).toBeInTheDocument();
  });
});
