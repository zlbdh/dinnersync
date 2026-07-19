// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { validateFinalMedia } from "./demo-media-validation.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { force: true, recursive: true })));
});

async function videoPath() {
  const directory = await mkdtemp(join(tmpdir(), "dinnersync-demo-media-"));
  temporaryDirectories.push(directory);
  const filePath = join(directory, "dinnersync.mp4");
  await writeFile(filePath, "test-media-placeholder", "utf8");
  return filePath;
}

describe("validateFinalMedia", () => {
  it("accepts a probed MP4 that matches the planned runtime with video and audio", async () => {
    const filePath = await videoPath();
    const runProbe = vi.fn(() => ({
      status: 0,
      stderr: "",
      stdout: JSON.stringify({
        format: { duration: "168.000000" },
        streams: [{ codec_type: "video" }, { codec_type: "audio" }],
      }),
    }));

    await expect(validateFinalMedia(filePath, {
      runProbe,
      expectedDurationSeconds: 168,
    })).resolves.toEqual({
      durationSeconds: 168,
      hasAudio: true,
      hasVideo: true,
    });
    expect(runProbe).toHaveBeenCalledWith(filePath);
  });

  it("fails before probing when the MP4 does not exist", async () => {
    const runProbe = vi.fn();

    await expect(validateFinalMedia("missing.mp4", { runProbe }))
      .rejects.toThrowError("Final MP4 does not exist:");
    expect(runProbe).not.toHaveBeenCalled();
  });

  it.each([
    ["duration is below the 150 second release floor", {
      format: { duration: "149.999" },
      streams: [{ codec_type: "video" }, { codec_type: "audio" }],
    }, "at least 150 seconds"],
    ["duration exceeds the 170 second planned ceiling", {
      format: { duration: "170.001" },
      streams: [{ codec_type: "video" }, { codec_type: "audio" }],
    }, "at most 170 seconds"],
    ["duration is 180 seconds", {
      format: { duration: "180" },
      streams: [{ codec_type: "video" }, { codec_type: "audio" }],
    }, "strictly below 180 seconds"],
    ["audio is missing", {
      format: { duration: "168" },
      streams: [{ codec_type: "video" }],
    }, "must contain an audio stream"],
    ["video is missing", {
      format: { duration: "168" },
      streams: [{ codec_type: "audio" }],
    }, "must contain a video stream"],
  ])("rejects media when %s", async (_label, payload, message) => {
    const filePath = await videoPath();

    await expect(validateFinalMedia(filePath, {
      runProbe: () => ({ status: 0, stderr: "", stdout: JSON.stringify(payload) }),
    })).rejects.toThrowError(message);
  });

  it("rejects media whose duration does not match the validated storyboard", async () => {
    const filePath = await videoPath();

    await expect(validateFinalMedia(filePath, {
      expectedDurationSeconds: 168,
      durationToleranceSeconds: 0.5,
      runProbe: () => ({
        status: 0,
        stderr: "",
        stdout: JSON.stringify({
          format: { duration: "167.499" },
          streams: [{ codec_type: "video" }, { codec_type: "audio" }],
        }),
      }),
    })).rejects.toThrowError("must match the 168s storyboard runtime within 0.5s");
  });
});
