import {
  createRecipeReviewState,
  parseAiRecipeDraft,
  type RecipeReviewState,
} from "@/modules/recipe-import";

const VERIFIED_PROVIDER = "openai-codex-cli" as const;
const VERIFIED_MODEL = "gpt-5.6-terra" as const;
const FAILED_MESSAGE = "The local AI import could not be verified.";
const ABORTED_MESSAGE = "The local AI request was cancelled.";
const DISABLED_MESSAGE = "Local AI is not enabled on this server. Your recipe was not sent. Run npm run dev:local-ai or use Hosted Demo.";

export type LocalAiImportInput = {
  recipes: readonly string[];
  diners: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

export type LocalAiImportMeta = {
  provider: typeof VERIFIED_PROVIDER;
  model: typeof VERIFIED_MODEL;
  schemaValidated: true;
  evidenceValidated: true;
};

export type LocalAiImportResult =
  | {
    ok: true;
    reviewStates: RecipeReviewState[];
    meta: LocalAiImportMeta;
  }
  | {
    ok: false;
    code: "LOCAL_AI_ABORTED" | "LOCAL_AI_DISABLED" | "LOCAL_AI_IMPORT_FAILED";
    message: string;
  };

function failed(): LocalAiImportResult {
  return {
    ok: false,
    code: "LOCAL_AI_IMPORT_FAILED",
    message: FAILED_MESSAGE,
  };
}

function aborted(): LocalAiImportResult {
  return {
    ok: false,
    code: "LOCAL_AI_ABORTED",
    message: ABORTED_MESSAGE,
  };
}

function disabled(): LocalAiImportResult {
  return {
    ok: false,
    code: "LOCAL_AI_DISABLED",
    message: DISABLED_MESSAGE,
  };
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function hasJsonContentType(response: Response) {
  return response.headers.get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase() === "application/json";
}

function verifiedEnvelope(value: unknown, recipeCount: number) {
  if (!exactRecord(value, ["ok", "value"]) || value.ok !== true
    || !exactRecord(value.value, [
      "drafts",
      "provider",
      "model",
      "schemaValidated",
      "evidenceValidated",
    ])) return undefined;
  const payload = value.value;
  if (!Array.isArray(payload.drafts) || payload.drafts.length !== recipeCount
    || payload.provider !== VERIFIED_PROVIDER
    || payload.model !== VERIFIED_MODEL
    || payload.schemaValidated !== true
    || payload.evidenceValidated !== true) return undefined;
  return payload.drafts;
}

function verifiedStatus(value: unknown) {
  if (!exactRecord(value, ["ok", "value"]) || value.ok !== true
    || !exactRecord(value.value, ["installed", "loggedIn", "sandboxAvailable"])) {
    return false;
  }
  return value.value.installed === true
    && value.value.loggedIn === true
    && value.value.sandboxAvailable === true;
}

function disabledStatus(value: unknown) {
  return exactRecord(value, ["ok", "error"])
    && value.ok === false
    && exactRecord(value.error, ["code", "message"])
    && value.error.code === "LOCAL_AI_DISABLED"
    && typeof value.error.message === "string";
}

function isAbort(error: unknown, signal?: AbortSignal) {
  return signal?.aborted === true
    || (typeof error === "object" && error !== null
      && "name" in error && error.name === "AbortError");
}

export async function requestLocalAiImport(
  input: LocalAiImportInput,
): Promise<LocalAiImportResult> {
  if (input.signal?.aborted) return aborted();
  const recipes = [...input.recipes];
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;

  try {
    const statusResponse = await fetchImpl("/api/local-ai/status", {
      method: "POST",
      signal: input.signal,
    });
    if (input.signal?.aborted) return aborted();
    if (!statusResponse.ok) {
      if (!hasJsonContentType(statusResponse)) return failed();
      const statusError: unknown = await statusResponse.json();
      if (input.signal?.aborted) return aborted();
      return statusResponse.status === 404 && disabledStatus(statusError)
        ? disabled()
        : failed();
    }
    if (!hasJsonContentType(statusResponse)) return failed();
    const statusEnvelope: unknown = await statusResponse.json();
    if (input.signal?.aborted) return aborted();
    if (!verifiedStatus(statusEnvelope)) return failed();
    if (input.signal?.aborted) return aborted();

    const response = await fetchImpl("/api/local-ai/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        consent: true,
        model: VERIFIED_MODEL,
        recipes,
      }),
      signal: input.signal,
    });
    if (input.signal?.aborted) return aborted();
    if (!response.ok) return failed();
    if (!hasJsonContentType(response)) return failed();
    const envelope: unknown = await response.json();
    if (input.signal?.aborted) return aborted();
    const drafts = verifiedEnvelope(envelope, recipes.length);
    if (!drafts) return failed();

    const reviewStates: RecipeReviewState[] = [];
    // Same-origin responses remain untrusted even when they claim server-side validation.
    const recipeIds = new Set<string>();
    const stepIds = new Set<string>();
    for (let index = 0; index < recipes.length; index += 1) {
      const parsed = parseAiRecipeDraft(drafts[index], recipes[index]);
      if (!parsed.ok) return failed();
      if (recipeIds.has(parsed.value.id)) return failed();
      for (const step of parsed.value.steps) {
        if (stepIds.has(step.id)) return failed();
        stepIds.add(step.id);
      }
      recipeIds.add(parsed.value.id);
      reviewStates.push(createRecipeReviewState(parsed.value, input.diners));
    }
    if (input.signal?.aborted) return aborted();
    return {
      ok: true,
      reviewStates,
      meta: {
        provider: VERIFIED_PROVIDER,
        model: VERIFIED_MODEL,
        schemaValidated: true,
        evidenceValidated: true,
      },
    };
  } catch (error) {
    return isAbort(error, input.signal) ? aborted() : failed();
  }
}
