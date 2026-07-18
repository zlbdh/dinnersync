// @vitest-environment node

import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { createCodexRunner } from "../codex-runner";

class ProcessDouble extends EventEmitter {
  readonly pid = 4_242;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new Writable({ write: (_chunk, _encoding, done) => done() });
  readonly killSignals: Array<NodeJS.Signals | number | undefined> = [];
  closeOnKill = false;
  errorOnKill = false;
  killResult = true;

  kill(signal?: NodeJS.Signals | number) {
    this.killSignals.push(signal);
    if (this.errorOnKill) queueMicrotask(() => this.emit("error", new Error("late")));
    if (this.closeOnKill) queueMicrotask(() => this.finish(0));
    return this.killResult;
  }

  finish(exitCode: number | null) {
    this.stdout.end();
    this.stderr.end();
    this.emit("close", exitCode, null);
  }
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    prompt: "Return JSON.",
    model: "gpt-5.6-terra",
    schema: {
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
      additionalProperties: false,
    },
    validate: (value: unknown) => value,
    timeoutMs: 5,
    ...overrides,
  };
}

function setupProcess(options: Partial<ProcessDouble> = {}, dependencyOverrides = {}) {
  const child = new ProcessDouble();
  Object.assign(child, options);
  const spawn = vi.fn(() => child);
  const forceKillTree = vi.fn(async () => child.finish(0));
  const runner = createCodexRunner({
    spawn,
    executable: "codex-test",
    forceKillTree,
    forceConfirmationMs: 20,
    resultMonitorIntervalMs: 2,
    ...dependencyOverrides,
  } as never);
  return { child, forceKillTree, runner, spawn };
}

describe("Codex process termination", () => {
  it("does not confirm a fast direct-child close when tree termination fails", async () => {
    const forceKillTree = vi.fn().mockRejectedValue(new Error("tree action failed"));
    const { runner } = setupProcess({ closeOnKill: true }, { forceKillTree });

    const error = await runner.run(request()).catch((value) => value);

    expect(forceKillTree).toHaveBeenCalledWith(4_242);
    expect(error).toMatchObject({
      code: "CODEX_TIMEOUT",
      diagnostics: ["FORCE_TERMINATION_FAILED", "FORCE_TERMINATION_UNCONFIRMED"],
      terminationConfirmed: false,
    });
  });

  it("waits for tree confirmation after the direct child has closed", async () => {
    let confirmTree!: () => void;
    const forceKillTree = vi.fn(() => new Promise<void>((resolve) => { confirmTree = resolve; }));
    const { runner } = setupProcess({ closeOnKill: true }, { forceKillTree });
    let settled = false;
    const observed = runner.run(request()).catch((value) => value);
    void observed.then(() => { settled = true; });

    await vi.waitFor(() => expect(forceKillTree).toHaveBeenCalledWith(4_242));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    confirmTree();

    await expect(observed).resolves.toMatchObject({
      code: "CODEX_TIMEOUT",
      terminationConfirmed: true,
    });
  });

  it("force-kills the process tree after SIGTERM is ignored", async () => {
    const { child, forceKillTree, runner } = setupProcess();

    const error = await runner.run(request()).catch((value) => value);

    expect(child.killSignals).toEqual(["SIGTERM"]);
    expect(forceKillTree).toHaveBeenCalledWith(4_242);
    expect(error).toMatchObject({ code: "CODEX_TIMEOUT", terminationConfirmed: true });
    expect(child.listenerCount("error")).toBe(0);
    expect(child.listenerCount("close")).toBe(0);
    expect(child.stdout.listenerCount("data")).toBe(0);
    expect(child.stderr.listenerCount("data")).toBe(0);
    expect(child.stdin.listenerCount("error")).toBe(0);
  });

  it("escalates immediately when graceful kill returns false", async () => {
    const { forceKillTree, runner } = setupProcess({ killResult: false });

    const error = await runner.run(request()).catch((value) => value);

    expect(forceKillTree).toHaveBeenCalledOnce();
    expect(error).toMatchObject({
      code: "CODEX_TIMEOUT",
      diagnostics: ["GRACEFUL_TERMINATION_FAILED"],
      terminationConfirmed: true,
    });
  });

  it("keeps the first termination reason when a later error event arrives", async () => {
    const { runner } = setupProcess({ errorOnKill: true });

    await expect(runner.run(request())).rejects.toMatchObject({
      code: "CODEX_TIMEOUT",
      diagnostics: ["TERMINATION_ERROR_IGNORED"],
      terminationConfirmed: true,
    });
  });

  it("fails in bounded time and says termination was not confirmed", async () => {
    const { runner } = setupProcess({}, {
      forceKillTree: vi.fn().mockResolvedValue(undefined),
      forceConfirmationMs: 10,
    });

    await expect(runner.run(request())).rejects.toMatchObject({
      code: "CODEX_TIMEOUT",
      diagnostics: ["FORCE_TERMINATION_UNCONFIRMED"],
      terminationConfirmed: false,
    });
  });

  it("uses best-effort result-size monitoring to terminate oversized output", async () => {
    const statResult = vi.fn().mockResolvedValue({ size: 65 });
    const { forceKillTree, runner } = setupProcess({}, { statResult });

    await expect(runner.run(request({
      maxOutputBytes: 64,
      timeoutMs: 200,
    }))).rejects.toMatchObject({
      code: "CODEX_OUTPUT_TOO_LARGE",
      terminationConfirmed: true,
    });
    expect(statResult).toHaveBeenCalled();
    expect(forceKillTree).toHaveBeenCalledWith(4_242);
    const settledCallCount = statResult.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(statResult).toHaveBeenCalledTimes(settledCallCount);
  });
});
