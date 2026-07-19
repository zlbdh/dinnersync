// @vitest-environment node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const scriptPath = fileURLToPath(new URL("./validate-demo.mjs", import.meta.url));

function run(...args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
  });
}

describe("validate-demo CLI", () => {
  it("requires an explicit plan or final mode", () => {
    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage:");
    expect(result.stderr).toContain("--plan");
    expect(result.stderr).toContain("--final <mp4>");
  });

  it("fails final mode when the MP4 is absent", () => {
    const result = run("--final", "missing.mp4");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Final MP4 does not exist:");
  });
});
