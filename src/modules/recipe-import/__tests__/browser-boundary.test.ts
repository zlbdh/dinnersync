// @vitest-environment node

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MODULE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("recipe-import browser barrel", () => {
  it("does not export Codex runner or any Node-only module", async () => {
    const source = await readFile(resolve(MODULE_DIR, "index.ts"), "utf8");

    expect(source).not.toMatch(/codex-(?:runner|process|executable|output|types)/);
    expect(source).not.toMatch(/node:(?:child_process|fs|os|path)/);
  });

  it("marks the privileged barrel as server-only", async () => {
    const source = await readFile(resolve(MODULE_DIR, "server.ts"), "utf8");

    expect(source).toMatch(/^import "server-only";/);
  });
});
