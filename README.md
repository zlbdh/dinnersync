# DinnerSync

**Plan together. Cook on time.**

DinnerSync turns several recipes into one shared finish line. It reviews recipe details, estimates meal energy from traceable nutrition records, schedules work around a small home kitchen, and replans when cooking runs late.

Built for OpenAI Build Week in the **Apps for Your Life** track.

## Links

| Resource | URL |
| --- | --- |
| Hosted demo | [https://ds.zlbdh.site:8443](https://ds.zlbdh.site:8443) |
| Public repository | [https://github.com/zlbdh/dinnersync](https://github.com/zlbdh/dinnersync) |
| Demo video | [https://youtu.be/m6pEglt6Rxc](https://youtu.be/m6pEglt6Rxc) |

The public site is the Hosted Demo. It does not enable Local AI or make model requests.

## The problem

Cooking three dishes is usually a coordination problem, not a recipe-reading problem. A home cook has one pair of hands, one oven, a few burners, and several steps that all need to finish together. Static recipe timers do not account for shared equipment or recover cleanly when one task slips.

DinnerSync treats the meal as a small scheduling system. Dependencies, active work, oven use, burner use, target service time, and actual cooking events all feed the same deterministic planner.

## What the demo shows

- Reviewable recipe fields with source evidence and explicit inferred values.
- A three-dish timeline for one cook, one oven, and two burners.
- A five-minute service window around the requested dinner time.
- Start, delay, due, and complete events with resource locks.
- Deterministic replanning after a running task is delayed.
- A final record comparing planned and actual service, plus one timing lesson from the recorded critical path.
- Per-dish and per-person energy estimates when every ingredient is resolved.
- Refresh recovery without silently completing a running or overdue task.
- A compact mobile timeline and keyboard-visible focus states.

The fixed Hosted replay plans service for 7:00 PM, injects an eight-minute delay into the chicken roast, and records actual service at 7:08 PM.

## Hosted Demo and Local AI

DinnerSync has two deliberately separate paths.

| | Hosted Demo | Local AI |
| --- | --- | --- |
| Purpose | Public, repeatable judging path | Optional recipe-text import on the user's machine |
| Recipe input | Checked-in demo fixtures | One to three recipes supplied by the user |
| Model request | None | GPT-5.6 Terra through the user's logged-in Codex CLI |
| Consent | Not needed because no recipe is sent | Required before recipe text leaves the browser |
| Availability | Public deployment and local development | Loopback development only; disabled in production |
| Output trust | Validated fixtures still enter the review flow | Strict JSON Schema, Zod, source-evidence checks, then human review |

Local AI proposes recipe fields. It never supplies calories, nutrition record IDs, or a schedule. Those remain deterministic application responsibilities.

## Try the Hosted Demo

1. Open the [Hosted demo](https://ds.zlbdh.site:8443).
2. Select **Try the 650 kcal demo**.
3. Review the three recipes, then select **Build the service timeline**.
4. Inspect the shared cook, oven, and burner plan.
5. Select **Start cooking**.
6. Run the 60x replay.
7. Check the final record: 7:00 PM planned, 7:08 PM actual, one recorded delay, and 25 accepted replan events.

See [docs/submission/testing.md](docs/submission/testing.md) for the full judge path and local verification commands.

## Run locally

### Requirements

- Node.js `^20.19.0`, `^22.13.0`, or `>=24.0.0`
- npm 10 (the repository records `npm@10.9.3`)

Install and start the model-free application:

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. The default environment keeps Local AI disabled.

### Optional Local AI

Local AI additionally requires:

- Codex CLI installed and logged in with the user's own account
- Available Codex quota
- A platform where the DinnerSync sandbox capability probe proves filesystem isolation
- Loopback access through `localhost`, `127.0.0.1`, or `::1`

The implementation was exercised with Codex CLI 0.144.4. Before spending model quota, run the non-model sandbox probe:

```bash
npm run test:codex-sandbox
```

Only continue if that command exits successfully. Then start the loopback-only development server:

```bash
npm run dev:local-ai
```

In the UI, choose **Local AI**, paste one to three recipes, read and accept the consent text, then submit. The browser first checks installation, login, and sandbox status. A successful import identifies `openai-codex-cli`, `gpt-5.6-terra`, schema validation, and source-evidence validation before opening the review screen.

The release gate was exercised on 2026-07-19 in WSL Ubuntu 24.04 with Node.js 22.22 and Codex CLI 0.144.4. The OS canary passed before a real `gpt-5.6-terra` RecipeDraft import passed its strict schema and source-evidence checks. Native Windows on the same host still fails closed at the sandbox probe; see [docs/verification/local-ai.md](docs/verification/local-ai.md).

Local AI fails closed when isolation, login, quota, model availability, schema validation, source evidence, output limits, timeout handling, or cleanup cannot be verified. Production builds return 404 for both Local AI routes even if an environment variable is set.

## Calories and nutrition records

DinnerSync does not ask a model to invent nutrition values. The calculation is:

```text
ingredient kcal = planned grams / 100 * source kcal per 100 g
```

An ingredient is included only when all of these are true:

- source and target servings produce a reliable scaled weight;
- the user-confirmed nutrition match points to a catalog record;
- the ingredient food state matches the record food state;
- planned grams are known.

If any included ingredient is unresolved, DinnerSync shows a **known subtotal** and withholds the complete meal estimate. The optional kcal target is a comparison supplied by the user. DinnerSync reports the per-person difference; it does not prescribe a diet or automatically rewrite portions to reach the target.

The Hosted Demo uses a small, checked-in set of USDA FoodData Central records. Each record stores a direct source URL, dataset/release label, and access date. See [src/modules/demo/scenario.ts](src/modules/demo/scenario.ts).

These values are estimates. DinnerSync is not medical, weight-loss, allergy, food-safety, or disease-management advice. Diet and allergy notes are notes only. The app does not detect allergens or guarantee that food is safe to eat.

## Architecture

```text
Hosted fixtures ───────────────┐
                              v
Local recipe text -> Codex -> Review -> Nutrition + Scheduling -> Cooking session -> Summary
                         strict draft       deterministic          event record
```

The code is split into domain modules with public `index.ts` boundaries:

- `recipe-import`: strict draft schemas, source evidence, review state, and the optional Codex adapter.
- `nutrition`: catalog validation, food-state matching, serving-scale checks, and kcal arithmetic.
- `scheduling`: dependency validation, kitchen resource intervals, feasibility checks, and replanning.
- `cooking-session`: timestamped events, derived task status, resource locks, and replayable snapshots.
- `dinner-planner`: cross-domain orchestration and validated persistence.
- `demo`: original recipes, checked drafts, nutrition records, and the fixed delay scenario.
- `components`: the five-step Setup, Review, Plan, Cook, and Summary interface.

The model boundary ends at a proposed recipe draft. Deterministic TypeScript code performs nutrition math, schedule construction, event transitions, persistence validation, and the final record.

## Privacy and security boundaries

- Hosted Demo uses local fixtures and makes no Local AI or external model request.
- Local AI sends recipe text only after explicit consent. It uses the user's logged-in Codex session and quota; DinnerSync does not embed an API key.
- The Local AI server accepts exact same-origin loopback requests, one import at a time, with bounded request and response sizes.
- Codex receives the prompt through stdin in an ephemeral temporary directory. User configuration and repository rules are ignored; model-accessible tools and sandbox network access are disabled, while the Codex service remains the consented recipient of recipe text. Temporary files are removed afterward.
- A harmless canary probe must prove that the active OS sandbox denies access outside the temporary workspace. Failure stops before the model starts.
- Model output is treated as untrusted on both the server and browser. Strict schemas, source spans, unique identities, and batch boundaries are checked twice.
- Planner snapshots stay in browser `localStorage`. A shared revision binds planner state to its UI clock and origin metadata, so partial writes are not restored as a valid pair.
- DinnerSync adds no server-side recipe database. The Codex/OpenAI service is still a separate data recipient when the user enables Local AI.

## Test and verification commands

```bash
npm run check:files
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Run the complete non-model gate with:

```bash
npm run verify
```

Install Chromium once before the Playwright suite if needed:

```bash
npx playwright install chromium
```

The following commands use a real Codex installation and may consume quota. The sandbox probe must pass first.

```powershell
$env:DINNERSYNC_CODEX_MODEL='gpt-5.6-terra'
npm run smoke:codex
npm run test:codex-real
npm run test:codex-real:full
```

`smoke:codex` checks strict structured output only. `test:codex-real` is the recipe-draft business gate for one explicitly selected model. `test:codex-real:full` runs that gate for Terra and Sol. A smoke pass is not a substitute for the recipe, evidence, and sandbox checks.

## Known limitations

- The public build contains only the Hosted Demo; Local AI is intentionally development-only.
- Local AI availability depends on Codex installation, login, quota, exact model availability, and an OS sandbox that passes the canary probe.
- The recorded native-Windows environment returns `SANDBOX_UNAVAILABLE`; the verified Local AI path uses WSL/Linux on the same host. DinnerSync never bypasses a failed OS canary.
- The current planner models one cook, one oven, one or two burners, and at most three recipes.
- Nutrition matching uses a deliberately small demo catalog and requires human confirmation.
- Persistence is local to one browser. There is no account, cloud sync, or collaborative editing.
- The scheduler coordinates declared recipe steps. It does not determine doneness, safe internal temperature, cross-contamination risk, or allergen safety.
- The fixed replay is a transparent test scenario, not a simulation of every kitchen.

## License

DinnerSync is available under the [MIT License](LICENSE).
