// @vitest-environment node

import { describe, expect, it } from "vitest";

import { resolveCodexExecutable } from "../codex-runner";

describe("resolveCodexExecutable", () => {
  it("selects the native Windows executable instead of the cmd shim", () => {
    expect(resolveCodexExecutable({
      platform: "win32",
      arch: "x64",
      env: { APPDATA: "C:\\Users\\demo\\AppData\\Roaming" },
    })).toMatch(/codex-win32-x64[\\/]vendor[\\/]x86_64-pc-windows-msvc[\\/]bin[\\/]codex\.exe$/);
  });

  it("uses codex directly on non-Windows systems", () => {
    expect(resolveCodexExecutable({ platform: "linux", arch: "x64", env: {} })).toBe("codex");
  });

  it("rejects Windows discovery without APPDATA", () => {
    expect(() => resolveCodexExecutable({
      platform: "win32",
      arch: "x64",
      env: {},
    })).toThrow(expect.objectContaining({ code: "CODEX_SPAWN_FAILED" }));
  });

  it("rejects an unsupported Windows architecture", () => {
    expect(() => resolveCodexExecutable({
      platform: "win32",
      arch: "ia32",
      env: { APPDATA: "C:\\Users\\demo\\AppData\\Roaming" },
    })).toThrow(expect.objectContaining({ code: "CODEX_SPAWN_FAILED" }));
  });
});
