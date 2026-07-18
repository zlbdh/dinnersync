import { z } from "zod";

import {
  MAX_RECIPE_CHARS,
  MAX_RECIPE_COUNT,
  MAX_TOTAL_RECIPE_CHARS,
} from "@/modules/recipe-import/codex-prompt";
import { VERIFIED_CODEX_MODELS } from "@/modules/recipe-import/codex-types";

import {
  isExactSameOrigin,
  isLocalAiRuntimeEnabled,
  knownApiError,
  localAiError,
  localAiSuccess,
  readBoundedJson,
} from "../http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const importRequestSchema = z.strictObject({
  consent: z.literal(true),
  model: z.enum(VERIFIED_CODEX_MODELS),
  recipes: z.array(z.string().refine((value) => value.trim().length > 0))
    .min(1)
    .max(MAX_RECIPE_COUNT),
});

let importInProgress = false;

export async function POST(request: Request) {
  if (!isLocalAiRuntimeEnabled(request)) {
    return localAiError("LOCAL_AI_DISABLED");
  }
  if (!isExactSameOrigin(request)) return localAiError("ORIGIN_FORBIDDEN");

  const body = await readBoundedJson(request);
  if (!body.ok) return localAiError(body.code);
  if (!isRecord(body.value) || body.value.consent !== true) {
    return localAiError("CONSENT_REQUIRED");
  }
  if (typeof body.value.model === "string"
    && !VERIFIED_CODEX_MODELS.includes(body.value.model as never)) {
    return localAiError("MODEL_UNAVAILABLE");
  }
  const parsed = importRequestSchema.safeParse(body.value);
  if (!parsed.success) return invalidPayloadCode(body.value);
  if (exceedsRecipeBounds(parsed.data.recipes)) return localAiError("INPUT_TOO_LARGE");
  if (importInProgress) return localAiError("LOCAL_AI_BUSY");

  importInProgress = true;
  try {
    const { runCodexImport } = await import("@/modules/recipe-import/server");
    const result = await runCodexImport({
      recipes: parsed.data.recipes,
      model: parsed.data.model,
      signal: request.signal,
    });
    if (result.ok) return localAiSuccess(result.value);
    return knownApiError(result.error.code)
      ? localAiError(result.error.code)
      : localAiError("UNEXPECTED_ERROR");
  } catch {
    return localAiError("UNEXPECTED_ERROR");
  } finally {
    importInProgress = false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidPayloadCode(value: Record<string, unknown>) {
  if (Array.isArray(value.recipes) && value.recipes.length > MAX_RECIPE_COUNT) {
    return localAiError("INPUT_TOO_LARGE");
  }
  return localAiError("INVALID_REQUEST");
}

function exceedsRecipeBounds(recipes: string[]) {
  let total = 0;
  for (const recipe of recipes) {
    if (recipe.trim().length === 0) return false;
    if (recipe.length > MAX_RECIPE_CHARS) return true;
    total += recipe.length;
  }
  return total > MAX_TOTAL_RECIPE_CHARS;
}
