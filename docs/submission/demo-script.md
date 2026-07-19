# DinnerSync Demo Script

Status: final recording and upload verified on 2026-07-19; the video is available at https://youtu.be/m6pEglt6Rxc.

- Target runtime: **168 seconds** (2:48), with a required 150–170 second range and a hard limit below 180 seconds.
- Spoken language: English.
- Subtitle language: English; burn in every caption listed below.
- Truth rule: Hosted footage is the pre-reviewed fixture and makes no model request. The Local AI segment must be newly captured from a real localhost run with explicit consent and the exact `gpt-5.6-terra` metadata visible.
- Edit rule: model waiting time may be shortened, but clicks, successful results, badges, validation states, dispatcher events, and Summary values must remain genuine.

## Capture preparation

1. Record the Hosted path in a clean, logged-out browser at 1440×900 with browser notifications hidden.
2. Record the two Local AI shots separately on localhost. Use the real `dev:local-ai` path, a logged-in Codex session, prepared non-sensitive recipe text, and the model name actually returned by the app.
3. Do not splice Hosted fixture results into either Local AI shot. If the live result or validation badges are not visible, recapture it.
4. Use cursor emphasis and straight cuts. Use no copyrighted music; narration and UI audio should remain intelligible.
5. Run `npm run validate:demo` while planning. After recording, set `recordingStatus` to `recorded` and run `npm run validate:demo:final -- artifacts/demo/dinnersync.mp4`; this invokes `ffprobe` for real duration and stream checks. It does not prove footage truthfulness, which remains a manual gate.

## 01 — The coordination problem
<!-- shot:problem -->

- Time: 0:00–0:12
- Source: Editorial composition from real product UI
- Screen: Open on the DinnerSync wordmark, then reveal three recipe cards beside one crowded kitchen timeline.
- Action: Animate the three recipes converging on a single serve marker.
- Narration: Cooking three dishes is not three timers. One oven, two burners, shared hands, and a fixed dinner time create a dependency problem that ordinary recipe apps ignore.
- Caption: Three recipes. One kitchen. One finish line.

## 02 — Hosted is deterministic
<!-- shot:hosted-no-model -->

- Time: 0:12–0:21
- Source: Hosted fixture
- Screen: Show the Hosted Demo mode card and its privacy copy before touching the sample button.
- Action: Hold long enough for the Hosted privacy boundary to be readable.
- Narration: First, the public Hosted Demo loads a pre-reviewed fixture in the browser. It makes zero model requests and sends no recipe data.
- Caption: Hosted Demo · pre-reviewed fixture · 0 model requests

## 03 — Load the dinner setup
<!-- shot:hosted-setup -->

- Time: 0:21–0:32
- Source: Hosted fixture
- Screen: Click Try the 650 kcal demo and follow the real transition directly into the pre-reviewed Review screen.
- Action: Hold on the built-in reviewed fixture notice and the three-recipe decision ledger; do not imply that Setup remains visible after the click.
- Narration: One click opens a pre-reviewed chicken, rice, and vegetable dinner for four, targeting 7 PM and an estimated 650 kilocalories per person.
- Caption: 4 diners · 7:00 PM · 650 kcal target (estimate)

## 04 — Explicit Local AI consent
<!-- shot:local-ai-consent -->

- Time: 0:32–0:41
- Source: Real Local AI recording
- Screen: Cut to a real localhost session, select Local AI, and show the OpenAI data notice and unchecked consent control.
- Action: Paste the prepared recipe text, then click the consent checkbox on camera before submitting.
- Narration: Now the real Local AI path. I paste recipe text, select Local AI, and consent before anything is sent to OpenAI.
- Caption: Local AI · explicit consent required

## 05 — Real GPT-5.6 result
<!-- shot:local-ai-gpt56 -->

- Time: 0:41–0:53
- Source: Real Local AI recording
- Screen: Keep the real Local AI result visible with the exact `gpt-5.6-terra` model badge and schema and evidence validation indicators.
- Action: Trim waiting time only; never replace this segment with Hosted fixture footage.
- Narration: This is genuine Local AI, not fixture footage. Logged-in Codex runs gpt-5.6-terra, returns typed candidates, and the app validates schema and source evidence.
- Caption: Real Local AI · gpt-5.6-terra · schema + evidence validated

## 06 — Human-gated Review
<!-- shot:review -->

- Time: 0:53–1:08
- Source: Hosted fixture for a repeatable walkthrough
- Screen: Return to the repeatable Hosted path and scroll through servings, ingredients, food states, steps, temperatures, and evidence excerpts.
- Action: Pause on one source-evidence highlight and the completed decision ledger. The Hosted fixture is already reviewed; do not stage confirmation clicks.
- Narration: The Hosted fixture is pre-reviewed, so judges can inspect ingredients, steps, temperatures, nutrition matches, and source evidence without staged confirmations. Local AI stays locked until human approval.
- Caption: Hosted fixture · pre-reviewed decisions · evidence visible

## 07 — Traceable calorie estimate
<!-- shot:nutrition -->

- Time: 1:08–1:19
- Source: Hosted fixture
- Screen: Show the traceable nutrition matches, catalog source, meal total, and per-person estimate.
- Action: Pause on the estimate and safety copy without presenting it as a health guarantee.
- Narration: Nutrition is separate deterministic math over traceable catalog records. DinnerSync shows each match and the estimated kcal per person; it is not medical advice.
- Caption: Estimated kcal · traceable catalog · not medical advice

## 08 — Resource-feasible timeline
<!-- shot:timeline -->

- Time: 1:19–1:36
- Source: Hosted fixture
- Screen: Click Build the service timeline and pan across the dish tracks, shared-resource labels, dependencies, and serve marker.
- Action: Use cursor callouts to connect overlapping work to oven, burner, and hands constraints.
- Narration: After review, the scheduler builds one resource-feasible timeline. These tracks expose dependencies and conflicts across oven, burners, and hands, while the common serve marker keeps all three dishes inside the five-minute window.
- Caption: Deterministic scheduler · dependencies + shared resources

## 09 — Start the real session state
<!-- shot:cook-start -->

- Time: 1:36–1:45
- Source: Hosted fixture
- Screen: Click Start cooking and show the live task cards with their Start, Complete, and Delay controls.
- Action: Point to the replay status text that says normal dispatcher semantics are retained.
- Narration: I start cooking from the validated plan. Every Start, Complete, and Delay is an explicit event against the same session state.
- Caption: One event dispatcher for live and replay

## 10 — 60× Cook replay
<!-- shot:cook-60x -->

- Time: 1:45–1:59
- Source: Hosted fixture
- Screen: Click 60× replay and keep the advancing clock, active task, and event status visible together.
- Action: Speed-ramp only the screen capture; do not reorder or synthesize events in the edit.
- Narration: For a short judging demo, 60-times playback compresses waiting only. It does not change task order or invent outcomes; replay uses that same normal event dispatcher.
- Caption: 60× playback · speed changes, logic does not

## 11 — Eight-minute delay and replan
<!-- shot:delay-replan -->

- Time: 1:59–2:15
- Source: Hosted fixture
- Screen: Keep the chicken roast visible as the +8 minute event lands, then show pending task times and the serve forecast move.
- Action: Freeze-frame the delay record and the replanned 7:08 PM finish marker for one beat.
- Narration: During the chicken roast, the scenario records a real plus-eight-minute Delay event. DinnerSync replans only work that has not started, preserves completed facts, and moves the feasible finish to 7:08.
- Caption: +8 min roast delay · deterministic replan

## 12 — Evidence-based Summary
<!-- shot:summary -->

- Time: 2:15–2:29
- Source: Hosted fixture
- Screen: Land on Summary with planned and actual completion, run record, nutrition totals, and the next-service note visible.
- Action: Highlight 7:00 PM, 7:08 PM, 8 min late, one recorded delay, and the critical-path note in sequence.
- Narration: Summary compares the 7:00 planned finish with the recorded 7:08 completion, one delay, eight delay minutes, and the actual replan passes. Its next-service note comes only from critical-path evidence.
- Caption: Planned 7:00 PM · actual 7:08 PM · 8 min late

## 13 — AI and deterministic code split
<!-- shot:technical-split -->

- Time: 2:29–2:39
- Source: Architecture card
- Screen: Show a two-column architecture card labeled AI candidate extraction and Deterministic application core.
- Action: Reveal the Codex boundary first, then the validation, nutrition, scheduler, session, persistence, and Summary modules.
- Narration: GPT-5.6 structures candidates. Deterministic TypeScript owns review, nutrition, scheduling, replay, replanning, and Summary.
- Caption: AI: candidate extraction · Code: validation, math, schedule, state

## 14 — Safety boundaries and close
<!-- shot:safety-boundaries -->

- Time: 2:39–2:48
- Source: Architecture end card
- Screen: End on the product mark with three concise boundary cards for Hosted, Local AI, and human decisions.
- Action: Hold the final frame for one second with the project name and Apps for Your Life track.
- Narration: Hosted has no Local AI route. Local use requires loopback, consent, validation, and human judgment for allergens and food safety.
- Caption: No hosted model route · local consent · validated boundaries

## Final recording gate

- The real Local AI clip visibly includes consent, successful parsing, the returned `gpt-5.6-terra` identifier, and schema and evidence validation.
- Hosted is described only as a pre-reviewed deterministic fixture with zero model requests.
- The final video has English narration, matching English subtitles, an audible track, no secrets or personal information, and a measured runtime below 180 seconds.
- `validate:demo:final` confirms only MP4 existence, duration, and video/audio streams; a person must still verify every visual and Local AI truth claim.
- The unlisted public-link upload resolves without authentication, and its title identifies DinnerSync, OpenAI Build Week, and Apps for Your Life.
