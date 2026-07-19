import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import Page from "@/app/page";
import { readDinnerPlannerRevision } from "@/modules/dinner-planner";

import { serializePlanningContext } from "../planning-context";
import {
  PLANNER_STORAGE_KEY,
  PLANNING_CONTEXT_STORAGE_KEY,
} from "../use-planner-persistence";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DinnerSync complete hosted flow", () => {
  it("reaches a truthful summary through the real accelerated session dispatcher", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<Page />);

    await user.click(await screen.findByRole("button", { name: "Try the 650 kcal demo" }));
    await user.click(screen.getByRole("button", { name: /build the service timeline/i }));

    expect(screen.getByRole("heading", { name: "Service timeline ready." })).toHaveFocus();
    expect(screen.getByRole("list", { name: /dish service tracks/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start cooking" }));

    expect(screen.getByRole("heading", {
      name: /run the kitchen from what is true now/i,
    })).toHaveFocus();
    await user.click(screen.getByRole("button", {
      name: /run cooking replay at 60 times speed/i,
    }));

    const summary = await screen.findByRole("heading", {
      name: /dinner landed.*here is the record/i,
    }, { timeout: 10_000 });
    expect(summary).toHaveFocus();
    const planned = screen.getByLabelText("Planned dinner completion");
    const actual = screen.getByLabelText("Actual dinner completion");
    expect(planned).toHaveTextContent("7:00 PM");
    expect(actual).toHaveTextContent("7:08 PM");
    expect(Date.parse(actual.getAttribute("datetime")!)
      - Date.parse(planned.getAttribute("datetime")!)).toBe(8 * 60_000);
    expect(screen.getByText("8 min late")).toBeInTheDocument();
    const record = screen.getByRole("group", { name: /run record/i });
    expect(within(record).getByText("Recorded delays").parentElement).toHaveTextContent("1");
    expect(within(record).getByText("Delay minutes").parentElement).toHaveTextContent("8");
    expect(within(record).getByText("Replan passes").parentElement).toHaveTextContent("25");
    const note = screen.getByRole("note", { name: /next service note/i });
    expect(note).toHaveTextContent("Roast the chicken at 200 C");
    expect(note).toHaveTextContent("8 min");
    expect(fetchSpy).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /start another dinner/i }));
    expect(screen.getByRole("heading", { name: /set the table/i })).toHaveFocus();
    expect(screen.getByRole("textbox", { name: /recipe 1/i })).toHaveValue("");
  }, 15_000);

  it("restores an in-progress cooking session and announces the refresh", async () => {
    const user = userEvent.setup();
    const first = render(<Page />);
    await user.click(await screen.findByRole("button", { name: "Try the 650 kcal demo" }));
    await user.click(screen.getByRole("button", { name: /build the service timeline/i }));
    await user.click(screen.getByRole("button", { name: "Start cooking" }));
    await waitFor(() => expect(localStorage.getItem("dinnersync:planner:v1"))
      .toContain('"stage":"cook"'));

    first.unmount();
    render(<Page />);

    expect(await screen.findByRole("heading", {
      name: /run the kitchen from what is true now/i,
    })).toHaveFocus();
    expect(await screen.findByRole("status", { name: /cooking session warnings/i }))
      .toHaveTextContent(/restored.*saved cooking session/i);
  });

  it("restores a running task and derives due from wall-clock elapsed time without completing it", async () => {
    const user = userEvent.setup();
    const first = render(<Page />);
    await user.click(await screen.findByRole("button", { name: "Try the 650 kcal demo" }));
    await user.click(screen.getByRole("button", { name: /build the service timeline/i }));
    await user.click(screen.getByRole("button", { name: "Start cooking" }));
    await waitFor(() => expect(localStorage.getItem(PLANNER_STORAGE_KEY))
      .toContain('"stage":"cook"'));

    const snapshot = JSON.parse(localStorage.getItem(PLANNER_STORAGE_KEY)!);
    const initialTasks = snapshot.session.initialSchedule.tasks as Array<{
      taskId: string;
      plannedStart: string;
    }>;
    const requestTasks = snapshot.session.request.tasks as Array<{
      id: string;
      instruction: string;
      durationMinutes: number;
    }>;
    const scheduled = [...initialTasks]
      .sort((left, right) => Date.parse(left.plannedStart) - Date.parse(right.plannedStart))[0];
    const definition = requestTasks.find((task) => task.id === scheduled.taskId);
    if (!definition) throw new Error("Expected the first scheduled task definition");
    snapshot.session.events = [{
      sequence: 1,
      type: "TASK_STARTED",
      taskId: scheduled.taskId,
      at: scheduled.plannedStart,
    }];
    localStorage.setItem(PLANNER_STORAGE_KEY, JSON.stringify(snapshot));
    const runningRevision = readDinnerPlannerRevision(
      localStorage.getItem(PLANNER_STORAGE_KEY),
    );
    if (!runningRevision) throw new Error("Expected planner revision");
    localStorage.setItem(PLANNING_CONTEXT_STORAGE_KEY, serializePlanningContext(
      "hosted",
      scheduled.plannedStart,
      Date.now(),
      runningRevision,
    ));

    first.unmount();
    const running = render(<Page />);
    const runningCard = await screen.findByRole("article", { name: definition.instruction });
    expect(within(runningCard).getByRole("button", {
      name: `Complete ${definition.instruction}`,
    })).toBeEnabled();
    expect(within(runningCard).getByText(/remaining/i)).toBeInTheDocument();

    running.unmount();
    const dueRevision = readDinnerPlannerRevision(
      localStorage.getItem(PLANNER_STORAGE_KEY),
    );
    if (!dueRevision) throw new Error("Expected planner revision");
    localStorage.setItem(PLANNING_CONTEXT_STORAGE_KEY, serializePlanningContext(
      "hosted",
      scheduled.plannedStart,
      Date.now() - (definition.durationMinutes + 1) * 60_000,
      dueRevision,
    ));
    render(<Page />);

    const dueCard = await screen.findByRole("article", { name: definition.instruction });
    expect(within(dueCard).getByText("Due · resource held")).toBeInTheDocument();
    expect(within(dueCard).getByText(/overdue/i)).toBeInTheDocument();
    expect(within(dueCard).getByRole("button", {
      name: `Complete ${definition.instruction}`,
    })).toBeEnabled();
    expect(within(dueCard).queryByText("Completed")).not.toBeInTheDocument();
  });

  it("derives newly ready work from elapsed wall time even after timer throttling", async () => {
    const wallStart = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(wallStart);
    const user = userEvent.setup();
    render(<Page />);
    await user.click(await screen.findByRole("button", { name: "Try the 650 kcal demo" }));
    await user.click(screen.getByRole("button", { name: /build the service timeline/i }));
    await user.click(screen.getByRole("button", { name: "Start cooking" }));

    expect(screen.queryAllByRole("button", { name: /^Start /i })).toHaveLength(0);
    nowSpy.mockReturnValue(wallStart + 10 * 60_000);

    await waitFor(() => expect(
      screen.getAllByRole("button", { name: /^Start /i }).length,
    ).toBeGreaterThan(0), { timeout: 2_500 });
  });

  it("does not relabel a restored plan as Hosted when origin metadata is missing", async () => {
    const user = userEvent.setup();
    const first = render(<Page />);
    await user.click(await screen.findByRole("button", { name: "Try the 650 kcal demo" }));
    await waitFor(() => expect(localStorage.getItem(PLANNER_STORAGE_KEY))
      .toContain('"stage":"review"'));
    localStorage.removeItem(PLANNING_CONTEXT_STORAGE_KEY);

    first.unmount();
    render(<Page />);

    expect(await screen.findByText("Restored · origin unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Hosted · no model")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Planner storage warnings" }))
      .toHaveTextContent(/clock or origin was unavailable/i);
    expect(screen.getByText(/origin metadata was unavailable/i)).toBeInTheDocument();
  });
});
