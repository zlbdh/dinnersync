import { spawn as nodeSpawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCodexExecutable } from "./codex-executable";
import {
  readCodexResult,
  type ResultReaderDependencies,
} from "./codex-output";
import {
  createForceKillTree,
  defaultResultStat,
  runCodexProcess,
  type ForceKillTree,
  type SpawnCodex,
} from "./codex-process";
import {
  CodexRunnerError,
  VERIFIED_CODEX_MODELS,
  type CodexRunRequest,
  type NormalizedCodexRunRequest,
  type VerifiedCodexModel,
} from "./codex-types";

type RemoveDirectory = (
  path: string,
  options: { recursive: boolean; force: boolean },
) => Promise<void>;
type RunnerDependencies = {
  spawn?: SpawnCodex;
  executable?: string;
  platform?: NodeJS.Platform;
  forceKillTree?: ForceKillTree;
  statResult?: (path: string) => Promise<{ size: number }>;
  openFile?: ResultReaderDependencies["openFile"];
  removeDirectory?: RemoveDirectory;
  forceConfirmationMs?: number;
  resultMonitorIntervalMs?: number;
};

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;
const MAX_OUTPUT_BYTES = 4_194_304;

export function createCodexRunner(dependencies: RunnerDependencies = {}) {
  const platform = dependencies.platform ?? process.platform;
  const spawn = dependencies.spawn ?? (nodeSpawn as unknown as SpawnCodex);
  const executable = dependencies.executable ?? resolveCodexExecutable();
  const removeDirectory = dependencies.removeDirectory ?? rm;
  const processDependencies = {
    spawn,
    platform,
    forceKillTree: dependencies.forceKillTree ?? createForceKillTree({ platform }),
    statResult: dependencies.statResult ?? defaultResultStat,
    forceConfirmationMs: dependencies.forceConfirmationMs ?? 2_500,
    resultMonitorIntervalMs: dependencies.resultMonitorIntervalMs ?? 100,
  };

  return {
    async run<T>(request: CodexRunRequest<T>): Promise<T> {
      const normalized = normalizeRequest(request);
      let directory: string;
      try {
        directory = await mkdtemp(join(tmpdir(), "dinnersync-codex-"));
      } catch {
        throw workspaceError();
      }
      const schemaPath = join(directory, "output-schema.json");
      const resultPath = join(directory, "last-message.json");
      let primaryError: CodexRunnerError | undefined;
      let result: T | undefined;

      try {
        await writeFile(schemaPath, JSON.stringify(normalized.schema), "utf8");
        await runCodexProcess(
          executable,
          directory,
          schemaPath,
          resultPath,
          normalized,
          processDependencies,
        );
        const text = await readCodexResult(resultPath, normalized.maxOutputBytes, {
          openFile: dependencies.openFile,
        });
        result = parseAndValidate(text, normalized.validate);
      } catch (error) {
        primaryError = safeWorkflowError(error);
      }

      try {
        await removeDirectory(directory, { recursive: true, force: true });
      } catch {
        if (primaryError) primaryError.addDiagnostic("TEMP_CLEANUP_FAILED");
        else {
          primaryError = new CodexRunnerError(
            "CODEX_CLEANUP_FAILED",
            "The isolated Codex workspace could not be removed.",
          );
        }
      }
      if (primaryError) throw primaryError;
      return result as T;
    },
  };
}

function normalizeRequest<T>(request: CodexRunRequest<T>): NormalizedCodexRunRequest<T> {
  if (!VERIFIED_CODEX_MODELS.includes(request.model as VerifiedCodexModel)) {
    throw new CodexRunnerError(
      "CODEX_MODEL_NOT_VERIFIED",
      "The requested Codex model has not passed this project's capability gate.",
    );
  }
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = request.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("timeoutMs must be a positive integer.");
  }
  if (
    !Number.isInteger(maxOutputBytes)
    || maxOutputBytes <= 0
    || maxOutputBytes > MAX_OUTPUT_BYTES
  ) {
    throw new TypeError(`maxOutputBytes must be between 1 and ${MAX_OUTPUT_BYTES}.`);
  }
  if (request.signal?.aborted) {
    throw new CodexRunnerError("CODEX_ABORTED", "The Codex request was cancelled.");
  }
  return { ...request, timeoutMs, maxOutputBytes };
}

function parseAndValidate<T>(text: string, validate: (value: unknown) => T) {
  try {
    return validate(JSON.parse(text));
  } catch {
    throw new CodexRunnerError(
      "CODEX_INVALID_OUTPUT",
      "Codex returned output that failed structured validation.",
    );
  }
}

function safeWorkflowError(error: unknown) {
  return error instanceof CodexRunnerError ? error : workspaceError();
}

function workspaceError() {
  return new CodexRunnerError(
    "CODEX_SPAWN_FAILED",
    "The isolated Codex workspace could not be prepared.",
  );
}

export { resolveCodexExecutable } from "./codex-executable";
export { CodexRunnerError, VERIFIED_CODEX_MODELS } from "./codex-types";
export type {
  CodexDiagnosticCode,
  CodexRunRequest,
  CodexRunnerErrorCode,
  JsonSchema,
  VerifiedCodexModel,
} from "./codex-types";
