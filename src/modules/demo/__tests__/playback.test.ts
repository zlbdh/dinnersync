import {
  advanceSessionTime,
  applySessionCommand,
  createCookingSession,
} from "@/modules/cooking-session";
import { buildDinnerPlan } from "@/modules/dinner-planner";
import { fromEpochMs } from "@/shared";
import { describe, expect, it } from "vitest";

import {
  DEMO_NUTRITION_CATALOG,
  DEMO_REVIEW_STATES,
  DEMO_SCENARIO,
} from "../index";
import { nextDemoCommand } from "../playback";

function demoSession() {
  const result = buildDinnerPlan({
    settings: DEMO_SCENARIO,
    reviewStates: DEMO_REVIEW_STATES,
    nutritionCatalog: DEMO_NUTRITION_CATALOG,
  });
  if (!result.ok || !result.value.schedule.feasible) {
    throw new Error("Expected a feasible demo plan");
  }
  return createCookingSession(result.value.scheduleRequest, result.value.schedule);
}

describe("nextDemoCommand", () => {
  it("keeps safe work parallel and finishes only eight minutes late after the roast delay", () => {
    let session = demoSession();
    const commands = [];

    for (let index = 0; index < 100; index += 1) {
      const beat = nextDemoCommand(session);
      if (!beat) break;
      commands.push(beat.command);
      const advanced = advanceSessionTime(session, beat.command.at);
      const next = applySessionCommand(advanced, beat.command);
      expect(next).not.toBe(session);
      expect(next.events.length).toBeGreaterThan(session.events.length);
      session = next;
    }

    expect(Object.values(session.runtime).every((task) =>
      task.status === "completed")).toBe(true);
    expect(nextDemoCommand(session)).toBeNull();
    expect(commands.filter((command) => command.type === "DELAY")).toEqual([
      expect.objectContaining({
        type: "DELAY",
        taskId: "chicken-roast",
        delayMinutes: 8,
      }),
    ]);
    const times = commands.map((command) => Date.parse(command.at));
    expect(times).toEqual([...times].sort((left, right) => left - right));

    const prepStartIndex = commands.findIndex((command) =>
      command.type === "START" && command.taskId === "chicken-prep");
    const preheatCompleteIndex = commands.findIndex((command) =>
      command.type === "COMPLETE" && command.taskId === "chicken-preheat");
    expect(prepStartIndex).toBeGreaterThanOrEqual(0);
    expect(prepStartIndex).toBeLessThan(preheatCompleteIndex);
    expect(Date.parse(session.runtime["chicken-prep"].actualStart!))
      .toBeLessThan(Date.parse(session.runtime["chicken-preheat"].actualEnd!));

    const roastPlan = session.initialSchedule.tasks.find((task) =>
      task.taskId === "chicken-roast")!;
    expect(Date.parse(session.runtime["chicken-roast"].actualEnd!)
      - Date.parse(roastPlan.plannedEnd)).toBe(8 * 60_000);
    const actualFinish = Math.max(...Object.values(session.runtime).map((task) =>
      Date.parse(task.actualEnd!)));
    expect(actualFinish - Date.parse(session.initialSchedule.serveAt)).toBe(8 * 60_000);
  });

  it("starts a resource-safe concurrent task before the active task finishes", () => {
    const initial = demoSession();
    const start = nextDemoCommand(initial);
    expect(start?.command.type).toBe("START");
    const running = applySessionCommand(
      advanceSessionTime(initial, start!.command.at),
      start!.command,
    );

    const next = nextDemoCommand(running);

    expect(next?.command.type).toBe("START");
    expect(next?.command.taskId).toBe("chicken-prep");
    expect(Date.parse(next!.command.at))
      .toBeLessThan(Date.parse(running.runtime[start!.command.taskId].expectedEnd!));
  });

  it("never schedules replay commands before the current cooking clock", () => {
    const session = demoSession();
    const resumedAt = fromEpochMs(Date.parse(DEMO_SCENARIO.serveAt) + 30 * 60_000);

    const next = nextDemoCommand(session, resumedAt);

    expect(next).not.toBeNull();
    expect(Date.parse(next!.command.at)).toBeGreaterThanOrEqual(Date.parse(resumedAt));
  });
});
