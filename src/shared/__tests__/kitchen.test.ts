import { describe, expect, it } from "vitest";

import {
  effectiveResources,
  isKitchenResources,
  isResourceId,
  isResourceRequirement,
  isTaskMode,
} from "../index";
import type { ResourceRequirement } from "../index";

describe("effectiveResources", () => {
  it("adds cook:1 to active work, removes duplicates, and uses fixed order", () => {
    const requirements: ResourceRequirement[] = [
      { resourceId: "burner:2" },
      { resourceId: "oven:1" },
      { resourceId: "burner:1" },
      { resourceId: "oven:1" },
    ];

    expect(effectiveResources("active", requirements)).toEqual([
      { resourceId: "cook:1" },
      { resourceId: "oven:1" },
      { resourceId: "burner:1" },
      { resourceId: "burner:2" },
    ]);
  });

  it("does not duplicate an explicitly required cook", () => {
    expect(effectiveResources("active", [
      { resourceId: "cook:1" },
      { resourceId: "cook:1" },
    ])).toEqual([{ resourceId: "cook:1" }]);
  });

  it("does not add a cook to passive work but preserves an explicit one", () => {
    expect(effectiveResources("passive", [
      { resourceId: "burner:2" },
      { resourceId: "oven:1" },
    ])).toEqual([
      { resourceId: "oven:1" },
      { resourceId: "burner:2" },
    ]);
    expect(effectiveResources("passive", [
      { resourceId: "cook:1" },
    ])).toEqual([{ resourceId: "cook:1" }]);
  });

  it("does not mutate the caller's frozen requirements", () => {
    const requirements = Object.freeze([
      Object.freeze({ resourceId: "burner:1" as const }),
      Object.freeze({ resourceId: "oven:1" as const }),
    ]);
    const before = structuredClone(requirements);

    const result = effectiveResources("active", requirements);

    expect(requirements).toEqual(before);
    expect(result).not.toBe(requirements);
  });

  it("rejects unknown runtime modes and resources", () => {
    expect(() => effectiveResources("timed" as never, [])).toThrow(TypeError);
    expect(() => effectiveResources("passive", [
      { resourceId: "sink:1" },
    ] as never)).toThrow(TypeError);
    expect(() => effectiveResources("active", null as never)).toThrow(
      TypeError,
    );
  });
});

describe("kitchen runtime guards", () => {
  it("recognizes only the four fixed resource IDs", () => {
    expect([
      "cook:1",
      "oven:1",
      "burner:1",
      "burner:2",
    ].every(isResourceId)).toBe(true);
    expect(isResourceId("cook:2")).toBe(false);
    expect(isResourceId("burner:3")).toBe(false);
    expect(isResourceId(null)).toBe(false);
  });

  it("recognizes only active and passive task modes", () => {
    expect(isTaskMode("active")).toBe(true);
    expect(isTaskMode("passive")).toBe(true);
    expect(isTaskMode("timed")).toBe(false);
  });

  it("validates resource requirements at a runtime boundary", () => {
    expect(isResourceRequirement({ resourceId: "oven:1" })).toBe(true);
    expect(isResourceRequirement({ resourceId: "sink:1" })).toBe(false);
    expect(isResourceRequirement({})).toBe(false);
    expect(isResourceRequirement(null)).toBe(false);
  });

  it("accepts exactly one cook, one oven, and one or two burners", () => {
    expect(isKitchenResources({ cooks: 1, ovens: 1, burners: 1 })).toBe(true);
    expect(isKitchenResources({ cooks: 1, ovens: 1, burners: 2 })).toBe(true);
    expect(isKitchenResources({ cooks: 2, ovens: 1, burners: 2 })).toBe(false);
    expect(isKitchenResources({ cooks: 1, ovens: 0, burners: 2 })).toBe(false);
    expect(isKitchenResources({ cooks: 1, ovens: 1, burners: 3 })).toBe(false);
    expect(isKitchenResources(null)).toBe(false);
  });
});
