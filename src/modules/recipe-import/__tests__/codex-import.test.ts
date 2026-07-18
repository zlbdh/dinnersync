// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { CodexRunnerError } from "../codex-types";
import type { CodexRunRequest } from "../codex-types";
import {
  createCodexImportService,
  type CodexImportRunner,
} from "../codex-import";
import { MAX_RECIPE_CHARS } from "../codex-prompt";
import { makeAiDraft, RECIPE_SOURCE } from "./draft-fixture";

function fakeRunner(
  run: <T>(request: CodexRunRequest<T>) => Promise<T>,
): CodexImportRunner {
  return { run };
}

describe("runCodexImport", () => {
  it("fails closed for a malformed runtime request", async () => {
    const runSpy = vi.fn();
    const run = createCodexImportService(fakeRunner(runSpy));

    await expect(run(null as never)).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("runs one bounded batch through the verified model and strict validator", async () => {
    let captured: CodexRunRequest<unknown> | undefined;
    const runner = fakeRunner(async <T,>(request: CodexRunRequest<T>) => {
      captured = request as CodexRunRequest<unknown>;
      return request.validate({ drafts: [makeAiDraft()] });
    });
    const signal = new AbortController().signal;
    const run = createCodexImportService(runner);

    const result = await run({
      recipes: [RECIPE_SOURCE],
      model: "gpt-5.6-terra",
      signal,
      timeoutMs: 12_345,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        drafts: [makeAiDraft()],
        provider: "openai-codex-cli",
        model: "gpt-5.6-terra",
        schemaValidated: true,
        evidenceValidated: true,
      },
    });
    expect(captured).toMatchObject({
      model: "gpt-5.6-terra",
      signal,
      timeoutMs: 12_345,
      maxOutputBytes: expect.any(Number),
    });
    expect(captured?.prompt).toContain(JSON.stringify({ recipes: [RECIPE_SOURCE] }));
  });

  it("rejects unverified models and oversized input before starting Codex", async () => {
    const runSpy = vi.fn();
    const run = createCodexImportService(fakeRunner(runSpy));

    await expect(run({ recipes: [RECIPE_SOURCE], model: "gpt-4o" }))
      .resolves.toMatchObject({ ok: false, error: { code: "MODEL_UNAVAILABLE" } });
    await expect(run({
      recipes: ["x".repeat(MAX_RECIPE_CHARS + 1)],
      model: "gpt-5.6-sol",
    })).resolves.toMatchObject({ ok: false, error: { code: "INPUT_TOO_LARGE" } });
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("distinguishes evidence mismatch from other invalid model output", async () => {
    const forged = makeAiDraft();
    forged.sourceText = `${RECIPE_SOURCE} forged`;
    const evidenceRun = createCodexImportService(fakeRunner(async (request) =>
      request.validate({ drafts: [forged] })));
    const invalidRun = createCodexImportService(fakeRunner(async (request) =>
      request.validate({ drafts: [{ nope: true }] })));

    await expect(evidenceRun({ recipes: [RECIPE_SOURCE], model: "gpt-5.6-sol" }))
      .resolves.toMatchObject({ ok: false, error: { code: "EVIDENCE_MISMATCH" } });
    await expect(invalidRun({ recipes: [RECIPE_SOURCE], model: "gpt-5.6-sol" }))
      .resolves.toMatchObject({ ok: false, error: { code: "INVALID_MODEL_OUTPUT" } });
  });

  it("requires exactly one validated draft for every submitted recipe", async () => {
    const run = createCodexImportService(fakeRunner(async (request) =>
      request.validate({ drafts: [] })));

    await expect(run({ recipes: [RECIPE_SOURCE], model: "gpt-5.6-sol" }))
      .resolves.toMatchObject({ ok: false, error: { code: "INVALID_MODEL_OUTPUT" } });
  });

  it("does not issue validation metadata for a non-strict batch envelope", async () => {
    const run = createCodexImportService(fakeRunner(async (request) =>
      request.validate({ drafts: [makeAiDraft()], fixture: true })));

    const result = await run({ recipes: [RECIPE_SOURCE], model: "gpt-5.6-sol" });

    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_MODEL_OUTPUT" } });
    expect(JSON.stringify(result)).not.toContain("schemaValidated");
  });

  it.each([
    ["CODEX_SPAWN_FAILED", "CODEX_NOT_INSTALLED"],
    ["CODEX_NOT_LOGGED_IN", "CODEX_NOT_LOGGED_IN"],
    ["CODEX_SANDBOX_UNAVAILABLE", "SANDBOX_UNAVAILABLE"],
    ["CODEX_MODEL_UNAVAILABLE", "MODEL_UNAVAILABLE"],
    ["CODEX_TIMEOUT", "CODEX_TIMEOUT"],
    ["CODEX_QUOTA_EXCEEDED", "CODEX_QUOTA"],
    ["CODEX_INVALID_OUTPUT", "INVALID_MODEL_OUTPUT"],
  ] as const)("maps %s to safe public code %s", async (runnerCode, publicCode) => {
    const privateMarker = "private stderr C:\\Users\\secret";
    const runner = fakeRunner(async () => {
      throw new CodexRunnerError(runnerCode, privateMarker);
    });
    const result = await createCodexImportService(runner)({
      recipes: [RECIPE_SOURCE],
      model: "gpt-5.6-sol",
    });

    expect(result).toMatchObject({ ok: false, error: { code: publicCode } });
    expect(JSON.stringify(result)).not.toContain(privateMarker);
  });
});
