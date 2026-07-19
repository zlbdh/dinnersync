// @vitest-environment node

import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { validateDemoPlan } from "./demo-plan-validation.mjs";

const storyboardPath = new URL("../docs/submission/storyboard.json", import.meta.url);
const scriptPath = new URL("../docs/submission/demo-script.md", import.meta.url);

describe("validateDemoPlan", () => {
  it("requires the exact Local AI model used by the application", async () => {
    const [storyboardSource, script] = await Promise.all([
      readFile(storyboardPath, "utf8"),
      readFile(scriptPath, "utf8"),
    ]);

    const result = validateDemoPlan(JSON.parse(storyboardSource), script);

    expect(result.localModel).toBe("gpt-5.6-terra");
  });

  it("rejects a generic GPT-5.6 claim even when the shot copy is exact", async () => {
    const [storyboardSource, script] = await Promise.all([
      readFile(storyboardPath, "utf8"),
      readFile(scriptPath, "utf8"),
    ]);
    const storyboard = JSON.parse(storyboardSource);
    storyboard.claims.localModel = "GPT-5.6";

    expect(() => validateDemoPlan(storyboard, script))
      .toThrowError("Local model claim must be gpt-5.6-terra.");
  });
});
