# DinnerSync Visual Acceptance Checklist

Acceptance date: July 19, 2026

## Capture environment

- Next.js production build with `next start`, not development-mode pages.
- Chromium, `en-US` locale, UTC time zone, light theme, and reduced motion.
- Hosted fixture with a fixed browser wall clock; no Local AI calls.
- Screenshots contain only the application viewport, with no browser toolbar, desktop, or terminal.

Reproduction command:

```powershell
npm.cmd run build
node scripts/capture-submission.mjs
```

The script uses dedicated port `3211` and terminates its exact process tree on success or failure. Override the port with
`DINNERSYNC_CAPTURE_PORT`.

## Automated acceptance results

| Stage / viewport | Horizontal overflow | Duplicate IDs | Stage focus | Key touch target | Timeline mode |
|---|---:|---:|---|---|---|
| Setup · 1440×900 | 0 px | 0 | Setup heading | Try demo ≥44×44 | — |
| Review · 1440×900 | 0 px | 0 | Review heading | Build timeline ≥44×44 | — |
| Plan · 1440×900 | 0 px | 0 | Plan heading | Start cooking ≥44×44 | tracks=`grid`, compact=`none` |
| Plan · 1024×768 | 0 px | 0 | Plan heading retained | Start cooking ≥44×44 | tracks=`grid`, compact=`none` |
| Replanned Cook · 1440×900 | 0 px | 0 | Cook heading | Replay ≥44×44 | Visible `Replanned` marker |
| Summary · 1440×900 | 0 px | 0 | Summary heading | Start another dinner ≥44×44 | — |
| Plan · 390×844 | 0 px | 0 | Plan heading | Start cooking ≥44×44 | tracks=`none`, compact=`grid` |

Additional gates:

- Zero desktop/mobile console warnings, console errors, and `pageerror` events.
- Zero `/api/local-ai/*`, external XHR/fetch, or known model-domain requests during Hosted capture.
- Before the Cook screenshot, the snapshot contained `TASK_DELAYED` with `delayMinutes: 8`, and a replan marker was visible.
- Summary focus landed on the completion heading. The page showed planned 7:00 PM, actual 7:08 PM, eight minutes late, and 25 replans.

## Submission screenshots

| View | File | Dimensions | Visual result |
|---|---|---:|---|
| Setup | [setup-1440x900.png](../submission/assets/setup-1440x900.png) | 1440×900 | Clear CTA, Hosted status, and service preview |
| Review | [review-1440x900.png](../submission/assets/review-1440x900.png) | 1440×900 | Clear reviewed fixture, first recipe, and decision ledger |
| Plan timeline | [plan-timeline-1440x900.png](../submission/assets/plan-timeline-1440x900.png) | 1440×900 | Clear parallel three-dish timeline and nutrition cards |
| Plan tablet | [plan-timeline-1024x768.png](../submission/assets/plan-timeline-1024x768.png) | 1024×768 | No page overflow; tracks scroll within the component |
| Cook delay replan | [cook-replanned-1440x900.png](../submission/assets/cook-replanned-1440x900.png) | 1440×900 | Clear Replay running status, current/next actions, and Replanned marker |
| Summary | [summary-1440x900.png](../submission/assets/summary-1440x900.png) | 1440×900 | Clear 7:00 / 7:08 times, eight minutes, one delay, and 25 replans |
| Mobile plan | [mobile-plan-390x844.png](../submission/assets/mobile-plan-390x844.png) | 390×844 | Compact chronological timeline active with no horizontal overflow |

## Privacy and submission safety

Each screenshot was visually checked to confirm it contained no:

- Usernames, email addresses, or account avatars.
- Tokens, keys, server credentials, or request headers.
- Local absolute paths, terminal content, or browser address bars.
- Local AI input or personal recipes.

Screenshots use only built-in Hosted demo data and display `Hosted · no model`.

## Conclusion and nonblocking observations

- No P0/P1 visual or interaction issues were found.
- At 1024px, timeline tracks scroll internally as designed; document-level horizontal overflow remains zero.
- Underlying scheduling warnings in the delayed Cook state are now consistently English, verified by reducer behavior tests and a newly recorded Hosted clip.
