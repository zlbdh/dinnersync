# Submission checklist

Unchecked items above the final-state section block final Devpost submission. The final-state section is completed during and immediately after submission so that the submitted URL, timestamp, and proof can be recorded from the real result.

## Track and project fields

- [ ] Devpost project name is **DinnerSync**.
- [ ] Track is **Apps for Your Life**.
- [ ] Tagline is **Plan together. Cook on time.**
- [ ] Project description matches `docs/submission/devpost-copy.md`.
- [ ] No field claims that Hosted Demo uses a model.
- [ ] No field claims medical, weight-loss, allergy, food-safety, or guaranteed calorie outcomes.

## Public links

- [x] Hosted Demo opens without login: [https://ds.zlbdh.site:8443](https://ds.zlbdh.site:8443).
- [x] Hosted Demo completes the full fixed replay from an unsigned browser.
- [x] Public repository URL: [https://github.com/zlbdh/dinnersync](https://github.com/zlbdh/dinnersync).
- [ ] Repository opens without login and contains the final commit history.
- [x] Repository contains an MIT `LICENSE` file.
- [x] Public YouTube/video URL: [https://youtu.be/m6pEglt6Rxc](https://youtu.be/m6pEglt6Rxc).
- [x] Video resolves without login through YouTube's public oEmbed endpoint.
- [x] Video duration is less than 180 seconds (verified: 168.000 seconds).
- [x] Video contains an audible narration or audio track (AAC, 48 kHz stereo; manual audio review completed).
- [x] Video title/description identify DinnerSync, OpenAI Build Week, and Apps for Your Life.

## Product truthfulness

- [x] Hosted Demo uses checked-in fixtures and makes no Local AI request.
- [x] Production disables Local AI routes and returns 404.
- [x] Local AI requires explicit consent before recipe text is sent.
- [x] Local AI output remains untrusted until schema, evidence, identity, and user-review gates pass.
- [x] Calories come from deterministic arithmetic over source-labelled nutrition records, not model output.
- [x] Partial nutrition is labelled as a known subtotal.
- [x] Public copy states that nutrition is estimated and not medical advice.
- [x] Public copy states that DinnerSync does not detect allergens or guarantee food safety.

## GPT-5.6 evidence

- [x] `npm run test:codex-sandbox` exits zero on the final WSL/Linux verification host.
- [x] A current real GPT-5.6 recipe import exits zero, with no skipped real test.
- [x] Exact model ID recorded: `gpt-5.6-terra`.
- [x] Real run timestamp recorded: `2026-07-19 11:08 Asia/Shanghai`.
- [x] Result records `schemaValidated: true` and `evidenceValidated: true`.
- [x] Published evidence contains no recipe text, prompts, tokens, account data, cookies, or local paths.
- [x] Codex `/feedback` Session ID captured privately from the active Codex session metadata; the identifier is intentionally not committed to the public repository.
- [ ] Session ID is entered in the required Devpost field without publishing session contents.
- [x] Historical smoke checks are not described as a current RecipeDraft business-gate pass.

## Engineering gates

- [x] Clean install: `npm ci`.
- [x] File-length gate: `npm run check:files`.
- [x] Lint: `npm run lint`.
- [x] TypeScript: `npm run typecheck`.
- [x] Unit/integration suite: `npm test`.
- [x] Production build: `npm run build`.
- [x] Playwright: `npm run test:e2e`.
- [x] Hosted public URL tested with the Hosted Playwright scenario or the manual path in `testing.md`.
- [x] Public `/api/local-ai/status` returns 404.
- [x] Public `/api/local-ai/import` returns 404.
- [x] `git diff --check` passes.
- [ ] `git status --short` contains only intentional release changes before commit and is empty after push.

## Responsive and accessibility checks

- [x] Setup, Review, Plan, Cook, and Summary checked at 1440x900.
- [x] Core flow checked at 1024x768.
- [x] Core flow checked at 390x844 with no horizontal overflow.
- [x] Primary mobile controls are at least 44x44 CSS pixels.
- [x] Keyboard focus follows each stage transition and remains visible.
- [x] Status changes are announced without color being the only signal.
- [x] Screenshots contain no usernames, email addresses, tokens, local paths, or unrelated browser tabs.

## Rules and final Devpost state

- [x] Official rules URL recorded: [https://openai.devpost.com/rules](https://openai.devpost.com/rules).
- [x] Rules rechecked at: `2026-07-19 11:24 Asia/Shanghai`.
- [x] Deadline, eligibility, track, repository access, video, and submission fields revalidated against the current rules.
- [x] Final secret scan covers tracked files, documentation, images, video metadata, and commit history.
- [ ] Devpost preview contains no placeholder URL, private host, or stale test claim.
- [ ] Final **Submit** action completed, not just **Save draft**.
- [ ] Devpost displays an explicit submitted status.
- [ ] Submitted project URL recorded from the final Devpost result.
- [ ] Submission timestamp recorded with timezone from the final Devpost result.
- [ ] Reopening **My projects** still shows the project as submitted.
- [ ] Submission proof image contains only the status and project URL, with no account or session data.
