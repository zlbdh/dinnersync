// @vitest-environment node

import { EventEmitter } from "node:events";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import { PassThrough, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import {
  CodexRunnerError,
  createCodexRunner,
} from "../codex-runner";

const strictSchema = {
  type: "object",
  properties: { ok: { type: "boolean", const: true } },
  required: ["ok"],
  additionalProperties: false,
} as const;

type SpawnCall = {
  command: string;
  args: string[];
  options: Record<string, unknown>;
};

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdinChunks: Buffer[] = [];
  readonly stdin = new Writable({
    write: (chunk, _encoding, callback) => {
      this.stdinChunks.push(Buffer.from(chunk));
      callback();
    },
  });
  killedWith: NodeJS.Signals | number | undefined;

  kill(signal?: NodeJS.Signals | number) {
    this.killedWith = signal;
    queueMicrotask(() => this.emit("close", null, signal ?? "SIGTERM"));
    return true;
  }

  finish(exitCode = 0) {
    this.stdout.end();
    this.stderr.end();
    this.emit("close", exitCode, null);
  }

  get stdinText() {
    return Buffer.concat(this.stdinChunks).toString("utf8");
  }
}

function outputPath(args: string[]) {
  const index = args.indexOf("--output-last-message");
  if (index < 0 || !args[index + 1]) throw new Error("missing output path");
  return args[index + 1];
}

function fakeSpawn(
  behavior: (child: FakeChild, call: SpawnCall) => Promise<void> | void,
) {
  const calls: SpawnCall[] = [];
  let child: FakeChild | undefined;
  const spawn = vi.fn((command: string, args: string[], options: object) => {
    const call = { command, args, options: { ...options } };
    calls.push(call);
    child = new FakeChild();
    queueMicrotask(async () => behavior(child!, call));
    return child;
  });
  return { spawn, calls, get child() { return child; } };
}

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    prompt: "Return structured data for this recipe.",
    model: "gpt-5.6-sol",
    schema: strictSchema,
    validate: (value: unknown) => {
      if ((value as { ok?: unknown }).ok !== true) throw new Error("invalid");
      return value as { ok: true };
    },
    ...overrides,
  };
}

function testRunner(dependencies: Record<string, unknown> = {}) {
  return createCodexRunner({
    platform: "linux",
    checkCapability: vi.fn(async () => ({
      ok: true,
      value: { sandboxAvailable: true as const },
    })),
    ...dependencies,
  } as never);
}

describe("CodexRunner", () => {
  it("uses the verified model unchanged with an isolated least-read invocation", async () => {
    const fake = fakeSpawn(async (child, call) => {
      const schemaIndex = call.args.indexOf("--output-schema");
      await expect(readFile(call.args[schemaIndex + 1], "utf8")).resolves.toBe(
        JSON.stringify(strictSchema),
      );
      await writeFile(outputPath(call.args), '{"ok":true}', "utf8");
      child.stdout.write("progress");
      child.finish(0);
    });
    const runner = testRunner({
      spawn: fake.spawn as never,
      executable: "C:\\safe\\codex.exe",
    });

    await expect(runner.run(validRequest())).resolves.toEqual({ ok: true });

    const call = fake.calls[0];
    expect(call.command).toBe("C:\\safe\\codex.exe");
    expect(call.args.slice(0, 3)).toEqual(["exec", "--model", "gpt-5.6-sol"]);
    expect(call.args).not.toContain("--sandbox");
    expect(call.args).toEqual(expect.arrayContaining([
      "--ephemeral", "--ignore-user-config", "--ignore-rules",
      "--config", 'default_permissions="dinnersync-local-ai"',
      "--config", 'permissions.dinnersync-local-ai.filesystem.:root="deny"',
      "--config", 'permissions.dinnersync-local-ai.network.enabled=false',
      "--config", 'shell_environment_policy.inherit="none"',
      "--config", 'approval_policy="never"', "--strict-config",
      "--output-schema", "--output-last-message", "--skip-git-repo-check", "--cd", "-",
    ]));
    expect(call.options).toMatchObject({ shell: false, windowsHide: true });
    expect(call.options.cwd).toEqual(expect.any(String));
    expect(fake.child?.stdinText).toBe("Return structured data for this recipe.");
    expect(call.args).not.toContain("Return structured data for this recipe.");
    expect(call.args[call.args.indexOf("--cd") + 1]).toBe(call.options.cwd);
    await expect(access(call.options.cwd as string)).rejects.toThrow();
  });

  it("rejects a model that was not verified without spawning", async () => {
    const fake = fakeSpawn(() => undefined);
    const runner = testRunner({ spawn: fake.spawn as never });

    await expect(runner.run(validRequest({ model: "gpt-4o" }))).rejects.toMatchObject({
      code: "CODEX_MODEL_NOT_VERIFIED",
    });
    expect(fake.spawn).not.toHaveBeenCalled();
  });

  it("does not mutate a frozen caller request while applying defaults", async () => {
    const fake = fakeSpawn(async (child, call) => {
      await writeFile(outputPath(call.args), '{"ok":true}', "utf8");
      child.finish(0);
    });
    const runner = testRunner({ spawn: fake.spawn as never });

    await expect(runner.run(Object.freeze(validRequest()))).resolves.toEqual({ ok: true });
  });

  it("preserves a primary error when isolated-directory cleanup also fails", async () => {
    const fake = fakeSpawn((child) => child.finish(7));
    const runner = testRunner({
      spawn: fake.spawn,
      removeDirectory: vi.fn(async (path, options) => {
        await rm(path, options);
        throw new Error("private path");
      }),
    } as never);

    const error = await runner.run(validRequest()).catch((value) => value);

    expect(error).toMatchObject({
      code: "CODEX_EXIT_FAILED",
      diagnostics: ["TEMP_CLEANUP_FAILED"],
    });
    expect(String(error)).not.toContain("private path");
  });

  it("reports cleanup failure only when the main operation succeeded", async () => {
    const fake = fakeSpawn(async (child, call) => {
      await writeFile(outputPath(call.args), '{"ok":true}', "utf8");
      child.finish(0);
    });
    const runner = testRunner({
      spawn: fake.spawn,
      removeDirectory: vi.fn(async (path, options) => {
        await rm(path, options);
        throw new Error("private path");
      }),
    } as never);

    await expect(runner.run(validRequest())).rejects.toMatchObject({
      code: "CODEX_CLEANUP_FAILED",
    });
  });

  it("keeps invalid-output semantics when cleanup also fails", async () => {
    const fake = fakeSpawn(async (child, call) => {
      await writeFile(outputPath(call.args), '{"ok":false}', "utf8");
      child.finish(0);
    });
    const removeDirectory = vi.fn(async (path: string, options: { recursive: boolean; force: boolean }) => {
      await rm(path, options);
      throw new Error("private path");
    });
    const runner = testRunner({ spawn: fake.spawn, removeDirectory });
    await expect(runner.run(validRequest())).rejects.toMatchObject({
      code: "CODEX_INVALID_OUTPUT", diagnostics: ["TEMP_CLEANUP_FAILED"],
    });
  });

  it("reports a non-zero exit without exposing stderr", async () => {
    const fake = fakeSpawn((child) => {
      child.stderr.write("sensitive-stderr-marker");
      child.finish(9);
    });
    const runner = testRunner({ spawn: fake.spawn as never });

    const error = await runner.run(validRequest()).catch((value) => value);
    expect(error).toBeInstanceOf(CodexRunnerError);
    expect(error).toMatchObject({ code: "CODEX_EXIT_FAILED", exitCode: 9 });
    expect(String(error)).not.toContain("sensitive-stderr-marker");
  });

  it("terminates a timed-out child", async () => {
    const fake = fakeSpawn(() => undefined);
    const runner = testRunner({ spawn: fake.spawn as never });

    await expect(runner.run(validRequest({ timeoutMs: 10 }))).rejects.toMatchObject({
      code: "CODEX_TIMEOUT",
    });
    expect(fake.child?.killedWith).toBe("SIGTERM");
  });

  it("terminates a child when the AbortSignal is cancelled", async () => {
    const fake = fakeSpawn(() => undefined);
    const runner = testRunner({ spawn: fake.spawn as never });
    const controller = new AbortController();
    const pending = runner.run(validRequest({ signal: controller.signal }));

    while (!fake.child) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "CODEX_ABORTED" });
    expect(fake.child?.killedWith).toBe("SIGTERM");
  });

  it("rejects a successful process that produced no result", async () => {
    const fake = fakeSpawn((child) => child.finish(0));
    const runner = testRunner({ spawn: fake.spawn as never });

    await expect(runner.run(validRequest())).rejects.toMatchObject({
      code: "CODEX_NO_OUTPUT",
    });
  });

  it("maps JSON parse and injected validation failures to a safe error", async () => {
    const fake = fakeSpawn(async (child, call) => {
      await writeFile(outputPath(call.args), '{"ok":false}', "utf8");
      child.finish(0);
    });

    await expect(testRunner({ spawn: fake.spawn as never }).run(
      validRequest(),
    )).rejects.toMatchObject({ code: "CODEX_INVALID_OUTPUT" });
  });

  it("bounds both the result file and process streams", async () => {
    const fileFake = fakeSpawn(async (child, call) => {
      await writeFile(outputPath(call.args), `{"data":"${"x".repeat(100)}"}`, "utf8");
      child.finish(0);
    });
    const streamFake = fakeSpawn((child) => {
      child.stdout.write("x".repeat(101));
    });

    await expect(testRunner({ spawn: fileFake.spawn as never }).run(
      validRequest({ maxOutputBytes: 64 }),
    )).rejects.toMatchObject({ code: "CODEX_OUTPUT_TOO_LARGE" });
    await expect(testRunner({ spawn: streamFake.spawn as never }).run(
      validRequest({ maxOutputBytes: 64 }),
    )).rejects.toMatchObject({ code: "CODEX_OUTPUT_TOO_LARGE" });
    expect(streamFake.child?.killedWith).toBe("SIGTERM");
  });

  it("fails before creating or spawning a model process when isolation is unavailable", async () => {
    const fake = fakeSpawn(() => undefined);
    const runner = createCodexRunner({
      spawn: fake.spawn as never,
      checkCapability: vi.fn(async () => ({
        ok: false,
        error: { code: "SANDBOX_UNAVAILABLE", message: "private detail" },
      })),
    } as never);

    await expect(runner.run(validRequest())).rejects.toMatchObject({
      code: "CODEX_SANDBOX_UNAVAILABLE",
    });
    expect(fake.spawn).not.toHaveBeenCalled();
  });
});
