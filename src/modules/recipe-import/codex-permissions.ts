export const LOCAL_AI_PERMISSION_PROFILE = "dinnersync-local-ai";

const PROFILE_CONFIG = [
  `permissions.${LOCAL_AI_PERMISSION_PROFILE}.filesystem={ ":root" = "deny", ":minimal" = "read", ":workspace_roots" = { "." = "read" } }`,
  `permissions.${LOCAL_AI_PERMISSION_PROFILE}.network.enabled=false`,
] as const;

const EXEC_CONFIG = [
  `default_permissions="${LOCAL_AI_PERMISSION_PROFILE}"`,
  ...PROFILE_CONFIG,
  'shell_environment_policy.inherit="none"',
  'approval_policy="never"',
  'windows.sandbox="elevated"',
] as const;

const DISABLED_TOOL_FEATURES = [
  "apps",
  "artifact",
  "auth_elicitation",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "chronicle",
  "code_mode",
  "code_mode_host",
  "code_mode_only",
  "computer_use",
  "current_time_reminder",
  "default_mode_request_user_input",
  "deferred_executor",
  "enable_fanout",
  "enable_mcp_apps",
  "goals",
  "hooks",
  "image_generation",
  "in_app_browser",
  "memories",
  "multi_agent",
  "multi_agent_v2",
  "network_proxy",
  "plugin_sharing",
  "plugins",
  "remote_plugin",
  "request_permissions_tool",
  "shell_snapshot",
  "shell_tool",
  "skill_mcp_dependency_install",
  "standalone_web_search",
  "tool_call_mcp_elicitation",
  "tool_suggest",
  "unified_exec",
  "unified_exec_zsh_fork",
  "workspace_dependencies",
] as const;

export function permissionConfigArguments() {
  return EXEC_CONFIG.flatMap((config) => ["--config", config]);
}

export function featureDisableArguments() {
  return DISABLED_TOOL_FEATURES.flatMap((feature) => ["--disable", feature]);
}

export function buildCodexExecArguments(
  model: string,
  directory: string,
  schemaPath: string,
  resultPath: string,
) {
  return [
    "exec", "--model", model, "--ephemeral",
    "--ignore-user-config", "--ignore-rules",
    ...permissionConfigArguments(),
    ...featureDisableArguments(),
    "--strict-config",
    "--output-schema", schemaPath, "--output-last-message", resultPath,
    "--color", "never", "--skip-git-repo-check", "--cd", directory, "-",
  ];
}

export function buildCodexSandboxArguments(
  directory: string,
  command: readonly string[],
) {
  return [
    "sandbox",
    "--cd", directory,
    "--permission-profile", LOCAL_AI_PERMISSION_PROFILE,
    ...PROFILE_CONFIG.flatMap((config) => ["--config", config]),
    "--config", 'windows.sandbox="elevated"',
    ...command,
  ];
}
