// @vitest-environment node

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  StatusProbeError,
  createStatusCommandRunner,
} from "../codex-status-process";

class StatusChildDouble extends EventEmitter {
  pid: number | undefined = 4321;
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn(() => true);
  unref = vi.fn();
}

function dependencies(child: StatusChildDouble, overrides: Record<string, unknown> = {}) {
  return {
    spawn: vi.fn(() => child),
    platform: "win32" as const,
    forceKillTree: vi.fn(async () => undefined),
    timeoutMs: 10,
    outputLimitBytes: 32,
    forceConfirmationMs: 100,
    ...overrides,
  };
}

describe("Codex status process boundary", () => {
  it("kills the whole tree and waits for close confirmation on timeout", async () => {
    const child = new StatusChildDouble();
    let confirmTree!: () => void;
    const forceKillTree = vi.fn(() =>
      new Promise<void>((resolve) => { confirmTree = resolve; }));
    const deps = dependencies(child, { forceKillTree });
    const run = createStatusCommandRunner(deps as never);
    const pending = run("codex.exe", ["--version"]);
    const rejection = expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });

    await vi.waitFor(
      () => expect(forceKillTree).toHaveBeenCalledWith(4321),
      { interval: 1, timeout: 100 },
    );
    await new Promise((resolve) => setTimeout(resolve, 275));
    expect(child.kill).not.toHaveBeenCalled();
    confirmTree();
    child.emit("close", null);

    await rejection;
  });

  it("uses the same bounded tree termination when output exceeds the limit", async () => {
    const child = new StatusChildDouble();
    const deps = dependencies(child);
    const run = createStatusCommandRunner(deps as never);
    const pending = run("codex.exe", ["login", "status"]);
    const rejection = expect(pending).rejects.toMatchObject({ code: "OUTPUT_LIMIT" });

    child.stderr.write("x".repeat(33));
    await vi.waitFor(() => expect(deps.forceKillTree).toHaveBeenCalledWith(4321));
    child.emit("close", null);

    await rejection;
  });

  it("reports an unconfirmed termination instead of silently abandoning the child", async () => {
    const child = new StatusChildDouble();
    child.kill.mockReturnValue(false);
    const deps = dependencies(child, {
      forceKillTree: vi.fn(async () => { throw new Error("taskkill failed"); }),
      timeoutMs: 5,
      forceConfirmationMs: 5,
    });
    const run = createStatusCommandRunner(deps as never);

    const error = await run("codex.exe", ["--version"]).catch((caught) => caught);

    expect(error).toBeInstanceOf(StatusProbeError);
    expect(error).toMatchObject({
      code: "TIMEOUT",
      terminationConfirmed: false,
      diagnostics: expect.arrayContaining([
        "FORCE_TERMINATION_FAILED",
        "FORCE_TERMINATION_UNCONFIRMED",
      ]),
    });
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(child.unref).toHaveBeenCalledOnce();
  });
});
