import type { ResourceId } from "@/shared";
import { describe, expect, it, vi } from "vitest";

import {
  canReserve,
  findEarliestResourceSlot,
  findLatestResourceSlot,
  reserve,
} from "../intervals";
import type { ResourceReservation } from "../intervals";

const minute = (value: number) => value * 60_000;

function slot(
  taskId: string,
  start: number,
  end: number,
  resourceIds: ResourceId[],
): ResourceReservation {
  return {
    taskId,
    startMs: minute(start),
    endMs: minute(end),
    resourceIds,
  };
}

describe("resource interval reservations", () => {
  it("treats intervals as half-open so touching boundaries do not conflict", () => {
    const existing = [slot("first", 0, 10, ["cook:1"])];

    expect(canReserve(existing, slot("after", 10, 15, ["cook:1"]))).toBe(true);
    expect(canReserve(existing, slot("before", -5, 0, ["cook:1"]))).toBe(true);
    expect(canReserve(existing, slot("overlap", 9, 11, ["cook:1"]))).toBe(false);
  });

  it.each(["cook:1", "oven:1"] as const)(
    "enforces capacity one for %s",
    (resourceId) => {
      const existing = [slot("first", 0, 10, [resourceId])];
      expect(canReserve(existing, slot("second", 2, 8, [resourceId]))).toBe(false);
    },
  );

  it("allows both shared burners in parallel but not duplicate use of one burner", () => {
    const existing = [slot("pan-a", 0, 10, ["burner:1"])];

    expect(canReserve(existing, slot("pan-b", 0, 10, ["burner:2"]))).toBe(true);
    expect(canReserve(existing, slot("pan-c", 0, 10, ["burner:1"]))).toBe(false);
  });

  it("checks and reserves all resources atomically", () => {
    const existing = [slot("oven-busy", 0, 10, ["oven:1"])];
    const candidate = slot("active-roast", 2, 8, ["cook:1", "oven:1"]);

    expect(canReserve(existing, candidate)).toBe(false);
    expect(reserve(existing, candidate)).toBeNull();
    expect(existing).toEqual([slot("oven-busy", 0, 10, ["oven:1"])]);
    expect(canReserve(existing, slot("cook-only", 2, 8, ["cook:1"]))).toBe(true);
  });

  it("returns a new deterministically sorted reservation book", () => {
    const original = [slot("later", 10, 20, ["oven:1"])];
    const result = reserve(original, slot("earlier", 0, 5, ["burner:2", "cook:1"]));

    expect(result).toEqual([
      slot("earlier", 0, 5, ["cook:1", "burner:2"]),
      slot("later", 10, 20, ["oven:1"]),
    ]);
    expect(original).toEqual([slot("later", 10, 20, ["oven:1"])]);
  });

  it.each([
    slot("zero", 1, 1, ["cook:1"]),
    slot("reverse", 2, 1, ["cook:1"]),
    { ...slot("nan", 0, 1, ["cook:1"]), startMs: Number.NaN },
    slot("no-resource", 0, 1, []),
  ])("fails closed for an invalid candidate without throwing", (candidate) => {
    expect(() => canReserve([], candidate)).not.toThrow();
    expect(canReserve([], candidate)).toBe(false);
    expect(reserve([], candidate)).toBeNull();
  });

  it("does not read the system clock", () => {
    const clock = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("clock access is forbidden");
    });
    try {
      expect(reserve([], slot("pure", 0, 1, ["cook:1"]))).toHaveLength(1);
    } finally {
      clock.mockRestore();
    }
  });

  it("jumps across multi-billion-minute conflicts without scanning each minute", () => {
    const horizonMinutes = 5_000_000_000;
    const search = {
      taskId: "candidate",
      notBeforeMs: minute(0),
      notAfterMs: minute(horizonMinutes),
      durationMs: minute(1),
      stepMs: minute(1),
      resourceIds: ["oven:1" as const],
    };
    expect(findEarliestResourceSlot([
      slot("busy", 0, horizonMinutes - 1, ["oven:1"]),
    ], search)).toEqual({
      startMs: minute(horizonMinutes - 1),
      endMs: minute(horizonMinutes),
    });
    expect(findLatestResourceSlot([
      slot("busy", 1, horizonMinutes, ["oven:1"]),
    ], search)).toEqual({ startMs: minute(0), endMs: minute(1) });
  });
});
