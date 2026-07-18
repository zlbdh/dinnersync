// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const serverMocks = vi.hoisted(() => ({ runCodexImport: vi.fn() }));
vi.mock("@/modules/recipe-import/server", () => serverMocks);

import { POST } from "./route";

const validBody = {
  consent: true,
  model: "gpt-5.6-terra",
  recipes: ["Tomato toast: toast bread for 4 minutes."],
};

const successValue = {
  drafts: [{ id: "draft-1" }],
  provider: "openai-codex-cli",
  model: "gpt-5.6-terra",
  schemaValidated: true,
  evidenceValidated: true,
};

function request(
  body: unknown = validBody,
  headers: Record<string, string> = {},
) {
  return new Request("http://localhost:3000/api/local-ai/import", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "localhost:3000",
      origin: "http://localhost:3000",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe.sequential("POST /api/local-ai/import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DINNERSYNC_LOCAL_AI = "disabled";
  });

  afterEach(() => {
    delete process.env.DINNERSYNC_LOCAL_AI;
  });

  it("returns no-store 404 before loading the runner when disabled", async () => {
    const response = await POST(request());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "LOCAL_AI_DISABLED" },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(serverMocks.runCodexImport).not.toHaveBeenCalled();
  });

  it("requires exact same-origin Origin and Host", async () => {
    process.env.DINNERSYNC_LOCAL_AI = "enabled";

    const response = await POST(request(validBody, { origin: "http://localhost:3001" }));

    expect(response.status).toBe(403);
    expect(serverMocks.runCodexImport).not.toHaveBeenCalled();
  });

  it("requires explicit consent before running Codex", async () => {
    process.env.DINNERSYNC_LOCAL_AI = "enabled";

    const response = await POST(request({ ...validBody, consent: false }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "CONSENT_REQUIRED" },
    });
    expect(serverMocks.runCodexImport).not.toHaveBeenCalled();
  });

  it("strictly rejects extra fields, unverified models, and oversized bodies", async () => {
    process.env.DINNERSYNC_LOCAL_AI = "enabled";

    const extra = await POST(request({ ...validBody, secret: "no" }));
    const model = await POST(request({ ...validBody, model: "gpt-4o" }));
    const large = await POST(request(validBody, { "content-length": "9999999" }));

    expect(extra.status).toBe(400);
    await expect(extra.json()).resolves.toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(model.status).toBe(400);
    await expect(model.json()).resolves.toMatchObject({ error: { code: "MODEL_UNAVAILABLE" } });
    expect(large.status).toBe(413);
    await expect(large.json()).resolves.toMatchObject({ error: { code: "INPUT_TOO_LARGE" } });
    expect(serverMocks.runCodexImport).not.toHaveBeenCalled();
  });

  it("rejects blank recipe text and missing JSON content type at the route boundary", async () => {
    process.env.DINNERSYNC_LOCAL_AI = "enabled";

    const blank = await POST(request({ ...validBody, recipes: ["   "] }));
    const wrongType = await POST(request(validBody, { "content-type": "text/plain" }));

    expect(blank.status).toBe(400);
    await expect(blank.json()).resolves.toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(wrongType.status).toBe(400);
    await expect(wrongType.json()).resolves.toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(serverMocks.runCodexImport).not.toHaveBeenCalled();
  });

  it("rejects lookalike JSON media types and bounds an undeclared stream", async () => {
    process.env.DINNERSYNC_LOCAL_AI = "enabled";

    const lookalike = await POST(request(validBody, {
      "content-type": "application/json-patch+json",
    }));
    const streamed = await POST(request({
      ...validBody,
      recipes: ["x".repeat(270_000)],
    }));

    expect(lookalike.status).toBe(400);
    expect(streamed.status).toBe(413);
    expect(serverMocks.runCodexImport).not.toHaveBeenCalled();
  });

  it("passes only validated recipes and model to the local service", async () => {
    process.env.DINNERSYNC_LOCAL_AI = "enabled";
    serverMocks.runCodexImport.mockResolvedValue({ ok: true, value: successValue });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, value: successValue });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(serverMocks.runCodexImport).toHaveBeenCalledWith({
      recipes: validBody.recipes,
      model: validBody.model,
      signal: expect.any(AbortSignal),
    });
  });

  it("allows only one in-flight import and releases the slot afterward", async () => {
    process.env.DINNERSYNC_LOCAL_AI = "enabled";
    let finish!: (value: unknown) => void;
    serverMocks.runCodexImport.mockImplementationOnce(() =>
      new Promise((resolve) => { finish = resolve; }));
    const first = POST(request());
    await vi.waitFor(() => expect(serverMocks.runCodexImport).toHaveBeenCalledOnce());

    const second = await POST(request());

    expect(second.status).toBe(429);
    await expect(second.json()).resolves.toMatchObject({ error: { code: "LOCAL_AI_BUSY" } });
    finish({ ok: true, value: { ...successValue, drafts: [] } });
    await expect(first).resolves.toMatchObject({ status: 200 });

    serverMocks.runCodexImport.mockResolvedValueOnce({
      ok: true,
      value: { ...successValue, drafts: [] },
    });
    await expect(POST(request())).resolves.toMatchObject({ status: 200 });
  });

  it("maps service failures without exposing its message or stack", async () => {
    process.env.DINNERSYNC_LOCAL_AI = "enabled";
    const marker = "C:\\private\\raw stderr";
    serverMocks.runCodexImport.mockResolvedValue({
      ok: false,
      error: { code: "CODEX_QUOTA", message: marker, diagnostics: [] },
    });

    const response = await POST(request());
    const text = await response.text();

    expect(response.status).toBe(429);
    expect(text).toContain("CODEX_QUOTA");
    expect(text).not.toContain(marker);
  });

  it("blocks parsing with a stable code when local isolation is unavailable", async () => {
    process.env.DINNERSYNC_LOCAL_AI = "enabled";
    serverMocks.runCodexImport.mockResolvedValue({
      ok: false,
      error: { code: "SANDBOX_UNAVAILABLE", message: "private gate detail", diagnostics: [] },
    });

    const response = await POST(request());
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(text).toContain("SANDBOX_UNAVAILABLE");
    expect(text).not.toContain("private gate detail");
  });
});
