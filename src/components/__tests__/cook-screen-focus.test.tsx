import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CookingSessionState } from "@/modules/cooking-session";

import { CookScreen } from "../cook-screen";

afterEach(cleanup);

const START = "2026-07-18T18:00:00.000Z";
const DUE = "2026-07-18T18:05:00.000Z";
const SERVE = "2026-07-18T18:15:00.000Z";

function cookingSession(status: "ready" | "running"): CookingSessionState {
  const schedule = {
    feasible: true as const,
    serveAt: SERVE,
    tasks: [
      { taskId: "prep", plannedStart: START, plannedEnd: DUE, effectiveResources: ["cook:1" as const] },
      { taskId: "roast", plannedStart: DUE, plannedEnd: SERVE, effectiveResources: ["oven:1" as const] },
    ],
  };
  return {
    request: {
      tasks: [
        {
          id: "prep", recipeId: "vegetables", sourceText: "Prep vegetables.",
          instruction: "Chop the garden vegetables", durationMinutes: 5,
          mode: "active" as const, dependsOn: [], resources: [], ovenOperation: null,
          ovenTemperatureC: null, isTerminal: false,
        },
        {
          id: "roast", recipeId: "vegetables", sourceText: "Roast vegetables.",
          instruction: "Roast until charred", durationMinutes: 10,
          mode: "passive" as const, dependsOn: ["prep"],
          resources: [{ resourceId: "oven:1" as const }], ovenOperation: "cook" as const,
          ovenTemperatureC: 220, isTerminal: true,
        },
      ],
      kitchen: { cooks: 1, ovens: 1, burners: 2 }, availableFrom: START,
      serveAt: SERVE, serveToleranceMinutes: 5,
    },
    initialSchedule: structuredClone(schedule),
    schedule,
    runtime: {
      prep: {
        taskId: "prep", status, plannedStart: START, plannedEnd: DUE,
        actualStart: status === "running" ? START : null, actualEnd: null,
        expectedEnd: status === "running" ? DUE : null,
      },
      roast: {
        taskId: "roast", status: "scheduled" as const, plannedStart: DUE,
        plannedEnd: SERVE, actualStart: null, actualEnd: null, expectedEnd: null,
      },
    },
    events: [], lastReplan: null, lastCommandIssue: null, warnings: [],
  };
}

describe("CookScreen focus handoff", () => {
  it("moves focus from Start to Complete after the task starts", async () => {
    const onDispatch = vi.fn();
    const view = render(
      <CookScreen session={cookingSession("ready")} now={START} onDispatch={onDispatch} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start chop the garden vegetables/i }));
    view.rerender(
      <CookScreen session={cookingSession("running")} now={START} onDispatch={onDispatch} />,
    );

    await waitFor(() => expect(screen.getByRole("button", {
      name: /complete chop the garden vegetables/i,
    })).toHaveFocus());
  });

  it("moves focus to the next executable task after Complete", async () => {
    const onDispatch = vi.fn();
    const view = render(
      <CookScreen session={cookingSession("running")} now={DUE} onDispatch={onDispatch} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /complete chop the garden vegetables/i }));
    const advanced = cookingSession("running");
    advanced.runtime.prep = {
      ...advanced.runtime.prep, status: "completed", actualEnd: DUE, expectedEnd: DUE,
    };
    advanced.runtime.roast.status = "ready";
    view.rerender(<CookScreen session={advanced} now={DUE} onDispatch={onDispatch} />);

    await waitFor(() => expect(screen.getByRole("button", {
      name: /start roast until charred/i,
    })).toHaveFocus());
  });
});
