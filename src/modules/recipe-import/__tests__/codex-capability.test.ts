// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createLocalAiCapabilityChecker } from "../codex-capability";

function setup(exitCode: number | null, removeDirectory = vi.fn(async () => undefined)) {
  const runCommand = vi.fn(async (
    executable: string,
    args: readonly string[],
    environment: NodeJS.ProcessEnv,
  ) => {
    void executable;
    void args;
    void environment;
    return { exitCode };
  });
  const mkdir = vi.fn(async () => undefined);
  const readFile = vi.fn(async () => "DinnerSync harmless outside sandbox canary v1\n");
  const writeFile = vi.fn(async () => undefined);
  const check = createLocalAiCapabilityChecker({
    executable: "C:\\safe\\codex.exe",
    execPath: "C:\\safe\\node.exe",
    tempRoot: "C:\\safe-temp",
    outsideCanaryPath: "D:\\repo\\scripts\\codex-sandbox-outside-canary.txt",
    mkdtemp: vi.fn(async () => "C:\\safe-temp\\dinnersync-gate-abc"),
    mkdir,
    readFile,
    writeFile,
    removeDirectory,
    runCommand,
  });
  return { check, mkdir, readFile, removeDirectory, runCommand, writeFile };
}

describe("local AI OS capability gate", () => {
  it("passes only when the no-model canary proves workspace read and outside denial", async () => {
    const fixture = setup(0);

    await expect(fixture.check()).resolves.toEqual({
      ok: true,
      value: { sandboxAvailable: true },
    });

    const [executable, args, environment] = fixture.runCommand.mock.calls[0];
    expect(executable).toBe("C:\\safe\\codex.exe");
    expect(args[0]).toBe("sandbox");
    expect(args).toContain("--permission-profile");
    expect(args).toContain("C:\\safe\\node.exe");
    expect(args).toContain("D:\\repo\\scripts\\codex-sandbox-outside-canary.txt");
    expect(JSON.stringify(args)).not.toMatch(/\bexec\b|--model|gpt-/i);
    expect(environment.CODEX_HOME).toContain("dinnersync-gate-abc");
    expect(fixture.writeFile).toHaveBeenCalledOnce();
    expect(fixture.removeDirectory).toHaveBeenCalledOnce();
  });

  it("fails closed when an outside harmless canary remains readable", async () => {
    const fixture = setup(42);

    await expect(fixture.check()).resolves.toMatchObject({
      ok: false,
      error: { code: "SANDBOX_UNAVAILABLE" },
    });
  });

  it("fails closed on probe or cleanup failure and caches the result", async () => {
    const fixture = setup(0, vi.fn(async () => { throw new Error("private path"); }));

    const first = await fixture.check();
    const second = await fixture.check();

    expect(first).toMatchObject({ ok: false, error: { code: "SANDBOX_UNAVAILABLE" } });
    expect(second).toEqual(first);
    expect(fixture.runCommand).toHaveBeenCalledOnce();
    expect(JSON.stringify(first)).not.toContain("private path");
  });

  it("fails closed when the packaged harmless canary is missing or changed", async () => {
    const fixture = setup(0);
    fixture.readFile.mockResolvedValueOnce("changed");

    await expect(fixture.check()).resolves.toMatchObject({
      ok: false,
      error: { code: "SANDBOX_UNAVAILABLE" },
    });
    expect(fixture.runCommand).not.toHaveBeenCalled();
  });
});
