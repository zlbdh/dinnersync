import { resolveCodexExecutable } from "./codex-executable";
import {
  checkLocalAiCapability,
  type LocalAiCapabilityResult,
} from "./codex-capability";
import {
  StatusProbeError,
  createStatusCommandRunner,
} from "./codex-status-process";

export type CodexAvailability = {
  installed: true;
  loggedIn: true;
  sandboxAvailable: true;
};

export type CodexStatusFailure = {
  code:
    | "CODEX_NOT_INSTALLED"
    | "CODEX_NOT_LOGGED_IN"
    | "CODEX_TIMEOUT"
    | "SANDBOX_UNAVAILABLE";
  message: string;
};

export type StatusCommand = (
  executable: string,
  args: readonly string[],
) => Promise<{ exitCode: number | null }>;

type StatusDependencies = {
  executable?: string;
  runCommand?: StatusCommand;
  checkCapability?: () => Promise<LocalAiCapabilityResult>;
};

export function createCodexStatusChecker(dependencies: StatusDependencies = {}) {
  return async function checkCodexAvailability() {
    let executable: string;
    try {
      executable = dependencies.executable ?? resolveCodexExecutable();
    } catch {
      return statusFailure("CODEX_NOT_INSTALLED");
    }
    const runCommand = dependencies.runCommand ?? createStatusCommandRunner();
    try {
      const version = await runCommand(executable, ["--version"]);
      if (version.exitCode !== 0) return statusFailure("CODEX_NOT_INSTALLED");
    } catch (error) {
      return error instanceof StatusProbeError && error.code === "TIMEOUT"
        ? statusFailure("CODEX_TIMEOUT")
        : statusFailure("CODEX_NOT_INSTALLED");
    }
    let capability: LocalAiCapabilityResult;
    try {
      capability = await (dependencies.checkCapability ?? checkLocalAiCapability)();
    } catch {
      return statusFailure("SANDBOX_UNAVAILABLE");
    }
    if (!capability.ok) return statusFailure("SANDBOX_UNAVAILABLE");
    try {
      const login = await runCommand(executable, ["login", "status"]);
      if (login.exitCode !== 0) return statusFailure("CODEX_NOT_LOGGED_IN");
    } catch (error) {
      return error instanceof StatusProbeError && error.code === "TIMEOUT"
        ? statusFailure("CODEX_TIMEOUT")
        : statusFailure("CODEX_NOT_LOGGED_IN");
    }
    return {
      ok: true as const,
      value: {
        installed: true as const,
        loggedIn: true as const,
        sandboxAvailable: true as const,
      },
    };
  };
}

export const checkCodexAvailability = createCodexStatusChecker();

function statusFailure(code: CodexStatusFailure["code"]) {
  const messages: Record<CodexStatusFailure["code"], string> = {
    CODEX_NOT_INSTALLED: "Codex is not installed or cannot be started.",
    CODEX_NOT_LOGGED_IN: "Codex is not logged in.",
    CODEX_TIMEOUT: "The Codex status check timed out.",
    SANDBOX_UNAVAILABLE: "The local Codex sandbox could not prove safe isolation.",
  };
  return { ok: false as const, error: { code, message: messages[code] } };
}
