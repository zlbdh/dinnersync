import { readFileSync } from "node:fs";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEMO_NUTRITION_CATALOG, DEMO_REVIEW_STATES } from "@/modules/demo";

import { ReviewScreen } from "../review-screen";

afterEach(cleanup);

function renderReview(
  overrides: Partial<React.ComponentProps<typeof ReviewScreen>> = {},
) {
  const props: React.ComponentProps<typeof ReviewScreen> = {
    reviewStates: [structuredClone(DEMO_REVIEW_STATES[0])],
    nutritionCatalog: DEMO_NUTRITION_CATALOG,
    mode: "hosted",
    note: "Keep garlic away from one plate.",
    planReady: true,
    planErrors: [],
    onReviewChange: vi.fn(),
    onBuildPlan: vi.fn(),
    onBack: vi.fn(),
    ...overrides,
  };
  render(<ReviewScreen {...props} />);
  return props;
}

describe("ReviewScreen", () => {
  it("truthfully identifies the Hosted fixture and exposes every scheduling field", () => {
    renderReview();

    expect(screen.getByText("02 · Check the extraction")).toBeInTheDocument();
    expect(screen.getByRole("heading", {
      name: "Review every field before the clock starts.",
    })).toHaveFocus();
    expect(screen.getByText("Built-in reviewed fixture")).toBeInTheDocument();
    expect(screen.getByText("No model request was made")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Lemon Herb Chicken" })).toBeInTheDocument();
    expect(screen.getByText(/target servings/i)).toBeInTheDocument();
    expect(screen.getAllByText(/ingredient name/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/quantity/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/food state/i).length).toBeGreaterThan(0);
    for (const label of [
      "Instruction",
      "Duration minutes",
      "Step mode",
      "Dependencies",
      "Resources",
      "Oven operation",
      "Oven temperature C",
      "Terminal step",
    ]) {
      expect(screen.getAllByText(label, { exact: true }).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole("button", {
      name: "Edit Instruction in recipe 1, step 1 (Lemon Herb Chicken)",
    })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Instruction" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Instruction" })).not.toBeInTheDocument();
    expect(screen.getByText("Step ID: chicken-preheat")).toBeInTheDocument();
    expect(screen.getByText(
      /chicken-preheat.*Recipe 1 \(Lemon Herb Chicken\) \/ Step 1/,
    )).toBeInTheDocument();
  });

  it("keeps generated DOM ids unique even when domain ids resemble landmark ids", () => {
    const state = structuredClone(DEMO_REVIEW_STATES[0]);
    state.draft.id = "review-title";
    state.draft.ingredients[0].id = "review-summary-title";
    state.ingredientDecisions[0].ingredientId = "review-summary-title";
    state.draft.steps[0].id = "review-title";
    renderReview({ reviewStates: [state] });

    const ids = [...document.querySelectorAll<HTMLElement>("[id]")]
      .map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps back and the decision ledger reachable from a sticky shortcut bar", () => {
    renderReview();

    const shortcuts = screen.getByRole("navigation", { name: /review shortcuts/i });
    expect(within(shortcuts).getByRole("link", { name: /decision ledger/i }))
      .toHaveAttribute("href", "#review-summary-title");
    expect(within(shortcuts).getByRole("button", { name: /back to setup/i }))
      .toBeEnabled();
    expect(screen.getByRole("heading", { name: "Before the clock starts" }))
      .toHaveAttribute("tabindex", "-1");
  });

  it("describes Local AI as a proposal that the user must decide", () => {
    renderReview({ mode: "local", planReady: false });

    expect(screen.getByText(
      "AI proposed the structure. You decide what becomes part of the plan.",
    )).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /build the service timeline/i })).toBeDisabled();
  });

  it("dispatches explicit Use and Omit decisions and explains invalidation", async () => {
    const user = userEvent.setup();
    const undecided = structuredClone(DEMO_REVIEW_STATES[0]);
    undecided.ingredientDecisions[0].status = null;
    const props = renderReview({ reviewStates: [undecided] });
    const ingredientId = DEMO_REVIEW_STATES[0].draft.ingredients[0].id;

    expect(screen.getAllByText(/omitting an ingredient resets all step confirmations/i).length)
      .toBeGreaterThan(0);
    await user.click(screen.getByRole("radio", { name: /omit chicken breast/i }));
    expect(props.onReviewChange).toHaveBeenCalledWith(
      DEMO_REVIEW_STATES[0].draft.id,
      { type: "set-ingredient-status", ingredientId, status: "omitted" },
    );
    await user.click(screen.getByRole("radio", { name: /use chicken breast/i }));
    expect(props.onReviewChange).toHaveBeenCalledWith(
      DEMO_REVIEW_STATES[0].draft.id,
      { type: "set-ingredient-status", ingredientId, status: "used" },
    );
  });

  it("validates target servings before dispatching a numeric action", async () => {
    const user = userEvent.setup();
    const props = renderReview();
    const target = screen.getByRole("spinbutton", { name: /target servings for lemon herb chicken/i });

    await user.clear(target);
    await user.type(target, "0");
    expect(props.onReviewChange).not.toHaveBeenCalled();
    expect(target).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: /build the service timeline/i })).toBeDisabled();

    await user.clear(target);
    fireEvent.change(target, { target: { value: "2.5" } });
    expect(props.onReviewChange).not.toHaveBeenCalled();
    expect(target).toHaveAttribute("aria-invalid", "true");
    expect(screen.getAllByText(/whole number of target servings/i)).toHaveLength(2);

    await user.clear(target);
    await user.type(target, "3");
    expect(props.onReviewChange).toHaveBeenCalledWith(
      DEMO_REVIEW_STATES[0].draft.id,
      { type: "set-target-servings", value: 3 },
    );
    expect(screen.getByRole("button", { name: /build the service timeline/i })).toBeEnabled();
  });

  it("keeps the build action enabled for externally ready plans with unresolved nutrition", () => {
    const state = structuredClone(DEMO_REVIEW_STATES[0]);
    state.ingredientDecisions[0].nutritionMatchStatus = "unresolved";
    state.ingredientDecisions[0].nutritionRefId = null;
    renderReview({ reviewStates: [state], planReady: true });

    expect(screen.getByText(/1 used ingredient remains nutrition-unresolved/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /build the service timeline/i })).toBeEnabled();
  });

  it("links blockers, note provenance, and the locked timeline action accessibly", () => {
    renderReview({
      note: "Nut allergy reported by guest",
      planReady: false,
      planErrors: [
        { path: "recipes[0].steps[0].mode", message: "Confirm the first step mode." },
        { message: "Choose Use or Omit for every ingredient." },
      ],
    });

    expect(screen.getByText("Your note · not analyzed or safety-checked")).toBeInTheDocument();
    expect(screen.getByText("Nut allergy reported by guest")).toBeInTheDocument();
    const blockers = screen.getByRole("list", { name: /timeline blockers/i });
    expect(blockers).toHaveTextContent("Confirm the first step mode.");
    expect(blockers).toHaveTextContent("recipes[0].steps[0].mode");
    expect(screen.getByText(/timeline is locked until the listed review decisions/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /build the service timeline/i })).toBeDisabled();
  });

  it("caps a large blocker list and announces only a compact count", () => {
    renderReview({
      planReady: false,
      planErrors: Array.from({ length: 12 }, (_, index) => ({
        path: `recipes[0].steps[${index}].mode`,
        message: `Confirm field ${index + 1}.`,
      })),
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "12 timeline blockers remain. Showing the first 8.",
    );
    const blockers = screen.getByRole("list", { name: /timeline blockers/i });
    expect(within(blockers).getAllByRole("listitem")).toHaveLength(9);
    expect(within(blockers).getByText(/4 more blockers are not repeated here/i))
      .toBeInTheDocument();
    expect(blockers).not.toHaveAttribute("aria-live");
  });

  it("runs the hosted build and back callbacks", async () => {
    const user = userEvent.setup();
    const props = renderReview();

    await user.click(screen.getByRole("button", { name: /build the service timeline/i }));
    await user.click(screen.getByRole("button", { name: /back to setup/i }));
    expect(props.onBuildPlan).toHaveBeenCalledOnce();
    expect(props.onBack).toHaveBeenCalledOnce();
  });

  it("keeps touch targets, mobile flow, focus, and reduced motion explicit", () => {
    const css = readFileSync("src/app/review.css", "utf8");
    expect(css).toMatch(/\.review-screen button[^}]*min-height:\s*2\.75rem/);
    expect(css).toMatch(/\.review-screen :focus-visible[^}]*outline:/);
    expect(css).toMatch(/@media \(max-width:\s*560px\)/);
    expect(css).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)/);
    expect(css).toMatch(/overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/\.review-shortcuts[^}]*position:\s*sticky/);
    expect(css).toMatch(/\.nutrition-candidate a[^}]*min-height:\s*2\.75rem/);
    expect(css).toMatch(/\.review-summary :focus-visible[^}]*outline-color:\s*#f7bf42/i);
  });
});
