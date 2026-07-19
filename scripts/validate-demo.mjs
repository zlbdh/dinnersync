import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateFinalMedia } from "./demo-media-validation.mjs";
import { validateDemoPlan } from "./demo-plan-validation.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const storyboardPath = new URL("../docs/submission/storyboard.json", import.meta.url);
const scriptPath = new URL("../docs/submission/demo-script.md", import.meta.url);
const usage = "Usage: node scripts/validate-demo.mjs --plan | --final <mp4>";

async function loadMaterials() {
  const [storyboardSource, script] = await Promise.all([
    readFile(storyboardPath, "utf8"),
    readFile(scriptPath, "utf8"),
  ]);
  return { storyboard: JSON.parse(storyboardSource), script };
}

async function main(args) {
  const [mode, mediaPath, ...extra] = args;
  if ((mode !== "--plan" && mode !== "--final")
    || extra.length > 0
    || (mode === "--plan" && mediaPath !== undefined)
    || (mode === "--final" && !mediaPath)) {
    throw new Error(usage);
  }

  const { storyboard, script } = await loadMaterials();
  const plan = validateDemoPlan(storyboard, script);
  if (mode === "--plan") {
    console.log(
      `Demo plan validation passed (${plan.recordingStatus}): ${plan.shotCount} shots, ${plan.totalSeconds}s, ${plan.narrationWordCount} words, ${plan.narrationWordsPerMinute.toFixed(1)} wpm. No final MP4 was checked.`,
    );
    return;
  }

  const media = await validateFinalMedia(resolve(process.cwd(), mediaPath), {
    durationToleranceSeconds: 0.5,
    expectedDurationSeconds: plan.totalSeconds,
    hardMaximumSecondsExclusive: storyboard.durationPolicy.hardMaximumSecondsExclusive,
    maximumSeconds: storyboard.durationPolicy.maximumSeconds,
    minimumSeconds: storyboard.durationPolicy.minimumSeconds,
  });
  if (plan.recordingStatus !== "recorded") {
    throw new Error("recordingStatus must be recorded before final media can pass.");
  }
  console.log(
    `Final media validation passed: ${media.durationSeconds.toFixed(3)}s with video and audio.`,
  );
  // 2026-07-19 by Codex — container metadata cannot prove what appears on screen.
  console.log(
    "Manual review is still required for footage truthfulness, consent, and exact Local AI evidence.",
  );
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (!(error instanceof Error) || !error.message.includes("Usage:")) {
    console.error(`Materials root: ${projectRoot}`);
  }
  process.exitCode = 1;
}
