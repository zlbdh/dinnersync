// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { waitForOwnedServer } from "./capture-server.mjs";

describe("waitForOwnedServer", () => {
  it("does not accept a 200 response before its own child announces readiness", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true }));
    const server = {
      child: { exitCode: null },
      error: () => undefined,
      output: () => "Starting...",
    };

    await expect(waitForOwnedServer(server, "http://127.0.0.1:3211", {
      attempts: 2,
      delayImpl: async () => undefined,
      fetchImpl,
    })).rejects.toThrowError("Production server did not become ready.");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
