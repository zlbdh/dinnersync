// @vitest-environment node

import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { createForceKillTree } from "../codex-process";

class TaskkillDouble extends EventEmitter {
  kill = vi.fn(() => true);
}

describe("force-kill process tree", () => {
  it("uses a negative process-group id with SIGKILL on POSIX", async () => {
    const processKill = vi.fn();
    const spawnTree = vi.fn();
    const forceKillTree = createForceKillTree({
      platform: "linux",
      processKill,
      spawnTree,
    } as never);

    await forceKillTree(321);

    expect(processKill).toHaveBeenCalledWith(-321, "SIGKILL");
    expect(spawnTree).not.toHaveBeenCalled();
  });

  it("runs taskkill with an exact PID and no shell on Windows", async () => {
    const child = new TaskkillDouble();
    const spawnTree = vi.fn(() => child);
    const forceKillTree = createForceKillTree({
      platform: "win32",
      processKill: vi.fn(),
      spawnTree,
      taskkillTimeoutMs: 50,
    } as never);
    const pending = forceKillTree(654);
    queueMicrotask(() => child.emit("close", 0));

    await pending;

    expect(spawnTree).toHaveBeenCalledWith(
      "taskkill.exe",
      ["/PID", "654", "/T", "/F"],
      { shell: false, stdio: "ignore", windowsHide: true },
    );
  });

  it("rejects invalid PIDs without touching another process", async () => {
    const processKill = vi.fn();
    const spawnTree = vi.fn();
    const forceKillTree = createForceKillTree({
      platform: "linux",
      processKill,
      spawnTree,
    } as never);

    await expect(forceKillTree(0)).rejects.toThrow();
    await expect(forceKillTree(Number.NaN)).rejects.toThrow();
    expect(processKill).not.toHaveBeenCalled();
    expect(spawnTree).not.toHaveBeenCalled();
  });

  it("bounds a stuck taskkill process and rejects the force action", async () => {
    const child = new TaskkillDouble();
    const forceKillTree = createForceKillTree({
      platform: "win32",
      processKill: vi.fn(),
      spawnTree: vi.fn(() => child),
      taskkillTimeoutMs: 5,
    } as never);

    await expect(forceKillTree(777)).rejects.toThrow("TASKKILL_TIMEOUT");
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });
});
