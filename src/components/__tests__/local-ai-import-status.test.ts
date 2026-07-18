import {
  DEMO_AI_DRAFTS,
  DEMO_SOURCE_RECIPES,
} from "@/modules/demo";
import { describe, expect, it, vi } from "vitest";

import { requestLocalAiImport } from "../local-ai-import";

const source = DEMO_SOURCE_RECIPES[0].sourceText;
const safeFailure = {
  ok: false,
  code: "LOCAL_AI_IMPORT_FAILED",
  message: "The local AI import could not be verified.",
};
const aborted = {
  ok: false,
  code: "LOCAL_AI_ABORTED",
  message: "The local AI request was cancelled.",
};

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function availableStatus() {
  return {
    ok: true,
    value: { installed: true, loggedIn: true, sandboxAvailable: true },
  };
}

function importSuccess() {
  return {
    ok: true,
    value: {
      drafts: [structuredClone(DEMO_AI_DRAFTS[0])],
      provider: "openai-codex-cli",
      model: "gpt-5.6-terra",
      schemaValidated: true,
      evidenceValidated: true,
    },
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("requestLocalAiImport status gate", () => {
  it("returns a stable disabled result without ever sending recipe text", async () => {
    const marker = "private server detail";
    const fetchImpl: typeof fetch = vi.fn(async () => jsonResponse({
      ok: false,
      error: { code: "LOCAL_AI_DISABLED", message: marker },
    }, 404));

    const result = await requestLocalAiImport({ recipes: [source], diners: 2, fetchImpl });

    expect(result).toEqual({
      ok: false,
      code: "LOCAL_AI_DISABLED",
      message: "Local AI is not enabled on this server. Your recipe was not sent. Run npm run dev:local-ai or use Hosted Demo.",
    });
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    expect(url).toBe("/api/local-ai/status");
    expect(init).toMatchObject({ method: "POST" });
    expect(init?.body).toBeUndefined();
    expect(`${String(url)}${JSON.stringify(init)}`).not.toContain(source);
  });

  it("keeps every other status failure generic and private", async () => {
    const marker = "private login detail";
    const fetchImpl: typeof fetch = vi.fn(async () => jsonResponse({
      ok: false,
      error: { code: "CODEX_NOT_LOGGED_IN", message: marker },
    }, 401));

    const result = await requestLocalAiImport({ recipes: [source], diners: 2, fetchImpl });

    expect(result).toEqual(safeFailure);
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects status JSON served with a non-JSON content type", async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => new Response(
      JSON.stringify(availableStatus()),
      { status: 200, headers: { "content-type": "text/plain" } },
    ));

    await expect(requestLocalAiImport({ recipes: [source], diners: 2, fetchImpl }))
      .resolves.toEqual(safeFailure);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    ["not installed", { installed: false, loggedIn: true, sandboxAvailable: true }],
    ["not logged in", { installed: true, loggedIn: false, sandboxAvailable: true }],
    ["sandbox unavailable", { installed: true, loggedIn: true, sandboxAvailable: false }],
    ["extra metadata", {
      installed: true,
      loggedIn: true,
      sandboxAvailable: true,
      trusted: true,
    }],
  ])("does not import when status is %s", async (_label, value) => {
    const fetchImpl: typeof fetch = vi.fn(async () =>
      jsonResponse({ ok: true, value }));

    await expect(requestLocalAiImport({ recipes: [source], diners: 2, fetchImpl }))
      .resolves.toEqual(safeFailure);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("recognizes an AbortError during status preflight", async () => {
    const controller = new AbortController();
    const fetchImpl: typeof fetch = vi.fn(async () => {
      throw new DOMException("private cancellation", "AbortError");
    });

    await expect(requestLocalAiImport({
      recipes: [source], diners: 2, signal: controller.signal, fetchImpl,
    })).resolves.toEqual(aborted);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("stops when an abort happens before a late status response", async () => {
    const controller = new AbortController();
    const status = deferred<Response>();
    const fetchImpl: typeof fetch = vi.fn(async () => await status.promise);
    const pending = requestLocalAiImport({
      recipes: [source], diners: 2, signal: controller.signal, fetchImpl,
    });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());

    controller.abort();
    status.resolve(jsonResponse(availableStatus()));

    await expect(pending).resolves.toEqual(aborted);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("stops when an abort happens before a late import response", async () => {
    const controller = new AbortController();
    const imported = deferred<Response>();
    const fetchImpl = vi.fn<typeof fetch>(async (url) =>
      String(url) === "/api/local-ai/status"
        ? jsonResponse(availableStatus())
        : await imported.promise);
    const pending = requestLocalAiImport({
      recipes: [source], diners: 2, signal: controller.signal, fetchImpl,
    });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));

    controller.abort();
    imported.resolve(jsonResponse(importSuccess()));

    await expect(pending).resolves.toEqual(aborted);
    expect(vi.mocked(fetchImpl).mock.calls[0][1]?.signal).toBe(controller.signal);
    expect(vi.mocked(fetchImpl).mock.calls[1][1]?.signal).toBe(controller.signal);
  });
});
