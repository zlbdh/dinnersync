import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEMO_NUTRITION_CATALOG, DEMO_REVIEW_STATES } from "@/modules/demo";
import type { IngredientDraft, IngredientReviewDecision } from "@/modules/recipe-import";

import { NutritionMatch } from "../nutrition-match";

afterEach(cleanup);

const STATE = DEMO_REVIEW_STATES[0];
const INGREDIENT = STATE.draft.ingredients[0];

function decision(overrides: Partial<IngredientReviewDecision> = {}): IngredientReviewDecision {
  return {
    ingredientId: INGREDIENT.id,
    status: "used",
    sourceGrams: null,
    plannedGrams: null,
    nutritionRefId: null,
    nutritionMatchStatus: "unresolved",
    ...overrides,
  };
}

function renderMatch(
  ingredient: IngredientDraft = structuredClone(INGREDIENT),
  currentDecision = decision(),
  onConfirm = vi.fn(),
) {
  render(
    <NutritionMatch
      contextLabel="ingredient 1 in recipe 1"
      ingredient={ingredient}
      decision={currentDecision}
      sourceServings={STATE.draft.sourceServings.value}
      targetServings={STATE.targetServings}
      catalog={DEMO_NUTRITION_CATALOG}
      onConfirm={onConfirm}
    />,
  );
  return onConfirm;
}

describe("NutritionMatch", () => {
  it("uses the caller-provided group name so repeated ingredient ids stay isolated", () => {
    const props = {
      ingredient: structuredClone(INGREDIENT),
      decision: decision(),
      sourceServings: STATE.draft.sourceServings.value,
      targetServings: STATE.targetServings,
      catalog: DEMO_NUTRITION_CATALOG,
      onConfirm: vi.fn(),
    };
    render(
      <>
        <NutritionMatch {...props} contextLabel="ingredient 1 in recipe A" />
        <NutritionMatch {...props} contextLabel="ingredient 1 in recipe B" />
      </>,
    );

    const radios = screen.getAllByRole("radio", { name: /chicken breast.*raw/i });
    expect(radios).toHaveLength(2);
    expect(radios[0].getAttribute("name")).toBeTruthy();
    expect(radios[1].getAttribute("name")).toBeTruthy();
    expect(radios[0].getAttribute("name")).not.toBe(radios[1].getAttribute("name"));
  });

  it("gives same-name candidates distinct radio and source-link names", () => {
    const base = DEMO_NUTRITION_CATALOG.find((record) =>
      record.id === "nutrition-chicken-breast-raw")!;
    const alternate = {
      ...base,
      id: "nutrition-chicken-breast-raw-alternate",
      sourceVersion: "Alternate verified release",
      sourceUrl: "https://example.com/alternate-chicken",
    };
    render(
      <NutritionMatch
        contextLabel="recipe 1, ingredient 1 (chicken breast)"
        ingredient={structuredClone(INGREDIENT)}
        decision={decision()}
        sourceServings={STATE.draft.sourceServings.value}
        targetServings={STATE.targetServings}
        catalog={[...DEMO_NUTRITION_CATALOG, alternate]}
        onConfirm={vi.fn()}
      />,
    );

    const radioNames = screen.getAllByRole("radio", { name: /chicken breast.*raw/i })
      .map((radio) => radio.getAttribute("aria-label"));
    const linkNames = screen.getAllByRole("link", { name: /open nutrition source.*chicken breast/i })
      .map((link) => link.getAttribute("aria-label"));
    expect(new Set(radioNames).size).toBe(radioNames.length);
    expect(new Set(linkNames).size).toBe(linkNames.length);
    expect(radioNames.join(" ")).toContain("Alternate verified release");
    expect(linkNames.join(" ")).toContain("Alternate verified release");
  });

  it("requires an explicit candidate selection before confirming provenance and weight", async () => {
    const user = userEvent.setup();
    const onConfirm = renderMatch();

    expect(screen.getByText("chicken breast")).toBeInTheDocument();
    expect(screen.getByText(/food state: raw/i)).toBeInTheDocument();
    expect(screen.getByText(/120 kcal.*100 g/i)).toBeInTheDocument();
    expect(screen.getByText(/USDA FoodData Central SR Legacy/i)).toBeInTheDocument();
    expect(screen.getByText(/Accessed 2026-07-18/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open nutrition source/i })).toHaveAttribute(
      "href",
      expect.stringContaining("fdc.nal.usda.gov"),
    );
    const confirm = screen.getByRole("button", { name: /confirm nutrition match/i });
    expect(confirm).toBeDisabled();

    await user.click(screen.getByRole("radio", { name: /chicken breast.*raw/i }));
    expect(screen.getByText(/Conversion: metric-mass/i)).toBeInTheDocument();
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith({
      type: "confirm-nutrition",
      ingredientId: INGREDIENT.id,
      nutritionRefId: "nutrition-chicken-breast-raw",
      sourceGrams: 320,
      plannedGrams: 320,
    });
  });

  it("keeps confirmation disabled until the used ingredient food state is confirmed", async () => {
    const user = userEvent.setup();
    const ingredient = structuredClone(INGREDIENT);
    ingredient.foodState.status = "needs-review";
    renderMatch(ingredient);

    await user.click(screen.getByRole("radio", { name: /chicken breast.*raw/i }));
    expect(screen.getByText(/confirm the food state first/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm nutrition match/i })).toBeDisabled();
  });

  it("clears a stale candidate after an earlier nutrition confirmation is invalidated", async () => {
    const user = userEvent.setup();
    const ingredient = structuredClone(INGREDIENT);
    const confirmed = decision({
      nutritionRefId: "nutrition-chicken-breast-raw",
      nutritionMatchStatus: "confirmed",
      sourceGrams: 320,
      plannedGrams: 320,
    });
    const props = {
      contextLabel: "ingredient 1 in recipe 1",
      ingredient,
      sourceServings: STATE.draft.sourceServings.value,
      targetServings: STATE.targetServings,
      catalog: DEMO_NUTRITION_CATALOG,
      onConfirm: vi.fn(),
    };
    const view = render(<NutritionMatch {...props} decision={confirmed} />);
    const radio = screen.getByRole("radio", { name: /chicken breast.*raw/i });
    expect(radio).toBeChecked();

    view.rerender(<NutritionMatch {...props} decision={decision()} />);

    expect(radio).not.toBeChecked();
    expect(screen.getByRole("button", { name: /confirm nutrition match/i })).toBeDisabled();
    await user.click(radio);
    expect(screen.getByRole("button", { name: /confirm nutrition match/i })).toBeEnabled();
  });

  it("explains that omitted ingredients cannot be matched without suggesting omission", () => {
    renderMatch(INGREDIENT, decision({ status: "omitted" }));

    expect(screen.getByText(/set this ingredient to Use before confirming nutrition/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm nutrition match/i })).toBeDisabled();
    expect(screen.queryByText(/omit this ingredient/i)).not.toBeInTheDocument();
  });

  it("keeps an unconvertible used ingredient unresolved and reports only a known subtotal", async () => {
    const user = userEvent.setup();
    const ingredient = structuredClone(INGREDIENT);
    ingredient.quantity.value = null;
    renderMatch(ingredient);

    await user.click(screen.getByRole("radio", { name: /chicken breast.*raw/i }));
    expect(screen.getByText(/weight cannot be resolved/i)).toBeInTheDocument();
    expect(screen.getByText(/known calorie subtotal/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm nutrition match/i })).toBeDisabled();
  });

  it("states when no catalog candidate exists and leaves the ingredient unresolved", () => {
    const ingredient = structuredClone(INGREDIENT);
    ingredient.name.value = "moon dust";
    renderMatch(ingredient);

    expect(screen.getByText(/no nutrition record candidate/i)).toBeInTheDocument();
    expect(screen.getByText(/known calorie subtotal/i)).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });
});
