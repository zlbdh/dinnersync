export type LocalAiApiErrorCode =
  | "CODEX_ABORTED"
  | "CODEX_NOT_INSTALLED"
  | "CODEX_NOT_LOGGED_IN"
  | "CODEX_QUOTA"
  | "CODEX_TIMEOUT"
  | "CONSENT_REQUIRED"
  | "EVIDENCE_MISMATCH"
  | "INPUT_TOO_LARGE"
  | "INVALID_MODEL_OUTPUT"
  | "INVALID_REQUEST"
  | "LOCAL_AI_BUSY"
  | "LOCAL_AI_DISABLED"
  | "MODEL_UNAVAILABLE"
  | "ORIGIN_FORBIDDEN"
  | "SANDBOX_UNAVAILABLE"
  | "UNEXPECTED_ERROR";

export const MAX_LOCAL_AI_BODY_BYTES = 262_144;

const STATUS: Record<LocalAiApiErrorCode, number> = {
  CODEX_ABORTED: 408,
  CODEX_NOT_INSTALLED: 503,
  CODEX_NOT_LOGGED_IN: 401,
  CODEX_QUOTA: 429,
  CODEX_TIMEOUT: 504,
  CONSENT_REQUIRED: 400,
  EVIDENCE_MISMATCH: 502,
  INPUT_TOO_LARGE: 413,
  INVALID_MODEL_OUTPUT: 502,
  INVALID_REQUEST: 400,
  LOCAL_AI_BUSY: 429,
  LOCAL_AI_DISABLED: 404,
  MODEL_UNAVAILABLE: 400,
  ORIGIN_FORBIDDEN: 403,
  SANDBOX_UNAVAILABLE: 503,
  UNEXPECTED_ERROR: 500,
};

const MESSAGE: Record<LocalAiApiErrorCode, string> = {
  CODEX_ABORTED: "The local AI request was cancelled.",
  CODEX_NOT_INSTALLED: "Codex is not installed or cannot be started.",
  CODEX_NOT_LOGGED_IN: "Codex is not logged in.",
  CODEX_QUOTA: "The Codex quota is unavailable.",
  CODEX_TIMEOUT: "The local AI request timed out.",
  CONSENT_REQUIRED: "Explicit consent is required before local AI runs.",
  EVIDENCE_MISMATCH: "Model evidence did not match the submitted recipe.",
  INPUT_TOO_LARGE: "The submitted recipe batch is too large.",
  INVALID_MODEL_OUTPUT: "Codex returned invalid structured output.",
  INVALID_REQUEST: "The request body is invalid.",
  LOCAL_AI_BUSY: "Another local AI import is already running.",
  LOCAL_AI_DISABLED: "Local AI is not available on this server.",
  MODEL_UNAVAILABLE: "The requested model is not available.",
  ORIGIN_FORBIDDEN: "The request origin is not allowed.",
  SANDBOX_UNAVAILABLE: "The local Codex sandbox could not prove safe isolation.",
  UNEXPECTED_ERROR: "The local AI request failed safely.",
};

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};

export function localAiError(code: LocalAiApiErrorCode) {
  return Response.json(
    { ok: false, error: { code, message: MESSAGE[code] } },
    { status: STATUS[code], headers: NO_STORE_HEADERS },
  );
}

export function localAiSuccess(value: unknown) {
  return Response.json(
    { ok: true, value },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}

export function isLocalAiRuntimeEnabled(request: Request) {
  if (process.env.DINNERSYNC_LOCAL_AI !== "enabled"
    || process.env.NODE_ENV === "production") return false;
  const host = request.headers.get("host");
  if (!host || host !== host.trim() || /[\\/@?#]/.test(host)) return false;
  try {
    const parsed = new URL(`http://${host}`);
    if (parsed.host.toLowerCase() !== host.toLowerCase()) return false;
    const hostname = parsed.hostname.toLowerCase();
    return hostname === "localhost"
      || hostname === "127.0.0.1"
      || hostname === "[::1]";
  } catch {
    return false;
  }
}

export function isExactSameOrigin(request: Request) {
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  if (!host || !origin || host !== host.trim() || origin !== origin.trim()) return false;
  if (/[\\/@?#]/.test(host)) return false;
  try {
    const parsed = new URL(origin);
    const requestUrl = new URL(request.url);
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && parsed.username === ""
      && parsed.password === ""
      && parsed.origin === origin
      && parsed.origin === requestUrl.origin
      && parsed.host === requestUrl.host
      && parsed.host === host.toLowerCase();
  } catch {
    return false;
  }
}

export async function readBoundedJson(request: Request) {
  const contentType = request.headers.get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    return { ok: false as const, code: "INVALID_REQUEST" as const };
  }
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const bytes = Number(declared);
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      return { ok: false as const, code: "INVALID_REQUEST" as const };
    }
    if (bytes > MAX_LOCAL_AI_BODY_BYTES) {
      return { ok: false as const, code: "INPUT_TOO_LARGE" as const };
    }
  }
  if (!request.body) return { ok: false as const, code: "INVALID_REQUEST" as const };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_LOCAL_AI_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false as const, code: "INPUT_TOO_LARGE" as const };
      }
      chunks.push(next.value);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    chunks.forEach((chunk) => {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    });
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    return { ok: true as const, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false as const, code: "INVALID_REQUEST" as const };
  }
}

export function knownApiError(code: unknown): code is LocalAiApiErrorCode {
  return typeof code === "string" && Object.hasOwn(MESSAGE, code);
}
