import { checkLocalAiCapability } from
  "../src/modules/recipe-import/codex-capability.ts";

const result = await checkLocalAiCapability();
if (result.ok) {
  console.log("PASS: Codex sandbox denied the harmless outside canary.");
} else {
  console.error(`FAIL: ${result.error.code}`);
  process.exitCode = 1;
}
