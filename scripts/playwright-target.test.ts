// @vitest-environment node

import { describe, expect, it } from "vitest";

import { resolvePlaywrightTarget } from "./playwright-target";

describe("resolvePlaywrightTarget", () => {
  it("treats a whitespace-only external URL as unset", () => {
    expect(resolvePlaywrightTarget({ PLAYWRIGHT_BASE_URL: "   " })).toEqual({
      baseURL: "http://127.0.0.1:3200",
      external: false,
      port: 3200,
    });
  });

  it("rejects an external URL that is not absolute HTTP or HTTPS", () => {
    expect(() => resolvePlaywrightTarget({
      PLAYWRIGHT_BASE_URL: "file:///tmp/dinnersync.html",
    })).toThrowError(
      "PLAYWRIGHT_BASE_URL must be an absolute http:// or https:// URL.",
    );
  });
});
