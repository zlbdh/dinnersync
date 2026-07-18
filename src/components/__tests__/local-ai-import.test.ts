import {
  DEMO_AI_DRAFTS,
  DEMO_SOURCE_RECIPES,
} from "@/modules/demo";
import { describe, expect, it, vi } from "vitest";

import { requestLocalAiImport } from "../local-ai-import";

const source = DEMO_SOURCE_RECIPES[0].sourceText;

function successEnvelope(drafts: unknown[] = [structuredClone(DEMO_AI_DRAFTS[0])]) {
  return {
    ok: true,
    value: {
      drafts,
      provider: "openai-codex-cli",
      model: "gpt-5.6-terra",
      schemaValidated: true,
      evidenceValidated: true,
    },
  };
}

function availableStatusEnvelope() {
  return {
    ok: true,
    value: { installed: true, loggedIn: true, sandboxAvailable: true },
  };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function importFetch(importResponse: Response) {
  return vi.fn<typeof fetch>(async (url) =>
    String(url) === "/api/local-ai/status"
      ? jsonResponse(availableStatusEnvelope())
      : importResponse);
}

function remapStepIds(
  draft: (typeof DEMO_AI_DRAFTS)[number],
  suffix: string,
) {
  const ids = new Map(draft.steps.map((step) => [step.id, `${step.id}${suffix}`]));
  for (const step of draft.steps) {
    step.id = ids.get(step.id)!;
    step.dependsOn.value = step.dependsOn.value.map((id) => ids.get(id) ?? id);
  }
}

const safeFailure = {
  ok: false,
  code: "LOCAL_AI_IMPORT_FAILED",
  message: "The local AI import could not be verified.",
};

describe("requestLocalAiImport", () => {
  it("sends only the consent, fixed model, and exact recipes then creates review states", async () => {
    const controller = new AbortController();
    const fetchImpl = importFetch(jsonResponse(successEnvelope()));
    const input = {
      recipes: [source],
      diners: 4,
      notes: "must stay in the browser",
      settings: { targetKcalPerPerson: 650 },
      signal: controller.signal,
      fetchImpl,
    };

    const result = await requestLocalAiImport(input);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [statusUrl, statusInit] = vi.mocked(fetchImpl).mock.calls[0];
    expect(statusUrl).toBe("/api/local-ai/status");
    expect(statusInit).toMatchObject({ method: "POST", signal: controller.signal });
    expect(statusInit?.body).toBeUndefined();

    const [url, init] = vi.mocked(fetchImpl).mock.calls[1];
    expect(url).toBe("/api/local-ai/import");
    expect(init).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      consent: true,
      model: "gpt-5.6-terra",
      recipes: [source],
    });
    expect(String(init?.body)).not.toMatch(/notes|settings/i);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected a verified import");
    expect(result.meta).toEqual({
      provider: "openai-codex-cli",
      model: "gpt-5.6-terra",
      schemaValidated: true,
      evidenceValidated: true,
    });
    expect(result.reviewStates).toHaveLength(1);
    expect(result.reviewStates[0].targetServings).toBe(4);
    expect(result.reviewStates[0].ingredientDecisions.every((entry) =>
      entry.status === null && entry.nutritionMatchStatus === "unresolved")).toBe(true);
    expect(result.reviewStates[0].draft).not.toBe(DEMO_AI_DRAFTS[0]);
  });

  it("rejects non-success HTTP without exposing its response", async () => {
    const marker = "private raw response";
    const fetchImpl = importFetch(new Response(marker, { status: 503 }));

    const result = await requestLocalAiImport({ recipes: [source], diners: 2, fetchImpl });

    expect(result).toEqual(safeFailure);
    expect(JSON.stringify(result)).not.toContain(marker);
  });

  it("rejects malformed JSON with the same stable safe failure", async () => {
    const marker = "raw not-json detail";
    const fetchImpl = importFetch(new Response(marker, { status: 200 }));

    const result = await requestLocalAiImport({ recipes: [source], diners: 2, fetchImpl });

    expect(result).toEqual(safeFailure);
    expect(JSON.stringify(result)).not.toContain(marker);
  });

  it("rejects a success body served with a non-JSON content type", async () => {
    const response = new Response(JSON.stringify(successEnvelope()), {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
    const fetchImpl = importFetch(response);

    await expect(requestLocalAiImport({ recipes: [source], diners: 2, fetchImpl }))
      .resolves.toEqual(safeFailure);
  });

  it("rejects a bad success envelope", async () => {
    const fetchImpl = importFetch(jsonResponse({
      success: true,
      value: successEnvelope().value,
    }));

    await expect(requestLocalAiImport({ recipes: [source], diners: 2, fetchImpl }))
      .resolves.toEqual(safeFailure);
  });

  it.each([
    ["wrong provider", { provider: "lookalike-provider" }],
    ["wrong model", { model: "gpt-5.6-sol" }],
    ["unvalidated schema", { schemaValidated: false }],
    ["unvalidated evidence", { evidenceValidated: false }],
  ])("rejects %s metadata", async (_label, override) => {
    const payload = {
      ok: true,
      value: { ...successEnvelope().value, ...override },
    };
    const fetchImpl = importFetch(jsonResponse(payload));

    await expect(requestLocalAiImport({ recipes: [source], diners: 2, fetchImpl }))
      .resolves.toEqual(safeFailure);
  });

  it("rejects a draft count that differs from the submitted recipes", async () => {
    const fetchImpl = importFetch(jsonResponse(successEnvelope([])));

    await expect(requestLocalAiImport({ recipes: [source], diners: 2, fetchImpl }))
      .resolves.toEqual(safeFailure);
  });

  it("rejects duplicate recipe ids even if a forged server response claims validation", async () => {
    const first = structuredClone(DEMO_AI_DRAFTS[0]);
    const second = structuredClone(first);
    remapStepIds(second, "-second");
    const fetchImpl = importFetch(jsonResponse(successEnvelope([first, second])));

    const result = await requestLocalAiImport({
      recipes: [source, source],
      diners: 2,
      fetchImpl,
    });

    expect(result).toEqual(safeFailure);
    expect(result).not.toHaveProperty("reviewStates");
    expect(JSON.stringify(result)).not.toContain(source);
  });

  it("accepts a valid forged batch only when recipe and global step ids are unique", async () => {
    const first = structuredClone(DEMO_AI_DRAFTS[0]);
    const second = structuredClone(first);
    second.id = `${first.id}-second`;
    remapStepIds(second, "-second");
    const fetchImpl = importFetch(jsonResponse(successEnvelope([first, second])));

    const result = await requestLocalAiImport({
      recipes: [source, source],
      diners: 2,
      fetchImpl,
    });

    expect(result).toMatchObject({
      ok: true,
      reviewStates: [{ draft: { id: first.id } }, { draft: { id: second.id } }],
    });
  });

  it("rejects duplicate step ids across forged server drafts", async () => {
    const first = structuredClone(DEMO_AI_DRAFTS[0]);
    const second = structuredClone(first);
    second.id = `${first.id}-second`;
    const fetchImpl = importFetch(jsonResponse(successEnvelope([first, second])));

    const result = await requestLocalAiImport({
      recipes: [source, source],
      diners: 2,
      fetchImpl,
    });

    expect(result).toEqual(safeFailure);
    expect(result).not.toHaveProperty("reviewStates");
    expect(JSON.stringify(result)).not.toContain(source);
  });

  it.each([
    ["changed original", (draft: typeof DEMO_AI_DRAFTS[number]) => {
      draft.sourceText = `${draft.sourceText}\nchanged`;
    }],
    ["mismatched evidence", (draft: typeof DEMO_AI_DRAFTS[number]) => {
      draft.name.evidence!.text = "not the source span";
    }],
    ["pre-confirmed field", (draft: typeof DEMO_AI_DRAFTS[number]) => {
      draft.name.status = "confirmed";
    }],
  ])("rejects a draft with %s", async (_label, mutate) => {
    const draft = structuredClone(DEMO_AI_DRAFTS[0]);
    mutate(draft);
    const fetchImpl = importFetch(jsonResponse(successEnvelope([draft])));

    await expect(requestLocalAiImport({ recipes: [source], diners: 2, fetchImpl }))
      .resolves.toEqual(safeFailure);
  });

  it("returns an identifiable safe cancellation and does not fall back", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl: typeof fetch = vi.fn();

    const result = await requestLocalAiImport({
      recipes: [source],
      diners: 2,
      signal: controller.signal,
      fetchImpl,
    });

    expect(result).toEqual({
      ok: false,
      code: "LOCAL_AI_ABORTED",
      message: "The local AI request was cancelled.",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("reviewStates");
  });

});
