import { isAbsolute, join } from "node:path";

import { CodexRunnerError } from "./codex-types";

export type ExecutableContext = {
  platform?: NodeJS.Platform;
  arch?: string;
  env?: Record<string, string | undefined>;
};

export function resolveCodexExecutable(context: ExecutableContext = {}) {
  const platform = context.platform ?? process.platform;
  const arch = context.arch ?? process.arch;
  const env = context.env ?? process.env;
  const override = env.DINNERSYNC_CODEX_EXECUTABLE;

  if (override) {
    if (
      platform === "win32"
      && (!isAbsolute(override) || !override.toLowerCase().endsWith(".exe"))
    ) {
      throw discoveryError("The Windows Codex executable override must be an absolute .exe path.");
    }
    return override;
  }
  if (platform !== "win32") return "codex";
  if (arch !== "x64" && arch !== "arm64") {
    throw discoveryError("This Windows architecture is not supported by the Codex runner.");
  }
  if (!env.APPDATA) {
    throw discoveryError("APPDATA is required to locate the native Codex executable on Windows.");
  }

  const target = arch === "arm64"
    ? ["codex-win32-arm64", "aarch64-pc-windows-msvc"]
    : ["codex-win32-x64", "x86_64-pc-windows-msvc"];
  return join(env.APPDATA, "npm", "node_modules", "@openai", "codex", "node_modules",
    "@openai", target[0], "vendor", target[1], "bin", "codex.exe");
}

function discoveryError(message: string) {
  return new CodexRunnerError("CODEX_SPAWN_FAILED", message);
}
