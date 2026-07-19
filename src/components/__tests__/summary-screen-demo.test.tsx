import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  advanceSessionTime,
  applySessionCommand,
  createCookingSession,
} from "@/modules/cooking-session";
import type { CookingSessionState } from "@/modules/cooking-session";
import {
  DEMO_NUTRITION_CATALOG,
  DEMO_REVIEW_STATES,
  DEMO_SCENARIO,
  nextDemoCommand,
} from "@/modules/demo";
import { buildDinnerPlan } from "@/modules/dinner-planner";

import { SummaryScreen } from "../summary-screen";
import { criticalPathAdvice } from "../summary-screen-advice";

afterEach(cleanup);

function demoRecord() {
  const result = buildDinnerPlan({
    settings: DEMO_SCENARIO,
    reviewStates: DEMO_REVIEW_STATES,
    nutritionCatalog: DEMO_NUTRITION_CATALOG,
  });
  if (!result.ok || !result.value.schedule.feasible) {
    throw new Error("Expected a feasible demo plan");
  }
  let session = createCookingSession(
    result.value.scheduleRequest,
    result.value.schedule,
  );
  for (let index = 0; index < 100; index += 1) {
    const beat = nextDemoCommand(session);
    if (!beat) break;
    session = applySessionCommand(
      advanceSessionTime(session, beat.command.at),
      beat.command,
    );
  }
  return { plan: result.value, session };
}

function renderRecord(record: ReturnType<typeof demoRecord>) {
  render(<SummaryScreen
    plan={record.plan}
    session={record.session}
    diners={DEMO_SCENARIO.diners}
    onReturnToSetup={vi.fn()}
    onRestart={vi.fn()}
  />);
  return screen.getByRole("note", { name: "Next service note" });
}

function at(minutes: number) {
  return new Date(Date.parse("2026-07-18T18:00:00.000Z") + minutes * 60_000)
    .toISOString();
}

function resourceSlackSession(
  gapMinutes: number,
  followerStartMinutes: number,
): CookingSessionState {
  const leader = {
    id: "delayed-roast",
    recipeId: "main",
    sourceText: "Roast source",
    instruction: "Roast the delayed main",
    durationMinutes: 10,
    mode: "passive" as const,
    dependsOn: [],
    resources: [{ resourceId: "oven:1" as const }],
    ovenOperation: "cook" as const,
    ovenTemperatureC: 200,
    isTerminal: false,
  };
  const follower = {
    ...leader,
    id: "terminal-roast",
    recipeId: "side",
    sourceText: "Side source",
    instruction: "Roast the terminal side",
    isTerminal: true,
  };
  const initialFollowerStart = 10 + gapMinutes;
  return {
    request: {
      tasks: [leader, follower],
      kitchen: { cooks: 1, ovens: 1, burners: 1 },
      availableFrom: at(0),
      serveAt: at(initialFollowerStart + 10),
      serveToleranceMinutes: 5,
    },
    initialSchedule: {
      feasible: true,
      serveAt: at(initialFollowerStart + 10),
      tasks: [
        { taskId: leader.id, plannedStart: at(0), plannedEnd: at(10), effectiveResources: ["oven:1"] },
        { taskId: follower.id, plannedStart: at(initialFollowerStart), plannedEnd: at(initialFollowerStart + 10), effectiveResources: ["oven:1"] },
      ],
    },
    schedule: {
      feasible: true,
      serveAt: at(followerStartMinutes + 10),
      tasks: [
        { taskId: leader.id, plannedStart: at(0), plannedEnd: at(18), effectiveResources: ["oven:1"] },
        { taskId: follower.id, plannedStart: at(followerStartMinutes), plannedEnd: at(followerStartMinutes + 10), effectiveResources: ["oven:1"] },
      ],
    },
    runtime: {
      [leader.id]: { taskId: leader.id, status: "completed", plannedStart: at(0), plannedEnd: at(10), actualStart: at(0), actualEnd: at(18), expectedEnd: at(18) },
      [follower.id]: { taskId: follower.id, status: "completed", plannedStart: at(followerStartMinutes), plannedEnd: at(followerStartMinutes + 10), actualStart: at(followerStartMinutes), actualEnd: at(followerStartMinutes + 10), expectedEnd: at(followerStartMinutes + 10) },
    },
    events: [
      { sequence: 1, type: "TASK_STARTED", taskId: leader.id, at: at(0) },
      { sequence: 2, type: "TASK_DELAYED", taskId: leader.id, at: at(5), delayMinutes: 8 },
      { sequence: 3, type: "TASK_COMPLETED", taskId: leader.id, at: at(18) },
      { sequence: 4, type: "TASK_STARTED", taskId: follower.id, at: at(followerStartMinutes) },
      { sequence: 5, type: "TASK_COMPLETED", taskId: follower.id, at: at(followerStartMinutes + 10) },
    ],
    lastReplan: null,
    lastCommandIssue: null,
    warnings: [],
  };
}

function reorderedResourceSession() {
  const session = resourceSlackSession(0, 10);
  const leader = session.schedule.tasks.find((task) => task.taskId === "delayed-roast")!;
  const follower = session.schedule.tasks.find((task) => task.taskId === "terminal-roast")!;
  Object.assign(leader, { plannedStart: at(10), plannedEnd: at(28) });
  Object.assign(follower, { plannedStart: at(0), plannedEnd: at(10) });
  Object.assign(session.runtime[leader.taskId], {
    plannedStart: at(10), plannedEnd: at(20), actualStart: at(10),
    actualEnd: at(28), expectedEnd: at(28),
  });
  Object.assign(session.runtime[follower.taskId], {
    plannedStart: at(0), plannedEnd: at(10), actualStart: at(0),
    actualEnd: at(10), expectedEnd: at(10),
  });
  session.events = [
    { sequence: 1, type: "TASK_STARTED", taskId: follower.taskId, at: at(0) },
    { sequence: 2, type: "TASK_COMPLETED", taskId: follower.taskId, at: at(10) },
    { sequence: 3, type: "TASK_STARTED", taskId: leader.taskId, at: at(10) },
    { sequence: 4, type: "TASK_DELAYED", taskId: leader.taskId, at: at(15), delayMinutes: 8 },
    { sequence: 5, type: "TASK_COMPLETED", taskId: leader.taskId, at: at(28) },
  ];
  return session;
}

function dependencySlackSession(gapMinutes: number, followerStartMinutes: number) {
  const session = resourceSlackSession(gapMinutes, followerStartMinutes);
  const leader = session.request.tasks[0];
  const follower = session.request.tasks[1];
  session.request.tasks[1] = {
    ...follower,
    dependsOn: [leader.id],
    resources: [],
    ovenOperation: null,
    ovenTemperatureC: null,
  };
  session.initialSchedule.tasks[1].effectiveResources = [];
  session.schedule.tasks[1].effectiveResources = [];
  return session;
}

describe("SummaryScreen demo attribution", () => {
  it("attributes the eight-minute service slip to the delayed chicken roast", () => {
    const note = renderRecord(demoRecord());
    expect(note).toHaveTextContent("Roast the chicken at 200 C");
    expect(note).toHaveTextContent("8 min");
    expect(note).not.toHaveTextContent("Transfer the vegetables");
  });

  it("does not invent a step-specific buffer without an explicit delay event", () => {
    const record = demoRecord();
    record.session.events = record.session.events.filter((event) =>
      event.type !== "TASK_DELAYED");

    const note = renderRecord(record);
    expect(note).toHaveTextContent(/no explicit delay/i);
    expect(note).not.toHaveTextContent(/add about.*timing buffer/i);
  });

  it("attributes a delayed resource predecessor when it consumes planned slack", () => {
    const note = criticalPathAdvice(resourceSlackSession(5, 18), at(28));

    expect(note).toContain("Roast the delayed main");
    expect(note).toContain("8 min");
  });

  it("does not attribute a resource delay that fits inside the planned slack", () => {
    const note = criticalPathAdvice(resourceSlackSession(10, 20), at(30));

    expect(note).toMatch(/no explicit delay/i);
    expect(note).not.toContain("Roast the delayed main");
  });

  it("does not keep the initial predecessor edge after the resource order changes", () => {
    const note = criticalPathAdvice(reorderedResourceSession(), at(28));

    expect(note).toMatch(/no explicit delay/i);
    expect(note).not.toContain("Roast the delayed main");
  });

  it("attributes a dependency delay only when it pushes the successor past slack", () => {
    expect(criticalPathAdvice(dependencySlackSession(5, 18), at(28)))
      .toContain("Roast the delayed main");
    expect(criticalPathAdvice(dependencySlackSession(10, 20), at(30)))
      .toMatch(/no explicit delay/i);
  });
});
