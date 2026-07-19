import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDinnerSyncController } from "../use-dinner-sync-controller";

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("useDinnerSyncController hydration", () => {
  it("does not label the planning origin as Hosted before hydration completes", () => {
    const queued: VoidFunction[] = [];
    vi.stubGlobal("queueMicrotask", (callback: VoidFunction) => {
      queued.push(callback);
    });

    const view = renderHook(() => useDinnerSyncController());

    expect(view.result.current.hydrated).toBe(false);
    expect(view.result.current.origin).toBeNull();
    view.unmount();
  });
});
