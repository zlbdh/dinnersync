import { spawn as nodeSpawn } from "node:child_process";
import { tmpdir } from "node:os";
import type { Readable } from "node:stream";

import { createForceKillTree, type ForceKillTree } from "./codex-process-tree";

export type StatusProbeDiagnostic =
  | "FORCE_TERMINATION_FAILED"
  | "FORCE_TERMINATION_UNCONFIRMED"
  | "GRACEFUL_TERMINATION_FAILED";

export class StatusProbeError extends Error {
  readonly diagnostics: StatusProbeDiagnostic[] = [];
  terminationConfirmed?: boolean;

  constructor(readonly code: "SPAWN" | "TIMEOUT" | "OUTPUT_LIMIT") {
    super("Codex status probe failed safely.");
    this.name = "StatusProbeError";
  }

  addDiagnostic(code: StatusProbeDiagnostic) {
    if (!this.diagnostics.includes(code)) this.diagnostics.push(code);
    return this;
  }

  markTermination(confirmed: boolean) {
    this.terminationConfirmed = confirmed;
    return this;
  }
}

type StatusChild = {
  pid?: number;
  stdout: Readable | null;
  stderr: Readable | null;
  kill: (signal?: NodeJS.Signals | number) => boolean;
  once: (event: string, listener: (...args: never[]) => void) => StatusChild;
  removeListener: (event: string, listener: (...args: never[]) => void) => StatusChild;
  unref?: () => void;
};

type SpawnStatus = (
  command: string,
  args: string[],
  options: Record<string, unknown>,
) => StatusChild;

export type StatusProcessDependencies = {
  spawn: SpawnStatus;
  platform: NodeJS.Platform;
  forceKillTree: ForceKillTree;
  timeoutMs: number;
  outputLimitBytes: number;
  forceConfirmationMs: number;
  environment?: NodeJS.ProcessEnv;
};

export function createStatusCommandRunner(
  overrides: Partial<StatusProcessDependencies> = {},
) {
  const dependencies: StatusProcessDependencies = {
    spawn: nodeSpawn as unknown as SpawnStatus,
    platform: process.platform,
    forceKillTree: createForceKillTree(),
    timeoutMs: 3_000,
    outputLimitBytes: 16_384,
    forceConfirmationMs: 250,
    ...overrides,
  };
  return (executable: string, args: readonly string[]) =>
    runStatusCommand(executable, args, dependencies);
}

function runStatusCommand(
  executable: string,
  args: readonly string[],
  dependencies: StatusProcessDependencies,
) {
  return new Promise<{ exitCode: number | null }>((resolve, reject) => {
    let child: StatusChild;
    try {
      child = dependencies.spawn(executable, [...args], {
        cwd: tmpdir(),
        detached: dependencies.platform !== "win32",
        shell: false,
        windowsHide: true,
        env: dependencies.environment,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      reject(new StatusProbeError("SPAWN"));
      return;
    }
    let settled = false;
    let childClosed = false;
    let outputBytes = 0;
    let reason: StatusProbeError | undefined;
    let treeState: "idle" | "pending" | "succeeded" | "failed" = "idle";
    let directTimer: ReturnType<typeof setTimeout> | undefined;
    let finalTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      clearTimeout(timeoutTimer);
      if (directTimer) clearTimeout(directTimer);
      if (finalTimer) clearTimeout(finalTimer);
      child.stdout?.removeListener("data", countOutput);
      child.stderr?.removeListener("data", countOutput);
      child.removeListener("error", onError as never);
      child.removeListener("close", onClose as never);
    };
    const finish = (value: { exitCode: number | null } | StatusProbeError) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (value instanceof StatusProbeError) reject(value);
      else resolve(value);
    };
    const finishUnconfirmed = () => {
      if (!reason || settled) return;
      if (treeState !== "succeeded") reason.addDiagnostic("FORCE_TERMINATION_FAILED");
      reason.addDiagnostic("FORCE_TERMINATION_UNCONFIRMED").markTermination(false);
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref?.();
      finish(reason);
    };
    const maybeFinishTermination = () => {
      if (!reason || !childClosed || treeState === "idle" || treeState === "pending") return;
      if (treeState === "failed") {
        reason.addDiagnostic("FORCE_TERMINATION_UNCONFIRMED").markTermination(false);
      } else reason.markTermination(true);
      finish(reason);
    };
    const forceDirectChild = () => {
      if (!reason || settled) return;
      try {
        if (!child.kill("SIGKILL")) reason.addDiagnostic("FORCE_TERMINATION_FAILED");
      } catch {
        reason.addDiagnostic("FORCE_TERMINATION_FAILED");
      }
      finalTimer = setTimeout(finishUnconfirmed, dependencies.forceConfirmationMs);
    };
    const scheduleCloseConfirmation = () => {
      if (!settled && !finalTimer) {
        finalTimer = setTimeout(finishUnconfirmed, dependencies.forceConfirmationMs);
      }
    };
    const failTreeTermination = () => {
      if (settled || treeState !== "pending") return;
      treeState = "failed";
      reason?.addDiagnostic("FORCE_TERMINATION_FAILED");
      if (dependencies.platform === "win32" && !childClosed) forceDirectChild();
      else maybeFinishTermination();
    };
    const succeedTreeTermination = () => {
      if (settled || treeState !== "pending") return;
      treeState = "succeeded";
      maybeFinishTermination();
      if (dependencies.platform === "win32" && !childClosed) scheduleCloseConfirmation();
    };
    const terminate = (failure: StatusProbeError) => {
      if (reason || settled) return;
      reason = failure;
      treeState = "pending";
      const pid = child.pid;
      const treeAction = Number.isSafeInteger(pid) && pid! > 0
        ? safelyKillTree(dependencies.forceKillTree, pid!)
        : Promise.resolve(false);
      void treeAction.then((succeeded) => {
        if (succeeded) succeedTreeTermination();
        else failTreeTermination();
      });
      if (dependencies.platform === "win32") {
        return;
      }
      try {
        if (!child.kill("SIGTERM")) failure.addDiagnostic("GRACEFUL_TERMINATION_FAILED");
      } catch {
        failure.addDiagnostic("GRACEFUL_TERMINATION_FAILED");
      }
      directTimer = setTimeout(forceDirectChild, dependencies.forceConfirmationMs);
    };
    const countOutput = (chunk: Buffer | string) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > dependencies.outputLimitBytes) {
        terminate(new StatusProbeError("OUTPUT_LIMIT"));
      }
    };
    const onError = () => {
      if (!reason) finish(new StatusProbeError("SPAWN"));
    };
    const onClose = (exitCode: number | null) => {
      if (!reason) finish({ exitCode });
      else {
        childClosed = true;
        maybeFinishTermination();
      }
    };
    const timeoutTimer = setTimeout(
      () => terminate(new StatusProbeError("TIMEOUT")),
      dependencies.timeoutMs,
    );
    child.stdout?.on("data", countOutput);
    child.stderr?.on("data", countOutput);
    child.once("error", onError as never);
    child.once("close", onClose as never);
  });
}

async function safelyKillTree(forceKillTree: ForceKillTree, pid: number) {
  try {
    await forceKillTree(pid);
    return true;
  } catch {
    return false;
  }
}
