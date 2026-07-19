import { readFileSync } from "node:fs";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CookingSessionState } from "@/modules/cooking-session";
import type { DinnerPlan } from "@/modules/dinner-planner";
import type { Recipe } from "@/modules/recipe-import";
import type { Schedule, ScheduleTask } from "@/modules/scheduling";

import { SummaryScreen } from "../summary-screen";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const TIMES = { start: "2026-07-18T18:00:00.000Z", prepPlan: "2026-07-18T18:10:00.000Z", prepActual: "2026-07-18T18:18:00.000Z", servePlan: "2026-07-18T18:20:00.000Z", serveActual: "2026-07-18T18:28:00.000Z" } as const;

function task(
  id: string,
  recipeId: string,
  instruction: string,
  overrides: Partial<ScheduleTask> = {},
): ScheduleTask {
  return {
    id,
    recipeId,
    sourceText: `${instruction} source`,
    instruction,
    durationMinutes: 10,
    mode: "active",
    dependsOn: [],
    resources: [],
    ovenOperation: null,
    ovenTemperatureC: null,
    isTerminal: false,
    ...overrides,
  };
}

function fixture(): { plan: DinnerPlan; session: CookingSessionState } {
  const tasks = [
    task("main-prep", "main", "Sear the main", { durationMinutes: 10 }),
    task("main-finish", "main", "Plate the main", {
      durationMinutes: 10,
      dependsOn: ["main-prep"],
      isTerminal: true,
    }),
    task("veg-finish", "veg", "Plate the vegetables", {
      durationMinutes: 20,
      mode: "passive",
      isTerminal: true,
    }),
  ];
  const recipes: Recipe[] = [
    {
      id: "main",
      name: "Skillet main",
      sourceText: "Skillet main source",
      sourceServings: 2,
      targetServings: 2,
      ingredients: [],
      steps: tasks.filter((entry) => entry.recipeId === "main"),
    },
    {
      id: "veg",
      name: "Garden vegetables",
      sourceText: "Garden vegetables source",
      sourceServings: 2,
      targetServings: 2,
      ingredients: [],
      steps: tasks.filter((entry) => entry.recipeId === "veg"),
    },
  ];
  const initialSchedule: Schedule = {
    feasible: true,
    serveAt: TIMES.servePlan,
    tasks: [
      { taskId: "main-prep", plannedStart: TIMES.start, plannedEnd: TIMES.prepPlan, effectiveResources: ["cook:1"] },
      { taskId: "main-finish", plannedStart: TIMES.prepPlan, plannedEnd: TIMES.servePlan, effectiveResources: ["cook:1"] },
      { taskId: "veg-finish", plannedStart: TIMES.start, plannedEnd: TIMES.servePlan, effectiveResources: [] },
    ],
  };
  const currentSchedule: Schedule = {
    feasible: true,
    serveAt: TIMES.serveActual,
    tasks: initialSchedule.tasks.map((entry) => entry.taskId.startsWith("main-")
      ? {
          ...entry,
          plannedStart: entry.taskId === "main-prep" ? TIMES.start : TIMES.prepActual,
          plannedEnd: entry.taskId === "main-prep" ? TIMES.prepActual : TIMES.serveActual,
        }
      : { ...entry }),
  };
  const request = {
    tasks,
    kitchen: { cooks: 1, ovens: 1, burners: 2 } as const,
    availableFrom: TIMES.start,
    serveAt: TIMES.servePlan,
    serveToleranceMinutes: 5 as const,
  };
  const plan: DinnerPlan = {
    recipes,
    nutrition: {
      completeness: "complete",
      knownMealKcal: 1300,
      knownKcalPerPerson: 650,
      estimatedMealKcal: 1300,
      estimatedKcalPerPerson: 650,
      targetDeltaPerPerson: 0,
      unresolvedIngredientIds: [],
      recipeSummaries: [
        { recipeId: "main", completeness: "complete", knownKcal: 800, estimatedKcal: 800, unresolvedIngredientIds: [] },
        { recipeId: "veg", completeness: "complete", knownKcal: 500, estimatedKcal: 500, unresolvedIngredientIds: [] },
      ],
    },
    scheduleRequest: request,
    schedule: initialSchedule,
  };
  const session: CookingSessionState = {
    request,
    initialSchedule,
    schedule: currentSchedule,
    runtime: {
      "main-prep": { taskId: "main-prep", status: "completed", plannedStart: TIMES.start, plannedEnd: TIMES.prepPlan, actualStart: TIMES.start, actualEnd: TIMES.prepActual, expectedEnd: TIMES.prepActual },
      "main-finish": { taskId: "main-finish", status: "completed", plannedStart: TIMES.prepActual, plannedEnd: TIMES.serveActual, actualStart: TIMES.prepActual, actualEnd: TIMES.serveActual, expectedEnd: TIMES.serveActual },
      "veg-finish": { taskId: "veg-finish", status: "completed", plannedStart: TIMES.start, plannedEnd: TIMES.servePlan, actualStart: TIMES.start, actualEnd: TIMES.servePlan, expectedEnd: TIMES.servePlan },
    },
    events: [
      { sequence: 1, type: "TASK_STARTED", taskId: "main-prep", at: TIMES.start },
      { sequence: 2, type: "TASK_DELAYED", taskId: "main-prep", at: "2026-07-18T18:08:00.000Z", delayMinutes: 8 },
      { sequence: 3, type: "TASK_COMPLETED", taskId: "main-prep", at: TIMES.prepActual },
      { sequence: 4, type: "TASK_DUE", taskId: "veg-finish", at: TIMES.servePlan },
      { sequence: 5, type: "TASK_COMPLETED", taskId: "veg-finish", at: TIMES.servePlan },
      { sequence: 6, type: "TASK_STARTED", taskId: "main-finish", at: TIMES.prepActual },
      { sequence: 7, type: "TASK_COMPLETED", taskId: "main-finish", at: TIMES.serveActual },
    ],
    lastReplan: currentSchedule,
    lastCommandIssue: null,
    warnings: [],
  };
  return { plan, session };
}

function renderSummary(
  overrides: Partial<React.ComponentProps<typeof SummaryScreen>> = {},
) {
  const data = fixture();
  const props: React.ComponentProps<typeof SummaryScreen> = {
    plan: data.plan,
    session: data.session,
    diners: 2,
    onReturnToSetup: vi.fn(),
    onRestart: vi.fn(),
    ...overrides,
  };
  render(<SummaryScreen {...props} />);
  return props;
}

describe("SummaryScreen", () => {
  it("renders a truthful plan-versus-actual service debrief without a model call", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderSummary();

    expect(screen.getByRole("heading", { name: "Dinner landed. Here is the record." })).toHaveFocus();
    expect(screen.getByLabelText("Planned dinner completion")).toHaveAttribute("datetime", TIMES.servePlan);
    expect(screen.getByLabelText("Actual dinner completion")).toHaveAttribute("datetime", TIMES.serveActual);
    expect(screen.getByText("8 min late")).toBeInTheDocument();

    const record = screen.getByRole("group", { name: "Run record" });
    expect(within(record).getByText("Recorded delays").parentElement).toHaveTextContent("1");
    expect(within(record).getByText("Replan passes").parentElement).toHaveTextContent("6");
    expect(within(record).getByText("Delay minutes").parentElement).toHaveTextContent("8");

    const dishes = screen.getByRole("list", { name: "Dish energy summary" });
    const items = within(dishes).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Skillet main");
    expect(items[0]).toHaveTextContent("800 kcal");
    expect(items[0]).toHaveTextContent("400 kcal / person");
    expect(screen.getByText("650 kcal / person")).toBeInTheDocument();

    const note = screen.getByRole("note", { name: "Next service note" });
    expect(note).toHaveTextContent("Sear the main");
    expect(note).toHaveTextContent("8 min");
    expect(document.body).not.toHaveTextContent(/health|weight loss|diet advice/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("labels partial nutrition as a known subtotal instead of an estimate", () => {
    const data = fixture();
    data.plan.nutrition = {
      ...data.plan.nutrition,
      completeness: "partial",
      knownMealKcal: 1100,
      knownKcalPerPerson: 550,
      estimatedMealKcal: null,
      estimatedKcalPerPerson: null,
      targetDeltaPerPerson: null,
      unresolvedIngredientIds: ["unknown-oil"],
      recipeSummaries: data.plan.nutrition.recipeSummaries.map((entry, index) =>
        index === 0 ? {
          ...entry,
          completeness: "partial",
          knownKcal: 600,
          estimatedKcal: null,
          unresolvedIngredientIds: ["unknown-oil"],
        } : entry),
    };

    renderSummary({ plan: data.plan, session: data.session });

    expect(screen.getByRole("alert")).toHaveTextContent("Known subtotal only");
    expect(screen.getByRole("alert")).toHaveTextContent("1 unresolved ingredient");
    expect(screen.getByText("550 known kcal / person")).toBeInTheDocument();
    expect(screen.getAllByText("Known subtotal").length).toBeGreaterThan(0);
    expect(document.body).not.toHaveTextContent("Complete meal estimate");
  });

  it("does not format an invalid partial per-person value as nutrition", () => {
    const data = fixture();
    data.plan.nutrition.completeness = "partial";
    data.plan.nutrition.knownKcalPerPerson = Number.NaN;

    renderSummary({ plan: data.plan, session: data.session, diners: 0 });

    expect(screen.getByText("Per-person energy unavailable")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Unresolved ingredient details were not recorded");
    expect(document.body).not.toHaveTextContent(/NaN|Not available known/i);
  });

  it("does not invent an actual finish or advice for an incomplete session", () => {
    const data = fixture();
    data.session.runtime["main-finish"] = {
      ...data.session.runtime["main-finish"],
      status: "running",
      actualEnd: null,
    };

    renderSummary({ plan: data.plan, session: data.session });

    expect(screen.getByRole("status")).toHaveTextContent("Cooking record incomplete");
    expect(screen.getByLabelText("Actual dinner completion")).toHaveTextContent("Not recorded");
    expect(screen.queryByText(/min late/i)).not.toBeInTheDocument();
    expect(screen.getByRole("note", { name: "Next service note" }))
      .toHaveTextContent("needs completed timestamps for every task");
  });

  it("rejects a date-like value that is not a strict ISO instant", () => {
    const data = fixture();
    data.session.runtime["main-finish"].actualEnd = "2026-07-18";

    renderSummary({ plan: data.plan, session: data.session });

    expect(screen.getByRole("status")).toHaveTextContent("Cooking record incomplete");
    expect(screen.getByLabelText("Actual dinner completion")).toHaveTextContent("Not recorded");
  });

  it("keeps empty and invalid boundary data explicit without NaN or Infinity", () => {
    const empty = renderSummary({ plan: null, session: null, diners: 0 });

    expect(screen.getByRole("status")).toHaveTextContent("Summary unavailable");
    expect(screen.getByText("Nutrition unavailable")).toBeInTheDocument();
    expect(screen.getAllByText("Not recorded").length).toBeGreaterThanOrEqual(2);
    expect(document.body).not.toHaveTextContent(/NaN|Infinity/);
    expect(empty.onReturnToSetup).not.toHaveBeenCalled();
  });

  it("exposes keyboard-operable setup and restart actions", async () => {
    const user = userEvent.setup();
    const props = renderSummary();

    await user.tab();
    expect(screen.getByRole("button", { name: "Return to setup" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Start another dinner" }));

    expect(props.onReturnToSetup).toHaveBeenCalledOnce();
    expect(props.onRestart).toHaveBeenCalledOnce();
  });

  it("keeps touch, focus, wrapping, mobile flow, and reduced motion explicit", () => {
    const css = readFileSync("src/app/summary.css", "utf8");

    expect(css).toMatch(/\.summary-screen button[^}]*min-height:\s*2\.75rem/);
    expect(css).toMatch(/\.summary-screen :focus-visible[^}]*outline:/);
    expect(css).toMatch(/overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/@media \(max-width:\s*560px\)/);
    expect(css).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)/);
    expect(css).not.toMatch(/width:\s*\d{4,}px/);
  });
});
