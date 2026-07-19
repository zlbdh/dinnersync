import { spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { extname, resolve } from "node:path";

function runFfprobe(filePath) {
  return spawnSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type",
    "-of", "json",
    filePath,
  ], {
    encoding: "utf8",
    maxBuffer: 1_048_576,
    windowsHide: true,
  });
}

function parseProbeResult(result) {
  if (result.error) {
    throw new Error(`ffprobe could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`ffprobe failed: ${(result.stderr || "unknown error").trim()}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("ffprobe returned invalid JSON.");
  }
}

function validateProbePayload(payload, options = {}) {
  const durationSeconds = Number(payload?.format?.duration);
  const minimumSeconds = options.minimumSeconds ?? 150;
  const maximumSeconds = options.maximumSeconds ?? 170;
  const hardMaximumSecondsExclusive = options.hardMaximumSecondsExclusive ?? 180;
  const expectedDurationSeconds = options.expectedDurationSeconds;
  const durationToleranceSeconds = options.durationToleranceSeconds ?? 0.5;
  const streamTypes = new Set(
    Array.isArray(payload?.streams)
      ? payload.streams.map((stream) => stream?.codec_type)
      : [],
  );
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Final MP4 duration must be a positive number.");
  }
  if (durationSeconds >= hardMaximumSecondsExclusive) {
    throw new Error(`Final MP4 must be strictly below ${hardMaximumSecondsExclusive} seconds; ffprobe reported ${durationSeconds}s.`);
  }
  if (durationSeconds < minimumSeconds) {
    throw new Error(`Final MP4 must be at least ${minimumSeconds} seconds; ffprobe reported ${durationSeconds}s.`);
  }
  if (durationSeconds > maximumSeconds) {
    throw new Error(`Final MP4 must be at most ${maximumSeconds} seconds; ffprobe reported ${durationSeconds}s.`);
  }
  if (Number.isFinite(expectedDurationSeconds)
    && Math.abs(durationSeconds - expectedDurationSeconds) > durationToleranceSeconds) {
    throw new Error(`Final MP4 must match the ${expectedDurationSeconds}s storyboard runtime within ${durationToleranceSeconds}s; ffprobe reported ${durationSeconds}s.`);
  }
  if (!streamTypes.has("video")) {
    throw new Error("Final MP4 must contain a video stream.");
  }
  if (!streamTypes.has("audio")) {
    throw new Error("Final MP4 must contain an audio stream.");
  }
  return {
    durationSeconds,
    hasAudio: true,
    hasVideo: true,
  };
}

export async function validateFinalMedia(inputPath, options = {}) {
  const filePath = resolve(inputPath);
  if (extname(filePath).toLowerCase() !== ".mp4") {
    throw new Error(`Final media must be an MP4 file: ${filePath}`);
  }
  let file;
  try {
    file = await stat(filePath);
  } catch {
    throw new Error(`Final MP4 does not exist: ${filePath}`);
  }
  if (!file.isFile()) {
    throw new Error(`Final MP4 is not a file: ${filePath}`);
  }
  const runProbe = options.runProbe ?? runFfprobe;
  return validateProbePayload(parseProbeResult(runProbe(filePath)), options);
}
