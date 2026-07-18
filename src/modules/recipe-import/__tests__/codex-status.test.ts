// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createCodexStatusChecker } from "../codex-status";

const sandboxAvailable = async () => ({
  ok: true as const,
  value: { sandboxAvailable: true as const },
});

describe("Codex local status", () => {
  it("checks version and login status without starting a model run", async () => {
    const runCommand = vi.fn(async () => ({ exitCode: 0 }));
    const check = createCodexStatusChecker({
      executable: "C:\\safe\\codex.exe",
      runCommand,
      checkCapability: sandboxAvailable,
    });

    await expect(check()).resolves.toEqual({
      ok: true,
      value: { installed: true, loggedIn: true, sandboxAvailable: true },
    });
    expect(runCommand.mock.calls).toEqual([
      ["C:\\safe\\codex.exe", ["--version"]],
      ["C:\\safe\\codex.exe", ["login", "status"]],
    ]);
    expect(JSON.stringify(runCommand.mock.calls)).not.toMatch(/exec|model|prompt/i);
  });

  it("reports missing Codex without attempting a login check", async () => {
    const runCommand = vi.fn(async () => ({ exitCode: 127 }));
    const check = createCodexStatusChecker({
      executable: "codex", runCommand, checkCapability: sandboxAvailable,
    });

    await expect(check()).resolves.toMatchObject({
      ok: false,
      error: { code: "CODEX_NOT_INSTALLED" },
    });
    expect(runCommand).toHaveBeenCalledOnce();
  });

  it("reports a missing login with stable output", async () => {
    const privateMarker = "private home path";
    const runCommand = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0 })
      .mockRejectedValueOnce(new Error(privateMarker));
    const check = createCodexStatusChecker({
      executable: "codex", runCommand, checkCapability: sandboxAvailable,
    });

    const result = await check();

    expect(result).toMatchObject({ ok: false, error: { code: "CODEX_NOT_LOGGED_IN" } });
    expect(JSON.stringify(result)).not.toContain(privateMarker);
  });

  it("reports a stable unavailable code before login when the OS gate fails", async () => {
    const runCommand = vi.fn(async () => ({ exitCode: 0 }));
    const check = createCodexStatusChecker({
      executable: "codex",
      runCommand,
      checkCapability: async () => ({
        ok: false,
        error: { code: "SANDBOX_UNAVAILABLE" as const, message: "private detail" },
      }),
    });

    const result = await check();

    expect(result).toMatchObject({
      ok: false,
      error: { code: "SANDBOX_UNAVAILABLE" },
    });
    expect(runCommand.mock.calls).toEqual([["codex", ["--version"]]]);
    expect(JSON.stringify(result)).not.toContain("private detail");
  });
});
