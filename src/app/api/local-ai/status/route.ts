import {
  isExactSameOrigin,
  isLocalAiRuntimeEnabled,
  knownApiError,
  localAiError,
  localAiSuccess,
} from "../http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isLocalAiRuntimeEnabled(request)) {
    return localAiError("LOCAL_AI_DISABLED");
  }
  if (!isExactSameOrigin(request)) return localAiError("ORIGIN_FORBIDDEN");

  try {
    const { checkCodexAvailability } = await import("@/modules/recipe-import/server");
    const result = await checkCodexAvailability();
    if (result.ok) return localAiSuccess(result.value);
    return knownApiError(result.error.code)
      ? localAiError(result.error.code)
      : localAiError("UNEXPECTED_ERROR");
  } catch {
    return localAiError("UNEXPECTED_ERROR");
  }
}

export const POST = GET;
