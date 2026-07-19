type PlaywrightEnvironment = Readonly<Record<string, string | undefined>>;

export type PlaywrightTarget = {
  baseURL: string;
  external: boolean;
  port: number;
};

function validExternalBaseURL(value: string) {
  try {
    const parsed = new URL(value);
    if ((parsed.protocol === "http:" || parsed.protocol === "https:")
      && parsed.hostname.length > 0) {
      return value;
    }
  } catch {
    // Use the same bounded configuration error for malformed and unsupported URLs.
  }
  throw new Error(
    "PLAYWRIGHT_BASE_URL must be an absolute http:// or https:// URL.",
  );
}

export function resolvePlaywrightTarget(
  environment: PlaywrightEnvironment = process.env,
): PlaywrightTarget {
  const port = Number(environment.PLAYWRIGHT_PORT ?? 3_200);
  // 2026-07-19 by Codex — CI may define an empty value; only real input disables the owned server.
  const externalInput = environment.PLAYWRIGHT_BASE_URL?.trim() || undefined;
  const externalBaseURL = externalInput
    ? validExternalBaseURL(externalInput)
    : undefined;

  return {
    baseURL: externalBaseURL ?? `http://127.0.0.1:${port}`,
    external: externalBaseURL !== undefined,
    port,
  };
}
