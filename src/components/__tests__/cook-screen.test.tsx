import { readFileSync } from "node:fs";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CookingSessionState } from "@/modules/cooking-session";

import { CookScreen } from "../cook-screen";

afterEach(cleanup);

const START = "2026-07-18T18:00:00.000Z";
const DUE = "2026-07-18T18:05:00.000Z";

function session(status: "scheduled" | "ready" | "running" | "due" = "running") {
  const state: CookingSessionState = {
    request: {
      tasks: [
        {
          id: "prep", recipeId: "vegetables", sourceText: "Prep vegetables.",
          instruction: "Chop the garden vegetables", durationMinutes: 5,
          mode: "active", dependsOn: [], resources: [], ovenOperation: null,
          ovenTemperatureC: null, isTerminal: false,
        },
        {
          id: "roast", recipeId: "vegetables", sourceText: "Roast vegetables.",
          instruction: "Roast until charred", durationMinutes: 10,
          mode: "passive", dependsOn: ["prep"], resources: [{ resourceId: "oven:1" }],
          ovenOperation: "cook", ovenTemperatureC: 220, isTerminal: true,
        },
      ],
      kitchen: { cooks: 1, ovens: 1, burners: 2 },
      availableFrom: START,
      serveAt: "2026-07-18T18:15:00.000Z",
      serveToleranceMinutes: 5,
    },
    initialSchedule: {
      feasible: true,
      serveAt: "2026-07-18T18:15:00.000Z",
      tasks: [
        { taskId: "prep", plannedStart: START, plannedEnd: DUE, effectiveResources: ["cook:1"] },
        {
          taskId: "roast", plannedStart: DUE,
          plannedEnd: "2026-07-18T18:15:00.000Z", effectiveResources: ["oven:1"],
        },
      ],
    },
    schedule: {
      feasible: true,
      serveAt: "2026-07-18T18:15:00.000Z",
      tasks: [
        { taskId: "prep", plannedStart: START, plannedEnd: DUE, effectiveResources: ["cook:1"] },
        {
          taskId: "roast", plannedStart: DUE,
          plannedEnd: "2026-07-18T18:15:00.000Z", effectiveResources: ["oven:1"],
        },
      ],
    },
    runtime: {
      prep: {
        taskId: "prep", status, plannedStart: START, plannedEnd: DUE,
        actualStart: status === "running" || status === "due" ? START : null,
        actualEnd: null,
        expectedEnd: status === "running" || status === "due" ? DUE : null,
      },
      roast: {
        taskId: "roast", status: "scheduled", plannedStart: DUE,
        plannedEnd: "2026-07-18T18:15:00.000Z", actualStart: null,
        actualEnd: null, expectedEnd: null,
      },
    },
    events: [],
    lastReplan: null,
    lastCommandIssue: null,
    warnings: [],
  };
  return state;
}

function renderCook(overrides: Partial<React.ComponentProps<typeof CookScreen>> = {}) {
  const props: React.ComponentProps<typeof CookScreen> = {
    session: session(),
    now: "2026-07-18T18:01:00.000Z",
    onDispatch: vi.fn(),
    ...overrides,
  };
  const view = render(<CookScreen {...props} />);
  return { ...view, props };
}

describe("CookScreen", () => {
  it("shows the current and next action with a timestamp-derived countdown", () => {
    const view = renderCook();

    const current = screen.getByRole("region", { name: /current action/i });
    const next = screen.getByRole("region", { name: /up next/i });
    expect(within(current).getByRole("heading", { name: "Chop the garden vegetables" }))
      .toBeInTheDocument();
    expect(within(current).getByText("04:00 remaining")).toBeInTheDocument();
    expect(within(next).getByRole("heading", { name: "Roast until charred" }))
      .toBeInTheDocument();

    view.rerender(<CookScreen {...view.props} now="2026-07-18T18:03:00.000Z" />);
    expect(screen.getByText("02:00 remaining")).toBeInTheDocument();
  });

  it("formats planned ISO instants in the user's local time zone", () => {
    renderCook();
    const localClock = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(START));

    expect(screen.getAllByRole("time")[0]).toHaveTextContent(localClock);
  });

  it("does not expose internal recipe identifiers", () => {
    renderCook();

    expect(screen.queryAllByText("vegetables", { exact: true })).toHaveLength(0);
  });

  it("dispatches Start, +4 minute Delay, and Complete with the displayed now", async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    const ready = renderCook({ session: session("ready"), onDispatch });
    await user.click(screen.getByRole("button", { name: /start chop the garden vegetables/i }));
    expect(onDispatch).toHaveBeenLastCalledWith({ type: "START", taskId: "prep", at: ready.props.now });

    ready.rerender(<CookScreen {...ready.props} session={session("running")} />);
    await user.click(screen.getByRole("button", { name: /delay chop the garden vegetables by 4 minutes/i }));
    expect(onDispatch).toHaveBeenLastCalledWith({
      type: "DELAY", taskId: "prep", at: ready.props.now, delayMinutes: 4,
    });
    await user.click(screen.getByRole("button", { name: /complete chop the garden vegetables/i }));
    expect(onDispatch).toHaveBeenLastCalledWith({ type: "COMPLETE", taskId: "prep", at: ready.props.now });
  });

  it("keeps due work visibly resource-occupying until Complete", () => {
    renderCook({ session: session("due"), now: "2026-07-18T18:07:00.000Z" });

    expect(screen.getByText("02:00 overdue")).toBeInTheDocument();
    expect(screen.getByText(/resource lock held until Complete/i)).toBeInTheDocument();
    expect(screen.getByText(/Cook 1 occupied/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /complete chop the garden vegetables/i }))
      .toBeEnabled();
  });

  it("presents a domain-rejected conflicting Start as an actionable error", () => {
    const blocked = session("due");
    blocked.lastCommandIssue = { code: "RESOURCE_LOCKED", taskId: "roast" };
    renderCook({ session: blocked });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/could not start Roast until charred/i);
    expect(alert).toHaveTextContent(/due tasks keep their resources until Complete/i);
  });

  it("marks tasks whose current schedule changed after a replan", () => {
    const replanned = session();
    replanned.schedule.tasks[1] = {
      ...replanned.schedule.tasks[1],
      plannedStart: "2026-07-18T18:09:00.000Z",
      plannedEnd: "2026-07-18T18:19:00.000Z",
    };
    renderCook({ session: replanned });

    const next = screen.getByRole("region", { name: /up next/i });
    expect(within(next).getByText("Replanned · moved +4 min")).toBeInTheDocument();
  });

  it("marks an active task whose finish moved while its start stayed fixed", () => {
    const replanned = session();
    replanned.schedule.tasks[0] = {
      ...replanned.schedule.tasks[0],
      plannedEnd: "2026-07-18T18:09:00.000Z",
    };
    renderCook({ session: replanned });

    const current = screen.getByRole("region", { name: /current action/i });
    expect(within(current).getByText("Replanned · finish moved +4 min"))
      .toBeInTheDocument();
  });

  it("keeps refresh recovery and storage warnings visible", () => {
    const restored = session();
    restored.warnings = [
      { code: "SNAPSHOT_RECOVERED", message: "Saved cooking data was invalid and reset safely." },
      { code: "STORAGE_UNAVAILABLE", message: "Progress is only saved in memory." },
    ];
    renderCook({ session: restored });

    const status = screen.getByRole("status", { name: /cooking session warnings/i });
    expect(status).toHaveTextContent(/invalid and reset safely/i);
    expect(status).toHaveTextContent(/only saved in memory/i);
  });

  it("includes planner-level persistence warnings in the Cook notice", () => {
    renderCook({
      plannerWarnings: [{
        category: "storage",
        code: "STORAGE_UNAVAILABLE",
        message: "Planner progress is only saved in memory.",
      }],
    });

    expect(screen.getByRole("status", { name: /cooking session warnings/i }))
      .toHaveTextContent(/planner progress is only saved in memory/i);
  });

  it("announces a valid cooking session restored after refresh", () => {
    renderCook({ restoredFromStorage: true });

    expect(screen.getByRole("status", { name: /cooking session warnings/i }))
      .toHaveTextContent(/restored.*saved cooking session/i);
  });

  it("prevents duplicate command submission while the first dispatch is pending", () => {
    let resolve!: () => void;
    const pending = new Promise<void>((done) => { resolve = done; });
    const onDispatch = vi.fn(() => pending);
    renderCook({ session: session("ready"), onDispatch });
    const start = screen.getByRole("button", { name: /start chop the garden vegetables/i });

    fireEvent.click(start);
    fireEvent.click(start);
    expect(onDispatch).toHaveBeenCalledOnce();
    expect(start).toBeDisabled();
    resolve();
  });

  it("hands accelerated replay the exact same event dispatcher", async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    const onAccelerate = vi.fn();
    renderCook({ onDispatch, onAccelerate, playbackRate: 60 });

    await user.click(screen.getByRole("button", { name: /run cooking replay at 60/i }));
    expect(onAccelerate).toHaveBeenCalledWith(onDispatch);
  });

  it("locks every task action and announces busy state during replay", () => {
    let finishReplay!: () => void;
    const replay = new Promise<void>((resolve) => { finishReplay = resolve; });
    const onAccelerate = vi.fn(() => replay);
    const state = session("running");
    state.runtime.roast.status = "ready";
    renderCook({ session: state, onAccelerate, playbackRate: 60 });

    fireEvent.click(screen.getByRole("button", { name: /run cooking replay at 60/i }));

    const replayStatus = screen.getByRole("status", { name: /replay status/i });
    expect(document.querySelector(".cook-board")).toHaveAttribute("aria-busy", "true");
    expect(document.querySelector(".cook-screen")).not.toHaveAttribute("aria-busy");
    expect(replayStatus.closest('[aria-busy="true"]')).toBeNull();
    expect(replayStatus)
      .toHaveTextContent(/replay running at 60.*task actions are temporarily locked/i);
    for (const action of screen.getAllByRole("button", {
      name: /^(start|delay|complete) /i,
    })) {
      expect(action).toBeDisabled();
    }
    finishReplay();
  });

  it("keeps touch, focus, reduced-motion, and mobile overflow rules explicit", () => {
    const css = readFileSync("src/app/cook.css", "utf8");
    expect(css).toMatch(/\.cook-screen button[^}]*min-height:\s*2\.75rem/);
    expect(css).toMatch(/\.cook-screen :focus-visible[^}]*outline:/);
    expect(css).toMatch(/overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/@media \(max-width:\s*560px\)/);
    expect(css).not.toMatch(/overflow-x:\s*hidden/);
    expect(css).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)/);
  });
});
