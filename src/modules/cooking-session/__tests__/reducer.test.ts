import { describe, expect, it } from "vitest";

import {
  advanceSessionTime,
  applySessionCommand,
  createCookingSession,
} from "../index";
import { AT, parallelSessionFixture, sessionFixture } from "./fixtures";

function runningFixture() {
  const { request, schedule } = sessionFixture();
  const ready = advanceSessionTime(createCookingSession(request, schedule), AT.start);
  return applySessionCommand(ready, {
    type: "START",
    taskId: "a-work",
    at: AT.start,
  });
}

describe("cooking session commands", () => {
  it("starts only a ready task and records its finite lock", () => {
    const { request, schedule } = sessionFixture();
    const initial = createCookingSession(request, schedule);
    const rejected = applySessionCommand(initial, {
      type: "START",
      taskId: "a-work",
      at: AT.start,
    });
    const started = runningFixture();

    expect(rejected).toBe(initial);
    expect(started.runtime["a-work"]).toMatchObject({
      status: "running",
      actualStart: AT.start,
      expectedEnd: "2026-07-18T18:05:00.000Z",
    });
    expect(started.events[0]).toEqual({
      sequence: 1,
      type: "TASK_STARTED",
      taskId: "a-work",
      at: AT.start,
    });
  });

  it("delays a running task from the later of its expected end and command time", () => {
    const running = runningFixture();
    const delayed = applySessionCommand(running, {
      type: "DELAY",
      taskId: "a-work",
      at: "2026-07-18T18:07:00Z",
      delayMinutes: 3,
    });

    expect(delayed.runtime["a-work"]).toMatchObject({
      status: "running",
      expectedEnd: "2026-07-18T18:10:00.000Z",
    });
    expect(delayed.events.at(-1)).toEqual({
      sequence: 3,
      type: "TASK_DELAYED",
      taskId: "a-work",
      at: "2026-07-18T18:07:00Z",
      delayMinutes: 3,
    });
    expect(delayed.events[1]).toMatchObject({
      sequence: 2,
      type: "TASK_DUE",
      at: "2026-07-18T18:05:00.000Z",
    });
  });

  it("moves due back to running on delay and permits a later due event", () => {
    const due = advanceSessionTime(runningFixture(), AT.due);
    const delayed = applySessionCommand(due, {
      type: "DELAY",
      taskId: "a-work",
      at: AT.completed,
      delayMinutes: 2,
    });
    const dueAgain = advanceSessionTime(delayed, "2026-07-18T18:08:00Z");

    expect(delayed.runtime["a-work"]).toMatchObject({
      status: "running",
      expectedEnd: "2026-07-18T18:08:00.000Z",
    });
    expect(dueAgain.runtime["a-work"].status).toBe("due");
    expect(dueAgain.events.map((event) => event.type)).toEqual([
      "TASK_STARTED",
      "TASK_DUE",
      "TASK_DELAYED",
      "TASK_DUE",
    ]);
  });

  it("completes running or due, releases resources, and always records a replan", () => {
    const due = advanceSessionTime(runningFixture(), AT.due);
    const completed = applySessionCommand(due, {
      type: "COMPLETE",
      taskId: "a-work",
      at: AT.completed,
    });

    expect(completed.runtime["a-work"]).toMatchObject({
      status: "completed",
      actualEnd: AT.completed,
    });
    expect(completed.events.at(-1)).toEqual({
      sequence: 3,
      type: "TASK_COMPLETED",
      taskId: "a-work",
      at: AT.completed,
    });
    expect(completed.lastReplan).not.toBeNull();
    expect(completed.runtime["b-work"].status).toBe("ready");
  });

  it("treats an identical command as idempotent", () => {
    const running = runningFixture();
    const command = {
      type: "DELAY" as const,
      taskId: "a-work",
      at: "2026-07-18T18:02:00Z",
      delayMinutes: 2,
    };
    const once = applySessionCommand(running, command);

    expect(applySessionCommand(once, command)).toBe(once);
    expect(once.events.filter((event) => event.type === "TASK_DELAYED")).toHaveLength(1);
  });

  it("orders simultaneous due events by expected end then task id", () => {
    const { request, schedule } = sessionFixture();
    const initial = createCookingSession(request, schedule);
    const runtime = {
      ...initial.runtime,
      "a-work": {
        ...initial.runtime["a-work"],
        status: "running" as const,
        actualStart: AT.start,
        expectedEnd: AT.due,
      },
      "b-work": {
        ...initial.runtime["b-work"],
        status: "running" as const,
        actualStart: AT.start,
        expectedEnd: AT.due,
      },
    };
    const advanced = advanceSessionTime({ ...initial, runtime }, AT.due);

    expect(advanced.events.map((event) => event.taskId)).toEqual(["a-work", "b-work"]);
    expect(advanced.events.map((event) => event.sequence)).toEqual([1, 2]);
  });

  it("rejects commands that move the event history backwards", () => {
    const { request, schedule } = sessionFixture();
    const ready = advanceSessionTime(createCookingSession(request, schedule), AT.start);
    const tooEarlyStart = applySessionCommand(ready, {
      type: "START",
      taskId: "a-work",
      at: AT.before,
    });
    const running = runningFixture();
    const tooEarlyDelay = applySessionCommand(running, {
      type: "DELAY",
      taskId: "a-work",
      at: AT.before,
      delayMinutes: 2,
    });
    const tooEarlyComplete = applySessionCommand(running, {
      type: "COMPLETE",
      taskId: "a-work",
      at: AT.before,
    });

    expect(tooEarlyStart).toBe(ready);
    expect(tooEarlyDelay).toBe(running);
    expect(tooEarlyComplete).toBe(running);
  });

  it("fails closed when a delay would exceed the supported ISO range", () => {
    const running = runningFixture();
    const command = {
      type: "DELAY" as const,
      taskId: "a-work",
      at: "2026-07-18T18:02:00Z",
      delayMinutes: Number.MAX_SAFE_INTEGER,
    };

    expect(() => applySessionCommand(running, command)).not.toThrow();
    expect(applySessionCommand(running, command)).toMatchObject({
      lastCommandIssue: { code: "INVALID_DELAY", taskId: "a-work" },
    });
  });

  it("emits overdue tasks before a later command with monotonic sequence and time", () => {
    const { request, schedule } = parallelSessionFixture();
    const ready = advanceSessionTime(createCookingSession(request, schedule), AT.start);
    const first = applySessionCommand(ready, {
      type: "START", taskId: "a-work", at: AT.start,
    });
    const both = applySessionCommand(first, {
      type: "START", taskId: "b-work", at: AT.start,
    });
    const delayed = applySessionCommand(both, {
      type: "DELAY",
      taskId: "b-work",
      at: "2026-07-18T18:07:00Z",
      delayMinutes: 2,
    });

    expect(delayed.events.map((event) => event.type)).toEqual([
      "TASK_STARTED",
      "TASK_STARTED",
      "TASK_DUE",
      "TASK_DUE",
      "TASK_DELAYED",
    ]);
    expect(delayed.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5]);
    const times = delayed.events.map((event) => Date.parse(event.at));
    expect(times).toEqual([...times].sort((left, right) => left - right));
    expect(delayed.runtime["a-work"].status).toBe("due");
    expect(delayed.runtime["b-work"].status).toBe("running");
  });

  it("returns a structured resource issue when START is blocked by a due lock", () => {
    const due = advanceSessionTime(runningFixture(), AT.due);
    const rejected = applySessionCommand(due, {
      type: "START",
      taskId: "b-work",
      at: AT.due,
    });

    expect(rejected.events).toEqual(due.events);
    expect(rejected.lastCommandIssue).toEqual({
      code: "RESOURCE_LOCKED",
      taskId: "b-work",
    });
  });

  it("fails closed when START would exceed the supported ISO range", () => {
    const { request, schedule } = sessionFixture();
    const ready = advanceSessionTime(createCookingSession(request, schedule), AT.start);
    const command = {
      type: "START" as const,
      taskId: "a-work",
      at: "9999-12-31T23:59:59Z",
    };

    expect(() => applySessionCommand(ready, command)).not.toThrow();
    const rejected = applySessionCommand(ready, command);
    expect(rejected.lastCommandIssue).toEqual({
      code: "INVALID_START",
      taskId: "a-work",
    });
    expect(rejected.events).toBe(ready.events);
    expect(rejected.runtime).toBe(ready.runtime);
    expect(rejected.schedule).toBe(ready.schedule);
  });
});
