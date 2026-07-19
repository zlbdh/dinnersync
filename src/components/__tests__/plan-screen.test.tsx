import { readFileSync } from "node:fs";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildDinnerPlan,
  type BuildDinnerPlanInput,
  type DinnerPlan,
} from "@/modules/dinner-planner";
import {
  DEMO_NUTRITION_CATALOG,
  DEMO_REVIEW_STATES,
  DEMO_SCENARIO,
} from "@/modules/demo";
import type { RecipeReviewState } from "@/modules/recipe-import";

import { PlanScreen } from "../plan-screen";

function readyPlan(overrides: Partial<BuildDinnerPlanInput> = {}): DinnerPlan {
  const result = buildDinnerPlan({
    settings: DEMO_SCENARIO,
    reviewStates: DEMO_REVIEW_STATES,
    nutritionCatalog: DEMO_NUTRITION_CATALOG,
    ...overrides,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function partialPlan() {
  const reviewStates = structuredClone(DEMO_REVIEW_STATES) as RecipeReviewState[];
  const unresolved = reviewStates[0].ingredientDecisions.find(
    (entry) => entry.ingredientId === "chicken-oil",
  )!;
  Object.assign(unresolved, {
    sourceGrams: null,
    plannedGrams: null,
    nutritionRefId: null,
    nutritionMatchStatus: "unresolved",
  });
  return readyPlan({ reviewStates });
}

function infeasiblePlan() {
  return readyPlan({
    settings: { ...DEMO_SCENARIO, serveAt: "2026-07-18T18:20:00.000Z" },
  });
}

afterEach(cleanup);

describe("PlanScreen", () => {
  it("renders three dish tracks that converge on one service marker", () => {
    const plan = readyPlan();
    const { container } = render(
      <PlanScreen plan={plan} onStartCooking={vi.fn()} onBack={vi.fn()} />,
    );

    const title = screen.getByRole("heading", { name: /service timeline ready/i });
    expect(title).toHaveFocus();
    const trackList = screen.getByRole("list", { name: "Dish service tracks" });
    const tracks = trackList.querySelectorAll(":scope > li");
    const marker = container.querySelector<HTMLElement>("[data-serve-marker]")!;

    expect(tracks).toHaveLength(3);
    expect(marker).toHaveTextContent("Dinner lands");
    for (const track of tracks) {
      expect(track).toHaveAttribute("aria-describedby", marker.id);
    }
    for (const recipe of plan.recipes) {
      expect(within(trackList).getByRole("heading", { name: recipe.name }))
        .toBeInTheDocument();
    }
  });

  it("makes time, work mode, and effective kitchen resources explicit", () => {
    const { container } = render(
      <PlanScreen plan={readyPlan()} onStartCooking={vi.fn()} onBack={vi.fn()} />,
    );
    const task = (id: string) => container.querySelector<HTMLElement>(
      `[data-view="track"][data-task-id="${id}"]`,
    )!;

    expect(task("chicken-prep")).toHaveTextContent("Active");
    expect(task("chicken-prep")).toHaveTextContent("Cook 1");
    expect(task("chicken-roast")).toHaveTextContent("Passive");
    expect(task("chicken-roast")).toHaveTextContent("Oven 1");
    expect(task("rice-toast")).toHaveTextContent("Burner 1");
    expect(task("rice-toast").querySelectorAll("time")).toHaveLength(2);
    expect(task("rice-toast")).toHaveTextContent(/start/i);
    expect(task("rice-toast")).toHaveTextContent(/end/i);
  });

  it("keeps a compact task list in chronological order with dish and resource labels", () => {
    const plan = readyPlan();
    expect(plan.schedule.feasible).toBe(true);
    const { container } = render(
      <PlanScreen plan={plan} onStartCooking={vi.fn()} onBack={vi.fn()} />,
    );
    if (!plan.schedule.feasible) return;
    const compact = screen.getByRole("list", {
      name: "Tasks ordered by start time on compact screens",
    });
    const renderedIds = Array.from(compact.children).map(
      (entry) => entry.getAttribute("data-task-id"),
    );
    const expectedIds = [...plan.schedule.tasks]
      .sort((left, right) => Date.parse(left.plannedStart) - Date.parse(right.plannedStart)
        || left.taskId.localeCompare(right.taskId))
      .map((entry) => entry.taskId);

    expect(renderedIds).toEqual(expectedIds);
    const compactPrep = container.querySelector<HTMLElement>(
      '[data-view="compact"][data-task-id="chicken-prep"]',
    )!;
    expect(compactPrep).toHaveTextContent("Lemon Herb Chicken");
    expect(compactPrep).toHaveTextContent("Cook 1");
  });

  it("shows total, per-person, and target difference for complete nutrition", () => {
    render(<PlanScreen plan={readyPlan()} onStartCooking={vi.fn()} onBack={vi.fn()} />);

    const nutrition = screen.getByRole("region", { name: "Nutrition summary" });
    expect(within(nutrition).getByText("Total meal")).toBeInTheDocument();
    expect(within(nutrition).getByText("Per person")).toBeInTheDocument();
    expect(within(nutrition).getByText("Target difference")).toBeInTheDocument();
    expect(nutrition).toHaveTextContent("1,300.3 kcal");
    expect(nutrition).toHaveTextContent("650.1 kcal");
    expect(nutrition).toHaveTextContent("+0.1 kcal");
    expect(within(nutrition).queryByText("Known subtotal")).not.toBeInTheDocument();
  });

  it("limits partial nutrition to a known subtotal and named missing ingredients", () => {
    render(<PlanScreen plan={partialPlan()} onStartCooking={vi.fn()} onBack={vi.fn()} />);

    const nutrition = screen.getByRole("region", { name: "Nutrition summary" });
    expect(within(nutrition).getByText("Known subtotal")).toBeInTheDocument();
    expect(within(nutrition).getByText("Missing ingredients")).toBeInTheDocument();
    expect(nutrition).toHaveTextContent(/olive oil/i);
    expect(within(nutrition).queryByText("Total meal")).not.toBeInTheDocument();
    expect(within(nutrition).queryByText("Per person")).not.toBeInTheDocument();
    expect(within(nutrition).queryByText("Target difference")).not.toBeInTheDocument();
  });

  it("explains an infeasible window and exposes its earliest finish", () => {
    const plan = infeasiblePlan();
    expect(plan.schedule.feasible).toBe(false);
    render(<PlanScreen plan={plan} onStartCooking={vi.fn()} onBack={vi.fn()} />);
    if (plan.schedule.feasible) return;

    const warning = screen.getByRole("region", { name: "Schedule feasibility" });
    expect(within(warning).getByRole("heading", {
      name: "Requested service window is not feasible.",
    })).toBeInTheDocument();
    expect(within(warning).getByText(/available window is too short/i))
      .toBeInTheDocument();
    expect(within(warning).getByText("Earliest feasible finish")).toBeInTheDocument();
    expect(within(warning).getByText("Earliest feasible finish").nextElementSibling)
      .toHaveAttribute("datetime", plan.schedule.earliestFeasible!.serveAt);
    expect(screen.getByRole("button", { name: "Start cooking" })).toBeDisabled();
  });

  it("provides keyboard actions and preserves long content without truncation", async () => {
    const user = userEvent.setup();
    const onStartCooking = vi.fn();
    const onBack = vi.fn();
    const plan = structuredClone(readyPlan());
    const longName = `Long dish ${"with herbs ".repeat(35)}`;
    const longInstruction = `Keep stirring ${"until the texture changes naturally ".repeat(25)}`;
    plan.recipes[0].name = longName;
    plan.recipes[0].steps[0].instruction = longInstruction;
    plan.scheduleRequest.tasks[0].instruction = longInstruction;
    const { container } = render(
      <PlanScreen plan={plan} onStartCooking={onStartCooking} onBack={onBack} />,
    );

    const instructions = container.querySelectorAll(
      '[data-task-id="chicken-preheat"] .service-task__instruction',
    );
    expect(Array.from(instructions, (entry) => entry.textContent))
      .toEqual([longInstruction, longInstruction]);
    expect(container.textContent).toContain(longName);
    await user.click(screen.getByRole("button", { name: "Start cooking" }));
    await user.click(screen.getByRole("button", { name: "Back to setup" }));
    expect(onStartCooking).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("uses grid on desktop and a touch-safe chronological list below 560px", () => {
    const css = readFileSync("src/app/plan.css", "utf8");

    expect(css).toMatch(/\.service-timeline__track\s*\{[\s\S]*?display:\s*grid/);
    expect(css).toMatch(/\.service-timeline__compact\s*\{[\s\S]*?display:\s*none/);
    expect(css).toMatch(/@media\s*\(max-width:\s*560px\)[\s\S]*\.service-timeline__tracks\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/@media\s*\(max-width:\s*560px\)[\s\S]*\.service-timeline__compact\s*\{[^}]*display:\s*grid/);
    expect(css).toMatch(/\.plan-screen \.button\s*\{[^}]*min-height:\s*2\.75rem/);
    expect(css).toMatch(/overflow-wrap:\s*anywhere/);
  });
});
