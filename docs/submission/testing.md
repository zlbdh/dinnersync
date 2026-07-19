# Judge testing guide

This guide separates the public, model-free Hosted Demo from the optional Local AI development path.

## Public Hosted Demo: about two minutes

Open [https://ds.zlbdh.site:8443](https://ds.zlbdh.site:8443). No account is required.

1. Select **Try the 650 kcal demo**.
2. On Review, confirm that three recipes are present and that the source, inferred fields, ingredient weights, food states, and nutrition sources are visible.
3. Select **Build the service timeline**.
4. On Plan, inspect the three dish tracks and the shared cook, oven, and burner labels. The requested finish is 7:00 PM.
5. Select **Start cooking**.
6. Select **Run cooking replay at 60 times speed**. The fixed scenario delays **Roast the chicken at 200 C** by eight minutes and replans the remaining work.
7. On Summary, verify:
   - planned service: **7:00 PM**;
   - actual service: **7:08 PM**;
   - variance: **8 min late**;
   - recorded delays: **1**;
   - delay minutes: **8**;
   - replan passes: **25**;
   - the timing note names the delayed chicken roast;
   - the energy ledger shows the complete demo estimate per dish and per person.

What this path proves:

- a complete review, scheduling, cooking, delay, replan, and summary loop;
- deterministic results from checked-in fixtures;
- no `/api/local-ai/*` request;
- no request to a model provider;
- usable desktop and compact mobile timelines.

The Hosted button is not an AI simulation. It is a transparent fixture path for repeatable judging.

## Optional network check

Open browser developer tools before selecting the demo. Filter the Network panel for `local-ai`, `openai`, or `chatgpt`. The Hosted path should produce no matching request.

The public production routes are disabled and should return HTTP 404:

```bash
curl -i https://ds.zlbdh.site:8443/api/local-ai/status
curl -i -X POST https://ds.zlbdh.site:8443/api/local-ai/import
```

## Local AI development path

This path runs on the tester's own machine. It is not available on the public production deployment.

### Prerequisites

- Node.js version accepted by `package.json`
- Codex CLI installed and logged in
- available Codex quota
- a supported OS sandbox that passes DinnerSync's non-model canary probe
- loopback access only

Install the project:

```bash
npm ci
```

Confirm Codex login, then run the isolation gate before any model test:

```bash
codex login status
npm run test:codex-sandbox
```

If the sandbox command exits nonzero, stop. DinnerSync intentionally refuses to send recipe text when it cannot prove the required filesystem boundary.

If it passes, start the loopback-only server:

```bash
npm run dev:local-ai
```

Then:

1. Open `http://127.0.0.1:3000`.
2. Choose **Local AI**.
3. Paste one to three recipes.
4. Read and select the consent checkbox. This is the point at which the user authorizes recipe text to be sent through their logged-in Codex session.
5. Select **Build my service plan**.
6. Verify the import metadata identifies `openai-codex-cli`, `gpt-5.6-terra`, schema validation, and source-evidence validation.
7. Review every proposed field. Model output remains `needs-review`; it is not silently confirmed.
8. Resolve nutrition matches and build the deterministic timeline.

Expected safe failures include missing installation, missing login, unavailable quota, unsupported sandbox, timeout, invalid structured output, evidence mismatch, and unavailable model. The UI should retain the recipe text and explain that the import was not verified.

## Automated verification

Run the complete non-model gate:

```bash
npm run verify
```

This runs the file-length gate, ESLint, TypeScript, Vitest, and the production build.

Install Chromium once, then run the browser suite:

```bash
npx playwright install chromium
npm run test:e2e
```

The current Playwright suite covers the exact Hosted summary, 390x844 layout, touch-target sizing, horizontal overflow, and refresh recovery for running and overdue tasks. Route and Local AI adapter behavior are covered by Vitest with controlled process boundaries.

## Real Codex gates

These commands use the tester's Codex account and may consume quota. Run them only after `npm run test:codex-sandbox` passes.

PowerShell:

```powershell
$env:DINNERSYNC_CODEX_MODEL='gpt-5.6-terra'
npm run smoke:codex
npm run test:codex-real
```

POSIX shell:

```bash
DINNERSYNC_CODEX_MODEL=gpt-5.6-terra npm run smoke:codex
DINNERSYNC_CODEX_MODEL=gpt-5.6-terra npm run test:codex-real
```

`smoke:codex` checks one strict structured-output response. `test:codex-real` checks the RecipeDraft schema, exact model selection, and recipe source evidence. Record a pass only when the command exits zero. A skipped test, historical smoke result, fixture result, or schema-only result does not count as a current real recipe pass.

Release evidence: on 2026-07-19 at 11:08 Asia/Shanghai, WSL Ubuntu 24.04 with Node.js 22.22 and Codex CLI 0.144.4 first passed `test:codex-sandbox`, then completed a real `gpt-5.6-terra` RecipeDraft import. The returned metadata identified `openai-codex-cli` and `gpt-5.6-terra`; strict schema and source-evidence checks passed before Review opened. Native Windows on the same host still fails closed at the sandbox canary and was not bypassed.

## Nutrition spot check

For any included ingredient, DinnerSync calculates:

```text
planned grams / 100 * catalog kcal per 100 g
```

Open **Open nutrition source** during Review to inspect the stored USDA FoodData Central URL and release label. If any used ingredient lacks a confirmed match, reliable scaled grams, or a matching food state, the meal must show a known subtotal rather than a complete estimate.

Do not interpret the result as medical, weight-loss, allergen, doneness, or food-safety advice.
