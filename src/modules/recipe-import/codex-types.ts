export const VERIFIED_CODEX_MODELS = ["gpt-5.6-sol", "gpt-5.6-terra"] as const;

export type VerifiedCodexModel = (typeof VERIFIED_CODEX_MODELS)[number];
export type JsonSchema = Readonly<Record<string, unknown>>;
export type CodexDiagnosticCode =
  | "FORCE_TERMINATION_FAILED"
  | "FORCE_TERMINATION_UNCONFIRMED"
  | "GRACEFUL_TERMINATION_FAILED"
  | "RESULT_HANDLE_CLOSE_FAILED"
  | "TEMP_CLEANUP_FAILED"
  | "TERMINATION_ERROR_IGNORED";
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
  readonly diagnostics: CodexDiagnosticCode[] = [];
  terminationConfirmed?: boolean;

  constructor(code: CodexRunnerErrorCode, message: string, exitCode?: number) {
    super(message);
    this.name = "CodexRunnerError";
    this.code = code;
    this.exitCode = exitCode;
  }

  addDiagnostic(code: CodexDiagnosticCode) {
    if (!this.diagnostics.includes(code)) this.diagnostics.push(code);
    return this;
  }

  markTermination(confirmed: boolean) {
    this.terminationConfirmed = confirmed;
    return this;
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

export type NormalizedCodexRunRequest<T> = CodexRunRequest<T> & {
  timeoutMs: number;
  maxOutputBytes: number;
};
