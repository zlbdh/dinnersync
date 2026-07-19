# Devpost copy

Replace link placeholders and update the verified-run language only after the corresponding checklist gates pass.

## Project name

DinnerSync

## Tagline

Plan together. Cook on time.

## Track

Apps for Your Life

## Links

- Hosted Demo: https://ds.zlbdh.site:8443
- Source: https://github.com/zlbdh/dinnersync
- Video: https://youtu.be/m6pEglt6Rxc

## The problem

Three dishes rarely go wrong because a home cook cannot read a recipe. The hard part is the handoff between recipes: one oven, a couple of burners, one pair of hands, and several steps that all need to land near the same dinner time.

Most recipe apps show one recipe at a time. Separate timers help with individual steps, but they do not explain who or what is busy, whether the complete plan is feasible, or how the rest of dinner should move when a task runs late.

DinnerSync treats a home meal as a small scheduling problem with a human in the loop.

## What DinnerSync does

DinnerSync takes up to three recipes through one five-stage flow:

1. **Setup** records the recipes, diner count, available time, target service time, optional kcal comparison, and kitchen resources.
2. **Review** exposes source-backed and inferred recipe fields before they can affect the plan.
3. **Plan** builds one timeline across dishes, dependencies, the cook, oven, and burners.
4. **Cook** records what actually starts, runs late, becomes due, and completes. Each accepted event can trigger a deterministic replan.
5. **Summary** compares the original finish with the actual finish, lists recorded delays and replan passes, shows the energy ledger, and names one timing lesson supported by the run.

One finish line. Three dishes.

The public Hosted Demo is fixed and repeatable. It schedules a 7:00 PM dinner, injects an eight-minute delay into the chicken roast, replans the remaining work, and records service at 7:08 PM. It makes no model request.

## Key features

- Shared timeline for one cook, one oven, and one or two burners.
- Dependency, cycle, resource-conflict, and feasibility checks.
- Five-minute service window around the requested finish.
- Event-based Start, Delay, Due, and Complete controls.
- Running tasks keep their resources when delayed; the rest of the plan moves around facts already in progress.
- Refresh-safe browser persistence with a wall-clock anchor. A refresh can mark work due, but never auto-completes it.
- Per-dish and per-person energy calculation from source-labelled USDA FoodData Central records.
- Known-subtotal behavior when any ingredient cannot be calculated safely.
- Compact mobile timeline, touch-sized controls, keyboard focus management, and announced status changes.
- Optional Local AI import with consent, strict structured output, source-evidence validation, and mandatory user review.

Dinner landed. Here is the record.

## Hosted Demo and Local AI

The two paths are intentionally different.

**Hosted Demo** uses original checked-in recipes and validated fixtures. It is the public judging path and makes no Local AI or external model request.

**Local AI** is a loopback-only development feature. After explicit consent, DinnerSync sends one to three recipes through the user's logged-in Codex CLI and requests `gpt-5.6-terra`. GPT-5.6 may propose recipe names, ingredients, durations, dependencies, resources, and source evidence. Every field remains `needs-review`.

The model cannot provide kcal values, nutrition IDs, or the final schedule. The server checks a strict JSON Schema, Zod schema, evidence spans against the exact submitted text, identity uniqueness, size limits, and exact model metadata. The browser validates the returned draft again before it enters Review.

Local AI also runs a non-model sandbox canary before model startup. If the OS cannot prove the required filesystem boundary, DinnerSync stops without sending the recipe. Production builds disable both Local AI routes.

## How we built it

DinnerSync is a Next.js 16 and React 19 application with deterministic TypeScript domain modules.

- `recipe-import` owns draft schemas, evidence, review state, and the Codex adapter.
- `nutrition` validates a small source-labelled catalog and calculates kcal from confirmed grams and food state.
- `scheduling` validates the task graph, allocates kitchen resources, builds the service timeline, and replans after accepted events.
- `cooking-session` stores timestamped events and derives task status, expected finish, locks, and the current schedule.
- `dinner-planner` connects those domains and restores only snapshots that can be recomputed and validated.
- `demo` contains the original three-recipe fixture and fixed delay playback.

The dependency direction is one way: shared types, recipe review, nutrition/scheduling, cooking session, planner, then UI. React components do not calculate nutrition or implement the scheduling algorithm.

Planner state and UI clock metadata use separate `localStorage` keys with one shared revision. A partial browser write cannot attach stale origin or time metadata to a newer planner snapshot.

## Where GPT-5.6 fits

GPT-5.6 handles the part that benefits from language understanding: turning unstructured recipe text into a proposed, evidence-linked draft.

Deterministic code handles the parts that need repeatability:

- serving and gram scaling;
- nutrition-record matching and kcal arithmetic;
- graph and resource validation;
- schedule construction and replanning;
- cooking state transitions;
- persistence recovery;
- final timing and energy records.

This split lets the Hosted Demo remain useful without a model, while Local AI can reduce manual recipe entry without becoming the source of truth.

## Challenges

### Replanning around work that is already true

A delayed running task cannot be moved backward or stripped of the oven it still occupies. We model running and due work as locked intervals, then schedule unfinished work around those locks. The replay uses the same event dispatcher as manual cooking, so the demo does not bypass the real state machine.

### Making model output reviewable

A schema-valid recipe can still point to the wrong source text. DinnerSync preserves the complete input, requires UTF-16 evidence spans for source-backed values, rejects mismatched evidence, and labels every proposal for human review. Nutrition and schedules are outside the model schema.

### Restoring time after a refresh

Saving a countdown integer would drift when a browser tab was throttled. DinnerSync saves a virtual instant and wall-clock anchor, then derives elapsed time after refresh. Running work can become due, but completion still requires an explicit event.

### Failing closed at the Local AI boundary

Prompt instructions and a nominal read-only mode are not enough to prove file isolation. We added a harmless canary that checks whether the actual Codex sandbox denies an outside file. Native Windows on the verification host fails closed with `SANDBOX_UNAVAILABLE`. In WSL Ubuntu 24.04, the real OS canary passed; only then did a real `gpt-5.6-terra` RecipeDraft import run and pass strict schema and source-evidence validation. The Hosted Demo remains fully available without a model.

## Accomplishments

- The Hosted path reaches an exact, browser-tested record: 7:00 PM planned, 7:08 PM actual, one eight-minute delay, and 25 accepted replan events.
- The browser test records no Local AI, external data, or known model-provider request during that flow.
- The scheduler explains infeasible plans rather than manufacturing an on-time result.
- Partial nutrition never appears as a complete estimate.
- Refresh recovery preserves running and due work without auto-completion.
- The same flow works as a desktop resource timeline and a 390-pixel chronological mobile list.
- The Local AI boundary rejects missing consent, non-loopback use, concurrent imports, unknown models, oversized input/output, invalid evidence, unavailable quota, and unproven sandbox isolation.
- A real `gpt-5.6-terra` Local AI import passed the WSL/Linux sandbox, schema, identity, and source-evidence gates before entering human Review.

## What we learned

The useful AI boundary was smaller than we first expected. Recipe language benefits from GPT-5.6, but scheduling, nutrition arithmetic, and state recovery became easier to test once they stayed outside the model.

We also learned that configuration is not proof of isolation. A capability gate needs to exercise the real OS boundary. That led to the canary probe and a strict rule: no model process starts unless the probe passes.

Finally, a cooking timer is an event record in disguise. Persisting timestamps and facts made delay handling, refresh recovery, and the final summary agree with each other.

## What's next

- Re-run the real RecipeDraft gate on additional supported Linux environments and after relevant Codex or sandbox upgrades.
- Add user-managed nutrition catalogs while preserving source and food-state checks.
- Support more cooks and appliances without hiding resource conflicts.
- Add import/export for a dinner plan without introducing an account or server-side recipe store.
- Test more languages and measurement units at the recipe-review boundary.
- Add optional shared household sessions with explicit privacy controls.

## Known limitations

- The public deployment is Hosted Demo only. Local AI is disabled in production.
- Local AI depends on Codex installation, login, quota, exact model availability, and a passing OS sandbox probe.
- The planner supports up to three recipes, one cook, one oven, and one or two burners.
- The demo nutrition catalog is intentionally small and needs human confirmation.
- DinnerSync does not determine doneness, internal temperature, allergen safety, cross-contamination risk, or medical suitability.
- Browser persistence is local to one device and has no cloud sync.

## Technology

- Next.js 16, React 19, TypeScript 5.9
- Zod 4 strict runtime schemas
- Codex CLI with allowlisted GPT-5.6 model IDs
- Vitest, Testing Library, and jsdom
- Playwright with Chromium
- Tailwind CSS 4/PostCSS plus project CSS
- USDA FoodData Central records for the checked demo nutrition catalog
- npm and Node.js 20/22/24-compatible runtime
