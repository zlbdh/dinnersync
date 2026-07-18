// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const scriptPath = fileURLToPath(
  new URL("./check-file-lengths.mjs", import.meta.url),
);
const temporaryDirectories = [];
const supportedExtensions = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".mts", ".cts"];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

async function createWorkspace() {
  const directory = await mkdtemp(join(tmpdir(), "dinnersync-file-gate-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeWorkspaceFile(workspace, relativePath, content) {
  const filePath = join(workspace, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

function runCheck(workspace) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: workspace,
    encoding: "utf8",
  });
}

describe("file length gate", () => {
  it("checks root files for every supported code and config extension", async () => {
    const workspace = await createWorkspace();
    const oversizedSource = Array.from(
      { length: 301 },
      (_, index) => `export const line${index} = true;`,
    ).join("\n");

    await Promise.all(
      supportedExtensions.map((extension) =>
        writeWorkspaceFile(workspace, `config${extension}`, oversizedSource),
      ),
    );

    const result = runCheck(workspace);

    expect(result.status).toBe(1);
    for (const extension of supportedExtensions) {
      expect(result.stderr).toContain(`config${extension}: 301 lines`);
    }
  });

  it("fails closed when generated directories leave no matching files", async () => {
    const workspace = await createWorkspace();
    const generatedDirectories = [
      "node_modules",
      ".next",
      ".git",
      ".worktrees",
      "build",
      "dist",
      "out",
      "coverage",
      "playwright-report",
      "test-results",
      ".turbo",
    ];

    await Promise.all(
      generatedDirectories.map((directory) =>
        writeWorkspaceFile(workspace, `${directory}/generated.ts`, "x\n".repeat(301)),
      ),
    );

    const result = runCheck(workspace);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("No code or configuration files matched");
    expect(result.stderr).not.toContain("generated.ts");
  });
});
