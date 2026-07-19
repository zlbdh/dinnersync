import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TaskRuntimeState } from "@/modules/cooking-session";
import type { ScheduleTask } from "@/modules/scheduling";

import { TaskCard, type TaskCardProps } from "../task-card";

const START = "2026-07-18T18:00:00.000Z";
const END = "2026-07-18T18:05:00.000Z";

const task: ScheduleTask = {
  id: "prep",
  recipeId: "vegetables",
  sourceText: "Prep vegetables.",
  instruction: "Chop the garden vegetables",
  durationMinutes: 5,
  mode: "active",
  dependsOn: [],
  resources: [],
  ovenOperation: null,
  ovenTemperatureC: null,
  isTerminal: false,
};

const runtime: TaskRuntimeState = {
  taskId: "prep",
  status: "ready",
  plannedStart: START,
  plannedEnd: END,
  actualStart: null,
  actualEnd: null,
  expectedEnd: null,
};

function cardProps(): TaskCardProps {
  return {
    task,
    runtime,
    plannedStart: START,
    plannedEnd: END,
    resources: [],
    now: START,
    movedMinutes: null,
    movedBoundary: null,
    pending: false,
    onStart: vi.fn(),
    onDelay: vi.fn(),
    onComplete: vi.fn(),
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("TaskCard hydration", () => {
  it("keeps the server snapshot deterministic, then upgrades it to the browser's local clock", async () => {
    const originalTimezone = process.env.TZ;
    const container = document.createElement("div");
    document.body.append(container);

    try {
      process.env.TZ = "UTC";
      container.innerHTML = renderToString(<TaskCard {...cardProps()} />);
      expect(container.querySelector("time")).toHaveTextContent("--:--");
      expect(container.querySelector("time")).toHaveAttribute("aria-label", "Local time loading");

      process.env.TZ = "America/Los_Angeles";
      const hydrationErrors: unknown[] = [];
      let root!: ReturnType<typeof hydrateRoot>;
      await act(async () => {
        root = hydrateRoot(container, <TaskCard {...cardProps()} />, {
          onRecoverableError: (error) => hydrationErrors.push(error),
        });
      });

      expect(hydrationErrors).toEqual([]);
      expect(container.querySelector("time")).toHaveTextContent("11:00");
      expect(container.querySelector("time")).not.toHaveAttribute("aria-label");

      await act(async () => root.unmount());
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });
});
