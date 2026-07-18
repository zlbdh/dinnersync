import { spawn as nodeSpawn } from "node:child_process";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { Readable, Writable } from "node:stream";
export const VERIFIED_CODEX_MODELS = ["gpt-5.6-sol", "gpt-5.6-terra"] as const;
export type VerifiedCodexModel = (typeof VERIFIED_CODEX_MODELS)[number];
export type JsonSchema = Readonly<Record<string, unknown>>;
export type CodexRunnerErrorCode =
  | "CODEX_ABORTED"
  | "CODEX_CLEANUP_FAILED"
  | "CODEX_EXIT_FAILED"
  | "CODEX_INVALID_OUTPUT"
  | "CODEX_MODEL_NOT_VERIFIED"
  | "CODEX_NO_OUTPUT"
  | "CODEX_OUTPUT_TOO_LARGE"
  | "CODEX_SPAWN_FAILED"
  | "CODEX_TIMEOUT";
export class CodexRunnerError extends Error {
  readonly code: CodexRunnerErrorCode;
  readonly exitCode?: number;
  constructor(code: CodexRunnerErrorCode, message: string, exitCode?: number) {
    super(message);
    this.name = "CodexRunnerError";
    this.code = code;
    this.exitCode = exitCode;
  }
}
export type CodexRunRequest<T> = {
  prompt: string;
  model: string;
  schema: JsonSchema;
  validate: (value: unknown) => T;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputBytes?: number;
};
type ChildLike = {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  kill: (signal?: NodeJS.Signals | number) => boolean;
  once: (event: string, listener: (...args: never[]) => void) => ChildLike;
  removeListener: (event: string, listener: (...args: never[]) => void) => ChildLike;
};
type SpawnLike = (
  command: string,
  args: string[],
  options: Record<string, unknown>,
) => ChildLike;
type RunnerDependencies = {
  spawn?: SpawnLike;
  executable?: string;
};
type ExecutableContext = {
  platform?: NodeJS.Platform;
  arch?: string;
  env?: Record<string, string | undefined>;
};
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;
const MAX_OUTPUT_BYTES = 4_194_304;
const TERMINATION_GRACE_MS = 1_000;

export function resolveCodexExecutable(context: ExecutableContext = {}) {
  const platform = context.platform ?? process.platform;
  const arch = context.arch ?? process.arch;
  const env = context.env ?? process.env;
  const override = env.DINNERSYNC_CODEX_EXECUTABLE;

  if (override) {
    if (platform === "win32" && (!isAbsolute(override) || !override.endsWith(".exe"))) {
      throw new CodexRunnerError(
        "CODEX_SPAWN_FAILED",
        "The Windows Codex executable override must be an absolute .exe path.",
      );
    }
    return override;
  }
  if (platform !== "win32") return "codex";

  const target = arch === "arm64"
    ? ["codex-win32-arm64", "aarch64-pc-windows-msvc"]
    : ["codex-win32-x64", "x86_64-pc-windows-msvc"];
  const npmRoot = join(env.APPDATA ?? "", "npm", "node_modules");
  return join(npmRoot, "@openai", "codex", "node_modules", "@openai", target[0],
    "vendor", target[1], "bin", "codex.exe");
}

export function createCodexRunner(dependencies: RunnerDependencies = {}) {
  const spawn = dependencies.spawn ?? (nodeSpawn as unknown as SpawnLike);
  const executable = dependencies.executable ?? resolveCodexExecutable();
  return {
    async run<T>(request: CodexRunRequest<T>): Promise<T> {
      assertRequest(request);
      const directory = await mkdtemp(join(tmpdir(), "dinnersync-codex-"));
      const schemaPath = join(directory, "output-schema.json");
      const resultPath = join(directory, "last-message.json");
      try {
        await writeFile(schemaPath, JSON.stringify(request.schema), "utf8");
        await runProcess(spawn, executable, directory, schemaPath, resultPath, request);
        const text = await readLimitedResult(resultPath, request.maxOutputBytes!);
        let value: unknown;
        try {
          value = JSON.parse(text);
          return request.validate(value);
        } catch {
          throw new CodexRunnerError(
            "CODEX_INVALID_OUTPUT",
            "Codex returned output that failed structured validation.",
          );
        }
      } finally {
        try {
          await rm(directory, { recursive: true, force: true });
        } catch {
          throw new CodexRunnerError(
            "CODEX_CLEANUP_FAILED",
            "The isolated Codex workspace could not be removed.",
          );
        }
      }
    },
  };
}

function assertRequest<T>(request: CodexRunRequest<T>): asserts request is CodexRunRequest<T> & {
  timeoutMs: number;
  maxOutputBytes: number;
} {
  if (!VERIFIED_CODEX_MODELS.includes(request.model as VerifiedCodexModel)) {
    throw new CodexRunnerError(
      "CODEX_MODEL_NOT_VERIFIED",
      "The requested Codex model has not passed this project's capability gate.",
    );
  }
  request.timeoutMs ??= DEFAULT_TIMEOUT_MS;
  request.maxOutputBytes ??= DEFAULT_MAX_OUTPUT_BYTES;
  if (!Number.isInteger(request.timeoutMs) || request.timeoutMs <= 0) {
    throw new TypeError("timeoutMs must be a positive integer.");
  }
  if (
    !Number.isInteger(request.maxOutputBytes)
    || request.maxOutputBytes <= 0
    || request.maxOutputBytes > MAX_OUTPUT_BYTES
  ) {
    throw new TypeError(`maxOutputBytes must be between 1 and ${MAX_OUTPUT_BYTES}.`);
  }
  if (request.signal?.aborted) {
    throw new CodexRunnerError("CODEX_ABORTED", "The Codex request was cancelled.");
  }
}

async function runProcess<T>(
  spawn: SpawnLike,
  executable: string,
  directory: string,
  schemaPath: string,
  resultPath: string,
  request: CodexRunRequest<T> & { timeoutMs: number; maxOutputBytes: number },
) {
  if (request.signal?.aborted) {
    throw new CodexRunnerError("CODEX_ABORTED", "The Codex request was cancelled.");
  }
  const args = buildArguments(request.model, directory, schemaPath, resultPath);
  let child: ChildLike;
  try {
    child = spawn(executable, args, {
      cwd: directory,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    throw new CodexRunnerError("CODEX_SPAWN_FAILED", "Codex could not be started.");
  }
  await new Promise<void>((resolve, reject) => {
    let pendingError: CodexRunnerError | undefined;
    let settled = false;
    let terminationTimer: ReturnType<typeof setTimeout> | undefined;
    const timeout = setTimeout(() => terminate(new CodexRunnerError(
      "CODEX_TIMEOUT",
      "The Codex request exceeded its time limit.",
    )), request.timeoutMs);
    const finish = (error?: CodexRunnerError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (terminationTimer) clearTimeout(terminationTimer);
      request.signal?.removeEventListener("abort", onAbort);
      child.stdout.removeListener("data", stdoutCounter);
      child.stderr.removeListener("data", stderrCounter);
      child.stdin.removeListener("error", onStdinError);
      child.removeListener("error", onError as never);
      child.removeListener("close", onClose as never);
      if (error) reject(error);
      else resolve();
    };
    const terminate = (error: CodexRunnerError) => {
      if (pendingError || settled) return;
      pendingError = error;
      try {
        child.kill("SIGTERM");
      } catch {
        finish(error);
        return;
      }
      terminationTimer = setTimeout(() => finish(error), TERMINATION_GRACE_MS);
    };
    const onAbort = () => terminate(new CodexRunnerError(
      "CODEX_ABORTED",
      "The Codex request was cancelled.",
    ));
    const onError = () => finish(new CodexRunnerError(
      "CODEX_SPAWN_FAILED",
      "Codex could not be started.",
    ));
    const onClose = (exitCode: number | null) => {
      if (pendingError) return finish(pendingError);
      if (exitCode !== 0) {
        return finish(new CodexRunnerError(
          "CODEX_EXIT_FAILED",
          "Codex exited before producing a valid result.",
          exitCode ?? undefined,
        ));
      }
      finish();
    };
    const countStream = () => {
      let bytes = 0;
      return (chunk: Buffer | string) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > request.maxOutputBytes) {
          terminate(new CodexRunnerError(
            "CODEX_OUTPUT_TOO_LARGE",
            "Codex produced more output than allowed.",
          ));
        }
      };
    };
    const stdoutCounter = countStream();
    const stderrCounter = countStream();
    const onStdinError = () => undefined;
    child.stdout.on("data", stdoutCounter);
    child.stderr.on("data", stderrCounter);
    child.stdin.once("error", onStdinError);
    child.once("error", onError as never);
    child.once("close", onClose as never);
    request.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdin.end(request.prompt, "utf8");
  });
}

function buildArguments(
  model: string,
  directory: string,
  schemaPath: string,
  resultPath: string,
) {
  return [
    "exec", "--model", model,
    "--sandbox", "read-only",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--config", 'shell_environment_policy.inherit="none"',
    "--strict-config",
    "--output-schema", schemaPath,
    "--output-last-message", resultPath,
    "--color", "never",
    "--skip-git-repo-check",
    "--cd", directory,
    "-",
  ];
}

async function readLimitedResult(path: string, maxBytes: number) {
  let handle;
  try {
    handle = await open(path, "r");
  } catch {
    throw new CodexRunnerError("CODEX_NO_OUTPUT", "Codex produced no result.");
  }
  try {
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes) {
      throw new CodexRunnerError(
        "CODEX_OUTPUT_TOO_LARGE",
        "Codex produced more output than allowed.",
      );
    }
    const text = buffer.subarray(0, bytesRead).toString("utf8").trim();
    if (!text) throw new CodexRunnerError("CODEX_NO_OUTPUT", "Codex produced no result.");
    return text;
  } finally {
    await handle.close();
  }
}
