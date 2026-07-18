import { CodexRunnerError } from "./codex-types";

const MAX_DIAGNOSTIC_BYTES = 32_768;

export function createCodexExitClassifier() {
  const chunks: Buffer[] = [];
  let bytes = 0;

  return {
    add(chunk: Buffer | string) {
      if (bytes >= MAX_DIAGNOSTIC_BYTES) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = MAX_DIAGNOSTIC_BYTES - bytes;
      const accepted = buffer.subarray(0, remaining);
      chunks.push(accepted);
      bytes += accepted.length;
    },
    error(exitCode: number | null) {
      return classifyCodexExit(Buffer.concat(chunks, bytes).toString("utf8"), exitCode);
    },
  };
}

function classifyCodexExit(stderr: string, exitCode: number | null) {
  const normalized = stderr.toLowerCase();
  if (
    /not logged in|authentication required|please (?:run )?codex login|401 unauthorized/
      .test(normalized)
  ) {
    return safeError("CODEX_NOT_LOGGED_IN", "Codex is not logged in.", exitCode);
  }
  if (
    /usage limit|rate limit|quota|insufficient credits|credit balance/
      .test(normalized)
  ) {
    return safeError("CODEX_QUOTA_EXCEEDED", "Codex usage is unavailable.", exitCode);
  }
  if (
    /model.{0,80}(?:not supported|not available|unavailable|unknown)|(?:not supported|not available).{0,80}model/
      .test(normalized)
  ) {
    return safeError("CODEX_MODEL_UNAVAILABLE", "The Codex model is unavailable.", exitCode);
  }
  return safeError(
    "CODEX_EXIT_FAILED",
    "Codex exited before producing a valid result.",
    exitCode,
  );
}

function safeError(
  code: ConstructorParameters<typeof CodexRunnerError>[0],
  message: string,
  exitCode: number | null,
) {
  return new CodexRunnerError(code, message, exitCode ?? undefined);
}
