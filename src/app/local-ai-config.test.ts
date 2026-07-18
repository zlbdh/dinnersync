// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("local AI configuration", () => {
  it("ships disabled without credentials and keeps real model tests explicit", async () => {
    const root = resolve(process.cwd());
    const example = await readFile(resolve(root, ".env.example"), "utf8");
    const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));

    expect(example).toContain("DINNERSYNC_LOCAL_AI=disabled");
    expect(example).not.toMatch(/api[_-]?key|password|secret|token/i);
    expect(packageJson.scripts["test:codex-real:full"]).toMatch(/RUN_REAL_CODEX=1/);
    expect(packageJson.scripts.verify).not.toContain("test:codex-real");
    expect(packageJson.overrides.next.postcss).toBe("8.5.10");
  });
});
