const REQUIRED_SHOTS = [
  "problem",
  "hosted-no-model",
  "local-ai-consent",
  "local-ai-gpt56",
  "review",
  "timeline",
  "cook-60x",
  "delay-replan",
  "summary",
  "technical-split",
  "safety-boundaries",
];
const ALLOWED_SOURCES = new Set([
  "editorial",
  "hosted-fixture",
  "local-real",
  "architecture",
]);
const ALLOWED_RECORDING_STATUSES = new Set(["planned-not-recorded", "recorded"]);
const NON_ENGLISH_SCRIPT = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u;
export const EXPECTED_LOCAL_MODEL = "gpt-5.6-terra";

function isEnglish(value) {
  return typeof value === "string"
    && /[A-Za-z]/u.test(value)
    && !NON_ENGLISH_SCRIPT.test(value);
}

function words(value) {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

function shotText(shot) {
  const captions = Array.isArray(shot?.captions) ? shot.captions : [];
  return [shot?.screen, shot?.action, shot?.narration, ...captions]
    .filter((value) => typeof value === "string")
    .join(" ");
}

export function validateDemoPlan(storyboard, script) {
  const errors = [];
  const expect = (condition, message) => {
    if (!condition) errors.push(message);
  };
  const shots = Array.isArray(storyboard?.shots) ? storyboard.shots : [];
  const policy = storyboard?.durationPolicy ?? {};

  expect(storyboard?.version === 1, "storyboard.version must be 1.");
  expect(storyboard?.language === "en", "storyboard.language must be en.");
  expect(
    ALLOWED_RECORDING_STATUSES.has(storyboard?.recordingStatus),
    "recordingStatus must be planned-not-recorded or recorded.",
  );
  expect(policy.minimumSeconds === 150, "Minimum runtime must be 150 seconds.");
  expect(policy.maximumSeconds === 170, "Maximum runtime must be 170 seconds.");
  expect(
    policy.hardMaximumSecondsExclusive === 180,
    "Hard runtime ceiling must be strictly below 180 seconds.",
  );
  expect(shots.length > 0, "storyboard.shots must not be empty.");

  const seenIds = new Set();
  let previousEnd = 0;
  let narrationWordCount = 0;

  for (const [index, shot] of shots.entries()) {
    const label = `Shot ${index + 1}`;
    expect(typeof shot?.id === "string" && shot.id.length > 0, `${label} needs an id.`);
    expect(!seenIds.has(shot?.id), `${label} has duplicate id ${shot?.id}.`);
    seenIds.add(shot?.id);

    expect(Number.isInteger(shot?.startSecond), `${shot?.id} startSecond must be an integer.`);
    expect(Number.isInteger(shot?.endSecond), `${shot?.id} endSecond must be an integer.`);
    expect(shot?.startSecond === previousEnd, `${shot?.id} must start at ${previousEnd}s.`);
    expect(shot?.endSecond > shot?.startSecond, `${shot?.id} must have positive duration.`);
    if (Number.isInteger(shot?.endSecond)) previousEnd = shot.endSecond;

    expect(ALLOWED_SOURCES.has(shot?.source), `${shot?.id} has an invalid source.`);
    expect(isEnglish(shot?.screen), `${shot?.id} screen direction must be English.`);
    expect(isEnglish(shot?.action), `${shot?.id} action must be English.`);
    expect(isEnglish(shot?.narration), `${shot?.id} narration must be English.`);
    expect(
      Array.isArray(shot?.captions) && shot.captions.length > 0,
      `${shot?.id} needs at least one caption.`,
    );
    for (const caption of Array.isArray(shot?.captions) ? shot.captions : []) {
      expect(isEnglish(caption), `${shot?.id} captions must be English.`);
      expect(script.includes(caption), `${shot?.id} caption is missing from demo-script.md.`);
    }
    expect(
      script.includes(`<!-- shot:${shot?.id} -->`),
      `${shot?.id} marker is missing from demo-script.md.`,
    );
    if (typeof shot?.narration === "string") {
      expect(script.includes(shot.narration), `${shot.id} narration is missing from demo-script.md.`);
      narrationWordCount += words(shot.narration);
    }
  }

  const totalSeconds = previousEnd;
  const narrationWordsPerMinute = totalSeconds > 0
    ? narrationWordCount / (totalSeconds / 60)
    : 0;

  expect(storyboard?.totalSeconds === totalSeconds, "totalSeconds must match the final shot ending.");
  expect(totalSeconds >= 150, `Runtime is ${totalSeconds}s; minimum is 150s.`);
  expect(totalSeconds <= 170, `Runtime is ${totalSeconds}s; target maximum is 170s.`);
  expect(totalSeconds < 180, `Runtime is ${totalSeconds}s; it must be below 180s.`);
  expect(
    narrationWordsPerMinute >= 105 && narrationWordsPerMinute <= 155,
    `Narration pace is ${narrationWordsPerMinute.toFixed(1)} wpm; expected 105–155 wpm.`,
  );

  for (const id of REQUIRED_SHOTS) {
    expect(seenIds.has(id), `Required shot is missing: ${id}.`);
  }

  const byId = new Map(shots.map((shot) => [shot.id, shot]));
  expect(byId.get("hosted-no-model")?.source === "hosted-fixture", "Hosted shot must use the fixture source.");
  expect(byId.get("local-ai-consent")?.source === "local-real", "Consent shot must be a real Local AI recording.");
  expect(byId.get("local-ai-gpt56")?.source === "local-real", "GPT-5.6 shot must be a real Local AI recording.");
  expect(/consent/i.test(shotText(byId.get("local-ai-consent"))), "Consent shot must explicitly show consent.");
  expect(/gpt-5\.6-terra/iu.test(shotText(byId.get("local-ai-gpt56"))), "Local AI shot must name gpt-5.6-terra.");
  expect(/60×|60x/iu.test(shotText(byId.get("cook-60x"))), "Cook shot must show 60× playback.");
  expect(/\+?8|eight-minute/iu.test(shotText(byId.get("delay-replan"))), "Delay shot must show the eight-minute delay.");
  expect(/replan/iu.test(shotText(byId.get("delay-replan"))), "Delay shot must show replanning.");
  expect(/19:00|7:00/iu.test(shotText(byId.get("summary"))), "Summary must show the planned finish.");
  expect(/19:08|7:08/iu.test(shotText(byId.get("summary"))), "Summary must show the actual finish.");
  expect(storyboard?.claims?.hostedModelRequests === 0, "Hosted model request count must be zero.");
  expect(storyboard?.claims?.speedMultiplier === 60, "Playback claim must be 60×.");
  expect(storyboard?.claims?.delayMinutes === 8, "Delay claim must be eight minutes.");
  expect(
    storyboard?.claims?.localModel === EXPECTED_LOCAL_MODEL,
    `Local model claim must be ${EXPECTED_LOCAL_MODEL}.`,
  );

  const allText = shots.map(shotText).join(" ");
  expect(/estimated kcal|kcal estimate/iu.test(allText), "The script must label kcal as an estimate.");
  expect(/not medical advice/iu.test(allText), "The script must include the medical safety boundary.");
  expect(/pre-reviewed fixture/iu.test(storyboard?.truthPolicy?.hosted ?? ""), "Hosted truth policy must name the fixture.");
  expect(/no model request/iu.test(storyboard?.truthPolicy?.hosted ?? ""), "Hosted truth policy must state no model request.");
  expect(/real local recording/iu.test(storyboard?.truthPolicy?.local ?? ""), "Local truth policy must require a real recording.");
  expect(/never.*fixture/iu.test(storyboard?.truthPolicy?.local ?? ""), "Local truth policy must forbid fixture substitution.");
  expect(
    new RegExp(EXPECTED_LOCAL_MODEL.replace(".", "\\."), "iu")
      .test(storyboard?.truthPolicy?.local ?? ""),
    `Local truth policy must name ${EXPECTED_LOCAL_MODEL}.`,
  );

  if (errors.length > 0) {
    throw new Error(`Demo plan validation failed with ${errors.length} issue(s):\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }

  return {
    localModel: storyboard.claims.localModel,
    narrationWordCount,
    narrationWordsPerMinute,
    recordingStatus: storyboard.recordingStatus,
    shotCount: shots.length,
    totalSeconds,
  };
}
