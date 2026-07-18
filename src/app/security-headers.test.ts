// @vitest-environment node

import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

describe("production security headers", () => {
  it("sets browser hardening headers and a hydration-compatible CSP", async () => {
    expect(nextConfig.headers).toBeTypeOf("function");
    const rules = await nextConfig.headers!();
    const headers = Object.fromEntries(rules[0].headers.map((entry) => [entry.key, entry.value]));

    expect(rules[0].source).toBe("/(.*)");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toMatch(/camera=\(\)/);
    expect(headers["Content-Security-Policy"]).toMatch(/default-src 'self'/);
    expect(headers["Content-Security-Policy"]).toMatch(/frame-ancestors 'none'/);
    expect(headers["Content-Security-Policy"]).not.toContain("'unsafe-eval'");
  });

  it("packages the sandbox canary in standalone output tracing", () => {
    expect(nextConfig.output).toBe("standalone");
    expect(nextConfig.outputFileTracingIncludes).toEqual({
      "/*": ["./public/dinnersync-sandbox-canary.txt"],
    });
  });
});
