import { describe, expect, it } from "vitest";

import {
  advanceSessionTime,
  applySessionCommand,
  createCookingSession,
} from "../index";
import { AT, sessionFixture } from "./fixtures";

describe("cooking session clock", () => {
  it("keeps a task scheduled before its planned start", () => {
    const { request, schedule } = sessionFixture();
    const state = advanceSessionTime(
      createCookingSession(request, schedule),
      AT.before,
    );

    expect(state.runtime["a-work"].status).toBe("scheduled");
    expect(state.events).toEqual([]);
  });

  it("derives ready exactly at planned start without writing an event", () => {
    const { request, schedule } = sessionFixture();
    const state = advanceSessionTime(
      createCookingSession(request, schedule),
      AT.start,
    );

    expect(state.runtime["a-work"].status).toBe("ready");
    expect(state.runtime["b-work"].status).toBe("scheduled");
    expect(state.events).toEqual([]);
  });

  it("marks a running task due once and keeps its resource locked", () => {
    const { request, schedule } = sessionFixture();
    const ready = advanceSessionTime(createCookingSession(request, schedule), AT.start);
    const running = applySessionCommand(ready, {
      type: "START",
      taskId: "a-work",
      at: AT.start,
    });
    const due = advanceSessionTime(running, AT.due);
    const repeated = advanceSessionTime(due, AT.due);

    expect(due.runtime["a-work"].status).toBe("due");
    expect(due.runtime["b-work"].status).toBe("scheduled");
    expect(due.events.at(-1)).toEqual({
      sequence: 2,
      type: "TASK_DUE",
      taskId: "a-work",
      at: "2026-07-18T18:05:00.000Z",
    });
    expect(repeated).toEqual(due);
  });
});
