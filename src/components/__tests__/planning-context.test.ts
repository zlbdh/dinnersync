import { describe, expect, it } from "vitest";

import {
  parsePlanningContext,
  projectPlanningInstant,
  serializePlanningContext,
} from "../planning-context";

const VIRTUAL_START = "2026-07-19T10:00:00.000Z";
const REVISION = "4f1aa33d-7b62-47a4-935e-1d63833fd7c0";

describe("planning context clock", () => {
  it("projects virtual cooking time from absolute wall-clock elapsed time", () => {
    const snapshot = parsePlanningContext(JSON.stringify({
      version: 1,
      revision: REVISION,
      mode: "hosted",
      virtualAt: VIRTUAL_START,
      wallClockMs: 1_000,
    }), REVISION);

    expect(snapshot).not.toBeNull();
    expect(projectPlanningInstant(snapshot!, 301_000)).toBe(
      "2026-07-19T10:05:00.000Z",
    );
  });

  it("never rewinds when the system wall clock moves behind the saved anchor", () => {
    const snapshot = parsePlanningContext(JSON.stringify({
      version: 1,
      revision: REVISION,
      mode: "local",
      virtualAt: VIRTUAL_START,
      wallClockMs: 5_000,
    }), REVISION);

    expect(projectPlanningInstant(snapshot!, 1_000)).toBe(VIRTUAL_START);
  });

  it("round-trips only the strict non-sensitive context fields", () => {
    const serialized = serializePlanningContext(
      "local",
      VIRTUAL_START,
      42_000,
      REVISION,
    );

    expect(JSON.parse(serialized)).toEqual({
      version: 1,
      revision: REVISION,
      mode: "local",
      virtualAt: VIRTUAL_START,
      wallClockMs: 42_000,
    });
    expect(parsePlanningContext(serialized, REVISION)).toEqual(JSON.parse(serialized));
    expect(parsePlanningContext(serialized, "caabcb40-e77f-4418-85a4-b7538f274fa0"))
      .toBeNull();
  });

  it.each([
    null,
    "not-json",
    " ".repeat(2_049),
    JSON.stringify({ version: 1, mode: "unknown", virtualAt: VIRTUAL_START, wallClockMs: 1 }),
    JSON.stringify({ version: 1, revision: "not-a-revision", mode: "hosted", virtualAt: VIRTUAL_START, wallClockMs: 1 }),
    JSON.stringify({ version: 1, mode: "hosted", virtualAt: "bad", wallClockMs: 1 }),
    JSON.stringify({ version: 1, mode: "hosted", virtualAt: VIRTUAL_START, wallClockMs: 1, token: "x" }),
  ])("rejects a missing or untrusted context snapshot", (serialized) => {
    expect(parsePlanningContext(serialized, REVISION)).toBeNull();
  });
});
