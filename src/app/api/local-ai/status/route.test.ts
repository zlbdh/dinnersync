// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const serverMocks = vi.hoisted(() => ({
  checkCodexAvailability: vi.fn(),
}));

vi.mock("@/modules/recipe-import/server", () => serverMocks);

import { GET, POST } from "./route";

function request(origin = "http://localhost:3000", host = "localhost:3000") {
  return new Request("http://localhost:3000/api/local-ai/status", {
    headers: { host, origin },
  });
}

describe.sequential("GET /api/local-ai/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DINNERSYNC_LOCAL_AI = "disabled";
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.DINNERSYNC_LOCAL_AI;
  });

  it("returns a no-store 404 before loading the server checker when disabled", async () => {
    const response = await GET(request());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "LOCAL_AI_DISABLED" },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(serverMocks.checkCodexAvailability).not.toHaveBeenCalled();
  });

  it("rejects an Origin that does not exactly match Host", async () => {
    process.env.DINNERSYNC_LOCAL_AI = "enabled";

    const response = await GET(request("http://localhost:3001"));

    expect(response.status).toBe(403);
    expect(serverMocks.checkCodexAvailability).not.toHaveBeenCalled();
  });

  it("rejects an Origin whose protocol differs from the request URL", async () => {
    process.env.DINNERSYNC_LOCAL_AI = "enabled";

    const response = await GET(request("https://localhost:3000"));

    expect(response.status).toBe(403);
    expect(serverMocks.checkCodexAvailability).not.toHaveBeenCalled();
  });

  it("stays unavailable in production or on a non-loopback host", async () => {
    process.env.DINNERSYNC_LOCAL_AI = "enabled";
    vi.stubEnv("NODE_ENV", "production");
    const production = await GET(request());
    vi.stubEnv("NODE_ENV", "test");
    const remote = await GET(request("https://ds.example", "ds.example"));

    expect(production.status).toBe(404);
    expect(remote.status).toBe(404);
    expect(serverMocks.checkCodexAvailability).not.toHaveBeenCalled();
  });

  it("checks local installation and login without caching", async () => {
    process.env.DINNERSYNC_LOCAL_AI = "enabled";
    serverMocks.checkCodexAvailability.mockResolvedValue({
      ok: true,
      value: { installed: true, loggedIn: true, sandboxAvailable: true },
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      value: { installed: true, loggedIn: true, sandboxAvailable: true },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(serverMocks.checkCodexAvailability).toHaveBeenCalledOnce();
  });

  it("supports same-origin POST for browser status checks that send Origin", async () => {
    process.env.DINNERSYNC_LOCAL_AI = "enabled";
    serverMocks.checkCodexAvailability.mockResolvedValue({
      ok: true,
      value: { installed: true, loggedIn: true, sandboxAvailable: true },
    });

    await expect(POST(request())).resolves.toMatchObject({ status: 200 });
  });

  it("sanitizes unavailable status details", async () => {
    process.env.DINNERSYNC_LOCAL_AI = "enabled";
    serverMocks.checkCodexAvailability.mockResolvedValue({
      ok: false,
      error: { code: "CODEX_NOT_LOGGED_IN", message: "C:\\private\\stderr" },
    });

    const response = await GET(request());
    const text = await response.text();

    expect(response.status).toBe(401);
    expect(text).toContain("CODEX_NOT_LOGGED_IN");
    expect(text).not.toContain("private");
  });

  it("exposes a stable sandbox-unavailable status without private diagnostics", async () => {
    process.env.DINNERSYNC_LOCAL_AI = "enabled";
    serverMocks.checkCodexAvailability.mockResolvedValue({
      ok: false,
      error: { code: "SANDBOX_UNAVAILABLE", message: "C:\\private\\canary" },
    });

    const response = await GET(request());
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(text).toContain("SANDBOX_UNAVAILABLE");
    expect(text).not.toContain("private");
  });
});
