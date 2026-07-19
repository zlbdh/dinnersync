// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  LOCAL_AI_PERMISSION_PROFILE,
  buildCodexExecArguments,
  buildCodexSandboxArguments,
  featureDisableArguments,
  permissionConfigArguments,
} from "../codex-permissions";

describe("Codex local-AI permission profile", () => {
  it("uses a dedicated deny-by-default read profile without legacy sandbox mode", () => {
    const args = buildCodexExecArguments(
      "gpt-5.6-terra",
      "C:\\isolated-workspace",
      "C:\\isolated-workspace\\schema.json",
      "C:\\isolated-workspace\\result.json",
    );

    expect(args).not.toContain("--sandbox");
    expect(args).not.toContain("sandbox_mode");
    expect(args).toContain("--ignore-user-config");
    expect(args).toContain("--ignore-rules");
    expect(args).toContain("--ephemeral");
    expect(args).toContain("--strict-config");
    expect(args).toEqual(expect.arrayContaining(permissionConfigArguments()));
    expect(args).toEqual(expect.arrayContaining(featureDisableArguments()));
  });

  it("ignores a runtime fifth argument instead of appending override config", () => {
    const invokeWithLegacyOverride = buildCodexExecArguments as unknown as (
      model: string,
      directory: string,
      schemaPath: string,
      resultPath: string,
      additionalConfig: readonly string[],
    ) => string[];
    const args = invokeWithLegacyOverride(
      "gpt-5.6-terra",
      "C:\\isolated-workspace",
      "C:\\isolated-workspace\\schema.json",
      "C:\\isolated-workspace\\result.json",
      ['approval_policy="on-request"'],
    );

    expect(args).not.toContain('approval_policy="on-request"');
  });

  it("denies the root, grants only minimal and current-workspace reads, and disables network", () => {
    expect(LOCAL_AI_PERMISSION_PROFILE).toBe("dinnersync-local-ai");
    expect(permissionConfigArguments()).toEqual([
      "--config", 'default_permissions="dinnersync-local-ai"',
      "--config", 'permissions.dinnersync-local-ai.filesystem={ ":root" = "deny", ":minimal" = "read", ":workspace_roots" = { "." = "read" } }',
      "--config", "permissions.dinnersync-local-ai.network.enabled=false",
      "--config", 'shell_environment_policy.inherit="none"',
      "--config", 'approval_policy="never"',
      "--config", 'windows.sandbox="elevated"',
    ]);
  });

  it("builds a no-model sandbox capability command without unsupported strict config", () => {
    const args = buildCodexSandboxArguments("C:\\gate\\workspace", [
      "node.exe", "probe.js",
    ]);

    expect(args.slice(0, 2)).toEqual(["sandbox", "--cd"]);
    expect(args).toContain("--permission-profile");
    expect(args).not.toContain("--strict-config");
    expect(args).not.toContain('default_permissions="dinnersync-local-ai"');
    expect(args.slice(-2)).toEqual(["node.exe", "probe.js"]);
  });

  it("explicitly disables every local and external tool family used by current Codex", () => {
    const disabled = featureDisableArguments();

    expect(disabled).toEqual(expect.arrayContaining([
      "--disable", "shell_tool",
      "--disable", "unified_exec",
      "--disable", "browser_use",
      "--disable", "computer_use",
      "--disable", "apps",
      "--disable", "plugins",
      "--disable", "shell_snapshot",
      "--disable", "workspace_dependencies",
    ]));
  });
});
