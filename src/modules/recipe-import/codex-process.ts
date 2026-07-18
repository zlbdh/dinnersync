import { stat as nodeStat } from "node:fs/promises";
import type { Readable, Writable } from "node:stream";

import {
  CodexRunnerError,
  type NormalizedCodexRunRequest,
} from "./codex-types";
import type { ForceKillTree } from "./codex-process-tree";

export { createForceKillTree } from "./codex-process-tree";
export type { ForceKillTree } from "./codex-process-tree";

export type CodexChild = {
  pid?: number;
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  kill: (signal?: NodeJS.Signals | number) => boolean;
  once: (event: string, listener: (...args: never[]) => void) => CodexChild;
  removeListener: (event: string, listener: (...args: never[]) => void) => CodexChild;
  unref?: () => void;
};

export type SpawnCodex = (
  command: string,
  args: string[],
  options: Record<string, unknown>,
) => CodexChild;

export type CodexProcessDependencies = {
  spawn: SpawnCodex;
  platform: NodeJS.Platform;
  forceKillTree: ForceKillTree;
  statResult: (path: string) => Promise<{ size: number }>;
  terminationGraceMs: number;
  forceConfirmationMs: number;
  resultMonitorIntervalMs: number;
};

export async function runCodexProcess<T>(
  executable: string,
  directory: string,
  schemaPath: string,
  resultPath: string,
  request: NormalizedCodexRunRequest<T>,
  dependencies: CodexProcessDependencies,
) {
  if (request.signal?.aborted) throw abortedError();
  const args = buildArguments(request.model, directory, schemaPath, resultPath);
  let child: CodexChild;
  try {
    child = dependencies.spawn(executable, args, {
      cwd: directory,
      detached: dependencies.platform !== "win32",
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    throw spawnError();
  }
  await waitForProcess(child, resultPath, request, dependencies);
}

async function waitForProcess<T>(
  child: CodexChild,
  resultPath: string,
  request: NormalizedCodexRunRequest<T>,
  dependencies: CodexProcessDependencies,
) {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let forceStarted = false;
    let terminationReason: CodexRunnerError | undefined;
    let monitorTimer: ReturnType<typeof setTimeout> | undefined;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    let finalTimer: ReturnType<typeof setTimeout> | undefined;

    const clearTimers = () => {
      for (const timer of [timeoutTimer, monitorTimer, graceTimer, forceTimer, finalTimer]) {
        if (timer) clearTimeout(timer);
      }
    };
    const finish = (error?: CodexRunnerError) => {
      if (settled) return;
      settled = true;
      clearTimers();
      request.signal?.removeEventListener("abort", onAbort);
      child.stdout.removeListener("data", stdoutCounter);
      child.stderr.removeListener("data", stderrCounter);
      child.stdin.removeListener("error", onStdinError);
      child.removeListener("error", onError as never);
      child.removeListener("close", onClose as never);
      if (error) reject(error);
      else resolve();
    };
    const finishUnconfirmed = () => {
      if (!terminationReason || settled) return;
      terminationReason.addDiagnostic("FORCE_TERMINATION_UNCONFIRMED").markTermination(false);
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref?.();
      finish(terminationReason);
    };
    const directForce = () => {
      if (!terminationReason || settled) return;
      try {
        if (!child.kill("SIGKILL")) {
          terminationReason.addDiagnostic("FORCE_TERMINATION_FAILED");
        }
      } catch {
        terminationReason.addDiagnostic("FORCE_TERMINATION_FAILED");
      }
      finalTimer = setTimeout(finishUnconfirmed, dependencies.forceConfirmationMs);
    };
    const forceTree = () => {
      if (!terminationReason || forceStarted || settled) return;
      forceStarted = true;
      if (graceTimer) clearTimeout(graceTimer);
      forceTimer = setTimeout(directForce, dependencies.forceConfirmationMs);
      const pid = child.pid;
      if (!Number.isSafeInteger(pid) || pid! <= 0) {
        terminationReason.addDiagnostic("FORCE_TERMINATION_FAILED");
        return;
      }
      try {
        void dependencies.forceKillTree(pid!).catch(() => {
          if (!settled) terminationReason?.addDiagnostic("FORCE_TERMINATION_FAILED");
        });
      } catch {
        terminationReason.addDiagnostic("FORCE_TERMINATION_FAILED");
      }
    };
    const terminate = (reason: CodexRunnerError) => {
      if (terminationReason || settled) return;
      terminationReason = reason;
      if (monitorTimer) clearTimeout(monitorTimer);
      let accepted = false;
      try {
        accepted = child.kill("SIGTERM");
      } catch {
        accepted = false;
      }
      if (!accepted) {
        reason.addDiagnostic("GRACEFUL_TERMINATION_FAILED");
        forceTree();
      } else if (!settled) {
        graceTimer = setTimeout(forceTree, dependencies.terminationGraceMs);
      }
    };
    const onAbort = () => terminate(abortedError());
    const onError = () => {
      if (terminationReason) {
        terminationReason.addDiagnostic("TERMINATION_ERROR_IGNORED");
      } else finish(spawnError());
    };
    const onClose = (exitCode: number | null) => {
      if (terminationReason) {
        terminationReason.markTermination(true);
        finish(terminationReason);
      } else if (exitCode !== 0) {
        finish(new CodexRunnerError(
          "CODEX_EXIT_FAILED",
          "Codex exited before producing a valid result.",
          exitCode ?? undefined,
        ));
      } else finish();
    };
    const countStream = () => {
      let bytes = 0;
      return (chunk: Buffer | string) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > request.maxOutputBytes) terminate(tooLargeError());
      };
    };
    const pollResultSize = async () => {
      if (settled || terminationReason) return;
      try {
        const result = await dependencies.statResult(resultPath);
        if (!settled && !terminationReason && result.size > request.maxOutputBytes) {
          terminate(tooLargeError());
        }
      } catch {
        // Best effort only; the post-exit reader performs strict validation.
      }
      if (!settled && !terminationReason) {
        monitorTimer = setTimeout(pollResultSize, dependencies.resultMonitorIntervalMs);
      }
    };
    const stdoutCounter = countStream();
    const stderrCounter = countStream();
    const onStdinError = () => undefined;
    const timeoutTimer = setTimeout(() => terminate(timeoutError()), request.timeoutMs);

    child.stdout.on("data", stdoutCounter);
    child.stderr.on("data", stderrCounter);
    child.stdin.once("error", onStdinError);
    child.once("error", onError as never);
    child.once("close", onClose as never);
    request.signal?.addEventListener("abort", onAbort, { once: true });
    monitorTimer = setTimeout(pollResultSize, dependencies.resultMonitorIntervalMs);
    if (request.signal?.aborted) onAbort();
    if (!settled) child.stdin.end(request.prompt, "utf8");
  });
}

function buildArguments(model: string, directory: string, schemaPath: string, resultPath: string) {
  return [
    "exec", "--model", model, "--sandbox", "read-only", "--ephemeral",
    "--ignore-user-config", "--ignore-rules",
    "--config", 'shell_environment_policy.inherit="none"', "--strict-config",
    "--output-schema", schemaPath, "--output-last-message", resultPath,
    "--color", "never", "--skip-git-repo-check", "--cd", directory, "-",
  ];
}

function spawnError() {
  return new CodexRunnerError("CODEX_SPAWN_FAILED", "Codex could not be started.");
}
function abortedError() {
  return new CodexRunnerError("CODEX_ABORTED", "The Codex request was cancelled.");
}
function timeoutError() {
  return new CodexRunnerError("CODEX_TIMEOUT", "The Codex request exceeded its time limit.");
}
function tooLargeError() {
  return new CodexRunnerError("CODEX_OUTPUT_TOO_LARGE", "Codex produced more output than allowed.");
}

export const defaultResultStat = nodeStat;
