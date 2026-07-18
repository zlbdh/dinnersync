import { describe, expect, it } from "vitest";

import {
  advanceSessionTime,
  applySessionCommand,
  createCookingSession,
  createSessionPersistence,
  restoreSession,
  serializeSession,
  snapshotSession,
} from "../index";
import { AT, parallelSessionFixture, sessionFixture } from "./fixtures";

function seed() {
  const { request, schedule } = sessionFixture();
  return { request, initialSchedule: schedule };
}

function runningState() {
  const { request, schedule } = sessionFixture();
  const ready = advanceSessionTime(createCookingSession(request, schedule), AT.start);
  return applySessionCommand(ready, {
    type: "START",
    taskId: "a-work",
    at: AT.start,
  });
}

describe("session persistence", () => {
  it("writes only V1 source data and restores by replay before advancing time", () => {
    const running = runningState();
    const snapshot = snapshotSession(running);

    expect(Object.keys(snapshot).sort()).toEqual([
      "events",
      "initialSchedule",
      "request",
      "version",
    ]);
    expect(snapshot).not.toHaveProperty("runtime");
    expect(snapshot).not.toHaveProperty("schedule");

    const restored = restoreSession(serializeSession(running), seed(), AT.due);
    expect(restored.runtime["a-work"].status).toBe("due");
    expect(restored.runtime["a-work"].actualEnd).toBeNull();
    expect(restored.events.map((event) => event.type)).toEqual([
      "TASK_STARTED",
      "TASK_DUE",
    ]);
  });

  it("returns a detached snapshot that cannot mutate the active session", () => {
    const state = runningState();
    const snapshot = snapshotSession(state);

    snapshot.request.tasks.pop();
    snapshot.initialSchedule.tasks.pop();
    snapshot.events.pop();

    expect(state.request.tasks).toHaveLength(4);
    expect(state.initialSchedule.tasks).toHaveLength(4);
    expect(state.events).toHaveLength(1);
  });

  it("does not alias the live schedule with the immutable initial schedule", () => {
    const source = seed();
    const state = createCookingSession(source.request, source.initialSchedule);

    state.schedule.tasks.pop();

    expect(state.initialSchedule.tasks).toHaveLength(4);
  });

  it("does not retain the caller's mutable request reference", () => {
    const source = seed();
    const state = createCookingSession(source.request, source.initialSchedule);

    source.request.tasks.pop();
    source.request.kitchen.burners = 1;

    expect(state.request.tasks).toHaveLength(4);
    expect(state.request.kitchen.burners).toBe(2);
    expect(Object.keys(state.runtime)).toHaveLength(4);
    expect(state.schedule.tasks).toHaveLength(4);
  });

  it("replays delay and complete events without overwriting actual fields", () => {
    const due = advanceSessionTime(runningState(), AT.due);
    const delayed = applySessionCommand(due, {
      type: "DELAY",
      taskId: "a-work",
      at: AT.completed,
      delayMinutes: 2,
    });
    const completed = applySessionCommand(delayed, {
      type: "COMPLETE",
      taskId: "a-work",
      at: "2026-07-18T18:07:00Z",
    });
    const restored = restoreSession(
      serializeSession(completed),
      seed(),
      "2026-07-18T18:08:00Z",
    );

    expect(restored.runtime["a-work"]).toMatchObject({
      status: "completed",
      actualStart: AT.start,
      actualEnd: "2026-07-18T18:07:00Z",
      expectedEnd: "2026-07-18T18:08:00.000Z",
    });
    expect(restored.events).toEqual(completed.events);
  });

  it.each([
    ["damaged JSON", "{"],
    ["unknown version", JSON.stringify({ version: 2 })],
    ["invalid sequence", JSON.stringify({
      ...snapshotSession(runningState()),
      events: [{
        sequence: 2,
        type: "TASK_STARTED",
        taskId: "a-work",
        at: AT.start,
      }],
    })],
  ])("recovers to a safe reset for %s", (_label, serialized) => {
    const restored = restoreSession(serialized, seed(), AT.before);

    expect(restored.events).toEqual([]);
    expect(restored.runtime["a-work"].status).toBe("scheduled");
    expect(restored.warnings).toContainEqual(expect.objectContaining({
      code: "SNAPSHOT_RECOVERED",
    }));
  });

  it("falls back to memory when the localStorage getter throws", () => {
    const persistence = createSessionPersistence("dinnersync", () => {
      throw new Error("blocked getter");
    });
    const saved = persistence.save(runningState());
    const restored = persistence.restore(seed(), AT.due);

    expect(saved.warnings).toContainEqual(expect.objectContaining({
      code: "STORAGE_UNAVAILABLE",
    }));
    expect(restored.runtime["a-work"].status).toBe("due");
    expect(restored.warnings).toContainEqual(expect.objectContaining({
      code: "STORAGE_UNAVAILABLE",
    }));
  });

  it("warns when localStorage is absent instead of silently using memory", () => {
    const persistence = createSessionPersistence("dinnersync", () => null);
    const saved = persistence.save(runningState());

    expect(saved.warnings).toContainEqual(expect.objectContaining({
      code: "STORAGE_UNAVAILABLE",
    }));
  });

  it("falls back to memory when localStorage reads and writes throw", () => {
    const brokenStorage = {
      getItem() { throw new Error("read blocked"); },
      setItem() { throw new Error("write blocked"); },
      removeItem() { throw new Error("remove blocked"); },
    };
    const persistence = createSessionPersistence("dinnersync", () => brokenStorage);
    const saved = persistence.save(runningState());
    const restored = persistence.restore(seed(), AT.due);

    expect(saved.warnings.some((entry) => entry.code === "STORAGE_UNAVAILABLE")).toBe(true);
    expect(restored.runtime["a-work"].status).toBe("due");
    expect(restored.warnings.some((entry) => entry.code === "STORAGE_UNAVAILABLE")).toBe(true);
  });

  it("rejects a forged initial timeline with overlapping resource claims", () => {
    const source = snapshotSession(runningState());
    const forged = structuredClone(source);
    const bWork = forged.initialSchedule.tasks.find((task) => task.taskId === "b-work")!;
    bWork.plannedStart = AT.start;
    bWork.plannedEnd = AT.due;
    const restored = restoreSession(JSON.stringify(forged), seed(), AT.before);

    expect(restored.events).toEqual([]);
    expect(restored.initialSchedule).toEqual(seed().initialSchedule);
    expect(restored.warnings).toContainEqual(expect.objectContaining({
      code: "SNAPSHOT_RECOVERED",
    }));
  });

  it("recovers when a valid-shaped delay event overflows the ISO range", () => {
    const forged = snapshotSession(runningState());
    forged.events.push({
      sequence: 2,
      type: "TASK_DELAYED",
      taskId: "a-work",
      at: "2026-07-18T18:02:00Z",
      delayMinutes: Number.MAX_SAFE_INTEGER,
    });
    const serialized = JSON.stringify(forged);

    expect(() => restoreSession(serialized, seed(), AT.before)).not.toThrow();
    const restored = restoreSession(serialized, seed(), AT.before);
    expect(restored.events).toEqual([]);
    expect(restored.warnings).toContainEqual(expect.objectContaining({
      code: "SNAPSHOT_RECOVERED",
    }));
  });

  it("replays multiple due events before a later command without reordering", () => {
    const source = parallelSessionFixture();
    const ready = advanceSessionTime(
      createCookingSession(source.request, source.schedule),
      AT.start,
    );
    const first = applySessionCommand(ready, {
      type: "START", taskId: "a-work", at: AT.start,
    });
    const both = applySessionCommand(first, {
      type: "START", taskId: "b-work", at: AT.start,
    });
    const delayed = applySessionCommand(both, {
      type: "DELAY", taskId: "b-work", at: "2026-07-18T18:07:00Z",
      delayMinutes: 2,
    });
    const restored = restoreSession(
      serializeSession(delayed),
      { request: source.request, initialSchedule: source.schedule },
      "2026-07-18T18:07:00Z",
    );

    expect(restored.events).toEqual(delayed.events);
    expect(restored.warnings.some((entry) => entry.code === "SNAPSHOT_RECOVERED"))
      .toBe(false);
  });

  it("rejects an initial schedule whose serveAt diverges from its request", () => {
    const source = snapshotSession(createCookingSession(
      seed().request,
      seed().initialSchedule,
    ));
    const forged = structuredClone(source);
    forged.initialSchedule.serveAt = "2026-07-18T19:11:00Z";
    forged.initialSchedule.tasks.forEach((task) => {
      task.plannedStart = new Date(Date.parse(task.plannedStart) + 3_600_000).toISOString();
      task.plannedEnd = new Date(Date.parse(task.plannedEnd) + 3_600_000).toISOString();
    });
    const restored = restoreSession(JSON.stringify(forged), seed(), AT.before);

    expect(restored.initialSchedule).toEqual(seed().initialSchedule);
    expect(restored.warnings).toContainEqual(expect.objectContaining({
      code: "SNAPSHOT_RECOVERED",
    }));
  });

  it("recovers when replaying START would exceed the supported ISO range", () => {
    const forged = snapshotSession(createCookingSession(
      seed().request,
      seed().initialSchedule,
    ));
    forged.events.push({
      sequence: 1,
      type: "TASK_STARTED",
      taskId: "a-work",
      at: "9999-12-31T23:59:59Z",
    });

    expect(() => restoreSession(JSON.stringify(forged), seed(), AT.before)).not.toThrow();
    const restored = restoreSession(JSON.stringify(forged), seed(), AT.before);
    expect(restored.events).toEqual([]);
    expect(restored.warnings).toContainEqual(expect.objectContaining({
      code: "SNAPSHOT_RECOVERED",
    }));
  });
});
