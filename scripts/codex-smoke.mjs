import {
  CodexRunnerError,
  createCodexRunner,
  VERIFIED_CODEX_MODELS,
} from "../src/modules/recipe-import/codex-runner.ts";

const DEFAULT_MODEL = "gpt-5.6-terra";
const model = process.env.DINNERSYNC_CODEX_MODEL ?? DEFAULT_MODEL;
const schema = {
  type: "object",
  properties: {
    ok: { type: "boolean", const: true },
  },
  required: ["ok"],
  additionalProperties: false,
};

function validateSmokeOutput(value) {
  if (
    typeof value !== "object"
    || value === null
    || Object.keys(value).length !== 1
    || value.ok !== true
  ) {
    throw new Error("Unexpected smoke output.");
  }
  return value;
}

try {
  if (!VERIFIED_CODEX_MODELS.includes(model)) {
    throw new CodexRunnerError(
      "CODEX_MODEL_NOT_VERIFIED",
      "The selected model has not passed capability discovery.",
    );
  }
  const runner = createCodexRunner();
  await runner.run({
    model,
    schema,
    validate: validateSmokeOutput,
    maxOutputBytes: 4_096,
    prompt: 'Return exactly this JSON object and nothing else: {"ok":true}. Do not call tools.',
  });
  console.log(`PASS: ${model} structured output`);
} catch (error) {
  const code = error instanceof CodexRunnerError ? error.code : "UNEXPECTED_ERROR";
  console.error(`FAIL: ${model} structured output (${code})`);
  process.exitCode = 1;
}
