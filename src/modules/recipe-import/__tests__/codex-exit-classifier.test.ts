// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createCodexExitClassifier } from "../codex-exit-classifier";

describe("Codex exit classifier", () => {
  it.each([
    ["Not logged in. Run codex login", "CODEX_NOT_LOGGED_IN"],
    ["Usage limit reached; try again later", "CODEX_QUOTA_EXCEEDED"],
    ["The requested model is not supported", "CODEX_MODEL_UNAVAILABLE"],
  ] as const)("maps safe diagnostic %s without retaining private output", (stderr, code) => {
    const classifier = createCodexExitClassifier();
    classifier.add(`${stderr} C:\\private\\marker`);

    const error = classifier.error(1);

    expect(error).toMatchObject({ code, exitCode: 1 });
    expect(String(error)).not.toContain(stderr);
    expect(JSON.stringify(error)).not.toContain("private");
  });

  it("keeps unknown output as a generic exit failure", () => {
    const classifier = createCodexExitClassifier();
    classifier.add("unrecognized private failure");

    expect(classifier.error(2)).toMatchObject({
      code: "CODEX_EXIT_FAILED",
      exitCode: 2,
    });
  });
});
