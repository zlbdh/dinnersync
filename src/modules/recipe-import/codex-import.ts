import type { Result } from "@/shared";
import { z } from "zod";

import { createCodexRunner } from "./codex-runner";
import {
  CodexRunnerError,
  VERIFIED_CODEX_MODELS,
  type CodexDiagnosticCode,
  type CodexRunRequest,
  type VerifiedCodexModel,
} from "./codex-types";
import { PromptInputError, buildCodexImportPrompt } from "./codex-prompt";
import { MAX_RECIPE_COUNT, findOutputBoundaryViolation } from "./limits";
import { aiRecipeDraftSchema, parseAiRecipeDraft } from "./schemas";
import type { RecipeDraft, ReviewIssue } from "./types";

export type CodexImportErrorCode =
  | "CODEX_ABORTED"
  | "CODEX_NOT_INSTALLED"
  | "CODEX_NOT_LOGGED_IN"
  | "CODEX_QUOTA"
  | "CODEX_TIMEOUT"
  | "EVIDENCE_MISMATCH"
  | "INPUT_TOO_LARGE"
  | "INVALID_INPUT"
  | "INVALID_MODEL_OUTPUT"
  | "MODEL_UNAVAILABLE"
  | "SANDBOX_UNAVAILABLE"
  | "UNEXPECTED_ERROR";

export type CodexImportFailure = {
  code: CodexImportErrorCode;
  message: string;
  diagnostics: CodexDiagnosticCode[];
};

export type CodexImportRequest = {
  recipes: readonly string[];
  model: string;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type CodexImportRunner = {
  run<T>(request: CodexRunRequest<T>): Promise<T>;
};

export const CODEX_IMPORT_PROVIDER = "openai-codex-cli" as const;

export type CodexImportSuccess = {
  drafts: RecipeDraft[];
  provider: typeof CODEX_IMPORT_PROVIDER;
  model: VerifiedCodexModel;
  schemaValidated: true;
  evidenceValidated: true;
};

type BatchValidation =
  | { valid: true; drafts: RecipeDraft[] }
  | { valid: false; code: "EVIDENCE_MISMATCH" | "INVALID_MODEL_OUTPUT" };

export type CodexImportResult = Result<CodexImportSuccess, CodexImportFailure>;

const aiRecipeDraftBatchSchema = z.strictObject({
  drafts: z.array(aiRecipeDraftSchema).max(MAX_RECIPE_COUNT),
});

const MAX_OUTPUT_BYTES = 2_097_152;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 180_000;

export function createCodexImportService(runner: CodexImportRunner) {
  return async function runCodexImportWithRunner(
    request: CodexImportRequest,
  ): Promise<CodexImportResult> {
    if (!isRequestContainer(request)) return failure("INVALID_INPUT");
    const model = request.model;
    if (!isVerifiedModel(model)) return failure("MODEL_UNAVAILABLE");
    if (!validTimeout(request.timeoutMs)) return failure("INVALID_INPUT");
    let recipes: string[];
    let built;
    try {
      recipes = [...request.recipes];
      built = buildCodexImportPrompt(recipes);
    } catch (error) {
      if (error instanceof PromptInputError) return failure(error.code);
      return failure("INVALID_INPUT");
    }

    try {
      const validation = await runner.run<BatchValidation>({
        model,
        prompt: built.prompt,
        schema: built.schema,
        validate: (value) => validateBatch(value, recipes),
        signal: request.signal,
        timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxOutputBytes: MAX_OUTPUT_BYTES,
      });
      return validation.valid
        ? {
            ok: true,
            value: {
              drafts: validation.drafts,
              provider: CODEX_IMPORT_PROVIDER,
              model,
              schemaValidated: true,
              evidenceValidated: true,
            },
          }
        : failure(validation.code);
    } catch (error) {
      return mapRunnerError(error);
    }
  };
}

export async function runCodexImport(
  request: CodexImportRequest,
): Promise<CodexImportResult> {
  try {
    return await createCodexImportService(createCodexRunner())(request);
  } catch {
    return failure("CODEX_NOT_INSTALLED");
  }
}

function isRequestContainer(value: unknown): value is CodexImportRequest {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && typeof (value as { model?: unknown }).model === "string"
    && Array.isArray((value as { recipes?: unknown }).recipes);
}

function validateBatch(value: unknown, recipes: readonly string[]): BatchValidation {
  if (findOutputBoundaryViolation(value)) {
    return { valid: false, code: "INVALID_MODEL_OUTPUT" };
  }
  const batch = aiRecipeDraftBatchSchema.safeParse(value);
  if (!batch.success || batch.data.drafts.length !== recipes.length) {
    return { valid: false, code: "INVALID_MODEL_OUTPUT" };
  }
  const drafts: RecipeDraft[] = [];
  for (let index = 0; index < recipes.length; index += 1) {
    const parsed = parseAiRecipeDraft(batch.data.drafts[index], recipes[index]);
    if (!parsed.ok) {
      return { valid: false, code: evidenceFailure(parsed.error) };
    }
    drafts.push(parsed.value);
  }
  return { valid: true, drafts };
}

function evidenceFailure(issues: ReviewIssue[]) {
  const mismatch = issues.some((issue) =>
    issue.code === "SOURCE_TEXT_MISMATCH"
    || issue.code === "DRAFT_SOURCE_MISMATCH"
    || issue.code.startsWith("EVIDENCE_"));
  return mismatch ? "EVIDENCE_MISMATCH" as const : "INVALID_MODEL_OUTPUT" as const;
}

function isVerifiedModel(model: string): model is VerifiedCodexModel {
  return VERIFIED_CODEX_MODELS.includes(model as VerifiedCodexModel);
}

function validTimeout(timeoutMs: number | undefined) {
  return timeoutMs === undefined
    || (Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= MAX_TIMEOUT_MS);
}

function mapRunnerError(error: unknown): CodexImportResult {
  if (!(error instanceof CodexRunnerError)) return failure("UNEXPECTED_ERROR");
  const mapping: Partial<Record<typeof error.code, CodexImportErrorCode>> = {
    CODEX_ABORTED: "CODEX_ABORTED",
    CODEX_MODEL_NOT_VERIFIED: "MODEL_UNAVAILABLE",
    CODEX_MODEL_UNAVAILABLE: "MODEL_UNAVAILABLE",
    CODEX_NOT_LOGGED_IN: "CODEX_NOT_LOGGED_IN",
    CODEX_QUOTA_EXCEEDED: "CODEX_QUOTA",
    CODEX_SANDBOX_UNAVAILABLE: "SANDBOX_UNAVAILABLE",
    CODEX_SPAWN_FAILED: "CODEX_NOT_INSTALLED",
    CODEX_TIMEOUT: "CODEX_TIMEOUT",
    CODEX_INVALID_OUTPUT: "INVALID_MODEL_OUTPUT",
    CODEX_NO_OUTPUT: "INVALID_MODEL_OUTPUT",
    CODEX_OUTPUT_TOO_LARGE: "INVALID_MODEL_OUTPUT",
  };
  return failure(mapping[error.code] ?? "UNEXPECTED_ERROR", error.diagnostics);
}

function failure(
  code: CodexImportErrorCode,
  diagnostics: CodexDiagnosticCode[] = [],
): CodexImportResult {
  return {
    ok: false,
    error: { code, message: publicMessage(code), diagnostics: [...diagnostics] },
  };
}

function publicMessage(code: CodexImportErrorCode) {
  const messages: Record<CodexImportErrorCode, string> = {
    CODEX_ABORTED: "The local AI request was cancelled.",
    CODEX_NOT_INSTALLED: "Codex is not installed or cannot be started.",
    CODEX_NOT_LOGGED_IN: "Codex is not logged in.",
    CODEX_QUOTA: "The Codex quota is unavailable.",
    CODEX_TIMEOUT: "The local AI request timed out.",
    EVIDENCE_MISMATCH: "Model evidence did not match the submitted recipe.",
    INPUT_TOO_LARGE: "The submitted recipe batch is too large.",
    INVALID_INPUT: "The local AI request is invalid.",
    INVALID_MODEL_OUTPUT: "Codex returned invalid structured output.",
    MODEL_UNAVAILABLE: "The requested model is not available.",
    SANDBOX_UNAVAILABLE: "The local Codex sandbox could not prove safe isolation.",
    UNEXPECTED_ERROR: "The local AI request failed safely.",
  };
  return messages[code];
}
