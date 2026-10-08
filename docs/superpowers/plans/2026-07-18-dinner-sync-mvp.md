# DinnerSync MVP Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver DinnerSync before the competition deadline: a public demo plus local real GPT-5.6 integration that schedules three dishes for the same dinner time and replans after delays.

**Architecture:** Next.js App Router hosts the single-page wizard and locally enabled parsing routes. Recipe review, nutrition, scheduling, and sessions are framework-independent TypeScript modules; UI calls only their public `index.ts` interfaces. Hosted Demo uses validated fixtures; Local AI calls the signed-in Codex CLI through a restricted subprocess. Models propose candidate fields; all calculations and state transitions remain deterministic.

**Tech Stack:** Node.js 22、Next.js 16、React 19、TypeScript、Zod 4、Tailwind CSS 4、Vitest + Testing Library、Playwright、Codex CLI 0.144+、npm。

**Review Status:** Chunks 1, 2, and 3 have passed independent plan review.

---

## Execution constraints

- Follow `@test-driven-development`: write failing tests for domain behavior before the minimal implementation.
- Run each task's verification and commit it separately instead of combining multiple tasks into a large commit.
- Follow `@modular-architecture`: target at most 300 lines per code file; expose module interfaces only through `index.ts`.
- Frontend work follows `@frontend-design`, using a warm kitchen operations table direction rather than generic SaaS cards.
- Local AI is P0. If the real GPT-5.6 technical gate fails, stop feature expansion and fix it; Hosted Demo cannot substitute for completion.
- Prohibit medical, weight-loss, food-safety, and allergen guarantees. Incomplete nutrition data permits only a known-calorie subtotal.
- Completion requires a public repository, English README, public video with audio under three minutes, and Devpost form.

## Scope and chunks

These modules are not independently shippable products: reviewed data feeds both nutrition and scheduling, and scheduling precedes cooking sessions and demo UI. Keep one vertical MVP plan with three independently reviewable, progressively runnable chunks:

1. Project foundation and deterministic domain core.
2. Application experience, Hosted Demo, and Local AI.
3. End-to-end acceptance, documentation, demo, and submission.

## File responsibilities

| Path | Single responsibility |
|---|---|
| `package.json`, `next.config.ts`, `vitest.config.mts`, `playwright.config.ts` | Commands, framework, and test configuration |
| `scripts/check-file-lengths.mjs`, `scripts/codex-smoke.mjs` | File-size and real-model gates |
| `src/app/` | App Router, styles, metadata, and Local AI routes |
| `src/components/` | Five-step wizard, timeline, and small UI primitives |
| `src/shared/` | Result, ISO time, and fixed kitchen resources |
| `src/modules/recipe-import/` | Draft schemas, evidence, review, conversion, and Codex adapter |
| `src/modules/nutrition/` | Sourced catalog, candidate matching, units/servings, and kcal |
| `src/modules/scheduling/` | Graph validation, resource intervals, backward/forward scheduling, and replanning |
| `src/modules/cooking-session/` | Events, clock-derived state, state machine, and persistence |
| `src/modules/dinner-planner/` | Cross-domain orchestration and complete workflow snapshots |
| `src/modules/demo/` | Three original recipes, validated Drafts, and eight-minute-delay replay |
| `tests/e2e/` | Hosted, Local AI, refresh, and mobile acceptance |
| `docs/submission/`, `README.md`, `LICENSE` | English judging materials, demo, and license |

## Chunk 1: Project foundation and deterministic domain core

### Chunk 1 public-interface ownership

Lock these contracts before implementation. Each domain exports only through its own `index.ts`; external imports of internal files are prohibited. `src/shared/` owns only domain-neutral result, time, and resource types. Recipe/Schedule/Session types remain with their domains.

```ts
// src/shared/{result,time,kitchen}.ts
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
export type IsoInstant = string; // Runtime schema requires Z or ±HH:mm.
export type ResourceId = "cook:1" | "oven:1" | "burner:1" | "burner:2";
export type ResourceRequirement = { resourceId: ResourceId };
export type KitchenResources = { cooks: 1; ovens: 1; burners: 1 | 2 };
```

```ts
// src/modules/recipe-import/types.ts
export type EvidenceSpan = { start: number; end: number; text: string };
export type ReviewValue<T> = {
  value: T; provenance: "source" | "inferred"; evidence: EvidenceSpan | null;
  inferenceReason: string | null; confidence: number; status: "needs-review" | "confirmed";
};
export type FoodState = "raw" | "cooked" | "other";
export type IngredientDraft = {
  id: string; sourceText: string; // Must exactly match the owning RecipeDraft.sourceText.
  name: ReviewValue<string>; quantity: ReviewValue<number | null>;
  unit: ReviewValue<string | null>; foodState: ReviewValue<FoodState | null>;
};
export type CookingStepDraft = {
  id: string; sourceText: string; instruction: ReviewValue<string>;
  durationMinutes: ReviewValue<number>; mode: ReviewValue<"active" | "passive">;
  dependsOn: ReviewValue<string[]>; resources: ReviewValue<ResourceRequirement[]>;
  ovenOperation: ReviewValue<"preheat" | "cook" | "temperature-change" | null>;
  ovenTemperatureC: ReviewValue<number | null>; isTerminal: ReviewValue<boolean>;
};
export type RecipeDraft = {
  id: string; sourceText: string; name: ReviewValue<string>;
  sourceServings: ReviewValue<number | null>; ingredients: IngredientDraft[]; steps: CookingStepDraft[];
};
export type Ingredient = {
  id: string; sourceText: string; name: string; quantity: number | null; unit: string | null;
  foodState: FoodState | null; sourceGrams: number | null; plannedGrams: number | null;
  nutritionRefId: string | null; nutritionMatchStatus: "confirmed" | "unresolved";
  status: "used" | "omitted";
};
export type CookingStep = {
  id: string; recipeId: string; sourceText: string; instruction: string; durationMinutes: number;
  mode: "active" | "passive"; dependsOn: string[]; resources: ResourceRequirement[];
  ovenOperation: "preheat" | "cook" | "temperature-change" | null;
  ovenTemperatureC: number | null; isTerminal: boolean;
};
export type Recipe = {
  id: string; name: string; sourceText: string; sourceServings: number | null;
  targetServings: number; ingredients: Ingredient[]; steps: CookingStep[];
};
```

```ts
// src/modules/nutrition/types.ts
export type NutritionRecord = {
  id: string; canonicalName: string; foodState: FoodState; kcalPer100g: number;
  sourceUrl: string; sourceVersion: string; accessedAt: string;
};
export type NutritionSummary = {
  completeness: "complete" | "partial"; knownMealKcal: number; knownKcalPerPerson: number;
  estimatedMealKcal: number | null; estimatedKcalPerPerson: number | null;
  targetDeltaPerPerson: number | null;
  unresolvedIngredientIds: string[];
};
```

```ts
// src/modules/scheduling/types.ts
export type ScheduleTask = CookingStep & { recipeId: string };
export type ScheduleRequest = {
  tasks: ScheduleTask[]; kitchen: KitchenResources; availableFrom: IsoInstant;
  serveAt: IsoInstant; serveToleranceMinutes: 5;
};
export type ScheduledTask = {
  taskId: string; plannedStart: IsoInstant; plannedEnd: IsoInstant; effectiveResources: ResourceId[];
};
export type ScheduleIssueCode =
  | "INVALID_DURATION" | "MISSING_DEPENDENCY" | "DEPENDENCY_CYCLE"
  | "INVALID_TERMINAL" | "INVALID_RESOURCE" | "OVEN_TRANSITION_REQUIRED"
  | "RESOURCE_UNAVAILABLE" | "RESOURCE_CONFLICT" | "WINDOW_INFEASIBLE";
export type Schedule = { feasible: true; tasks: ScheduledTask[]; serveAt: IsoInstant };
export type InfeasibleSchedule = {
  feasible: false; issues: Array<{ code: ScheduleIssueCode; taskIds: string[] }>;
  earliestFeasible: { tasks: ScheduledTask[]; serveAt: IsoInstant } | null;
};
export type ScheduleResult = Schedule | InfeasibleSchedule;
export type ReplanRequest = {
  request: ScheduleRequest; previous: Schedule; now: IsoInstant; completedTaskIds: string[];
  activeTasks: Array<{ taskId: string; status: "running" | "due"; actualStart: IsoInstant;
    expectedEnd: IsoInstant; lockUntil: IsoInstant | null; effectiveResources: ResourceId[] }>;
};
```

```ts
// src/modules/cooking-session/types.ts
export type TaskStatus = "scheduled" | "ready" | "running" | "due" | "completed";
export type TaskRuntimeState = {
  taskId: string; status: TaskStatus; plannedStart: IsoInstant; plannedEnd: IsoInstant;
  actualStart: IsoInstant | null;
  actualEnd: IsoInstant | null; expectedEnd: IsoInstant | null;
};
export type SessionEvent =
  | { sequence: number; type: "TASK_STARTED"; taskId: string; at: IsoInstant }
  | { sequence: number; type: "TASK_DELAYED"; taskId: string; at: IsoInstant; delayMinutes: number }
  | { sequence: number; type: "TASK_DUE"; taskId: string; at: IsoInstant }
  | { sequence: number; type: "TASK_COMPLETED"; taskId: string; at: IsoInstant };
export type CookingSessionState = {
  request: ScheduleRequest; schedule: Schedule; runtime: Record<string, TaskRuntimeState>;
  events: SessionEvent[]; warning: string | null;
};
```

Cross-module calls follow `shared <- recipe-import <- nutrition/scheduling <- cooking-session <- dinner-planner <- UI`. Scheduling never reads nutrition, and nutrition never reads scheduling. Dinner-planner combines them to avoid cycles.

### Task 1: Establish a verifiable Next.js project

**Files:**
- Create: `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`, `vitest.config.mts`
- Create: `src/test/setup.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/page.test.tsx`, `src/app/globals.css`
- Create: `scripts/check-file-lengths.mjs`
- Modify: `.gitignore`

- [ ] **Step 1: Write minimal package and configuration files**

  Pin dependencies `next@16.2.10`, `react@19.2.7`, `react-dom@19.2.7`, `zod@4.4.3`, `lucide-react`, `@fontsource/fraunces`, and `@fontsource/manrope`. Explicitly list devDependencies `typescript`, `@types/node`, `@types/react`, `@types/react-dom`, `eslint`, `eslint-config-next`, `vitest`, `vite`, `@vitejs/plugin-react`, `vite-tsconfig-paths`, `jsdom`, `@testing-library/react`, `@testing-library/dom`, `@testing-library/jest-dom`, `@testing-library/user-event`, `@playwright/test`, `tailwindcss`, `@tailwindcss/postcss`, and `cross-env`. Scripts must be `dev: next dev`, `dev:local-ai: cross-env DINNERSYNC_LOCAL_AI=enabled next dev -H 127.0.0.1`, `build: next build`, `start: next start`, `lint: eslint .`, `typecheck: tsc --noEmit`, `test: vitest run`, `test:watch: vitest`, `test:e2e: playwright test`, `check:files: node scripts/check-file-lengths.mjs`, and `verify: npm run check:files && npm run lint && npm run typecheck && npm test && npm run build`. `vitest.config.mts` uses jsdom, the React plugin, tsconfig paths, and `src/test/setup.ts`; setup imports `@testing-library/jest-dom/vitest`.

- [ ] **Step 2: Install dependencies and generate the lockfile**

  Run: `npm install`

  Expected: `package-lock.json` exists, no high-severity audit errors, and Node meets Next.js `>=20.9`.

- [ ] **Step 3: Write a failing project smoke test**

  Create `src/app/page.test.tsx`, asserting a level-one heading named `DinnerSync`. The current empty page should fail.

  Run: `npm test -- src/app/page.test.tsx`

  Expected: FAIL because the heading is absent.

- [ ] **Step 4: Implement minimal layout and page**

  `layout.tsx` sets English `lang`, product metadata, and local npm font imports. `page.tsx` renders only `<main><h1>DinnerSync</h1></main>`, preserving a stable boundary for the later top-level component.

- [ ] **Step 5: Add the file-length guard**

  `scripts/check-file-lengths.mjs` recursively checks `.ts/.tsx/.js/.mjs` under `src/`, `scripts/`, and `tests/`, failing above 300 lines. Generated files and fixtures may use explicit allowlist exemptions; whole-directory wildcard exemptions are prohibited.

- [ ] **Step 6: Run baseline verification**

  Run: `npm run check:files && npm run lint && npm run typecheck && npm test -- --run`

  Expected: All commands PASS, with at least one passing test.

- [ ] **Step 7: Commit the project foundation**

  ```bash
  git add package.json package-lock.json tsconfig.json next.config.ts eslint.config.mjs postcss.config.mjs vitest.config.mts .gitignore scripts src/app src/test
  git commit -m "chore(app): initialize DinnerSync project"
  ```

### Task 2: Verify Codex CLI capabilities and implement a safe runner

**Files:**
- Create: `scripts/codex-smoke.mjs`, `docs/verification/codex-capabilities.md`
- Create: `src/modules/recipe-import/codex-runner.ts`, `src/modules/recipe-import/__tests__/codex-runner.test.ts`, `src/modules/recipe-import/index.ts`
- Modify: `package.json`

- [ ] **Step 1: Perform and record read-only capability discovery**

  Run: `codex --version; codex login status; codex exec --help`

  Expected: Record CLI version, login state, and actual support for required flags. Test candidate GPT-5.6 models with a minimal strict schema and record only successful exact IDs in `codex-capabilities.md`. Preflight on July 18, 2026 successfully launched `gpt-5.6-sol` and `gpt-5.6-terra`; reverify with the current CLI during implementation.

- [ ] **Step 2: Write failing subprocess-argument tests**

  Inject fake `spawn`; assert that the explicitly selected verified model is passed unchanged to `codex exec` with required read-only/temporary/schema flags. Also assert `shell:false`, `cwd:tempDir`, prompt-only stdin, output limits, cancellation, and timeout termination so the subprocess cannot see the project directory.

  Run: `npm test -- src/modules/recipe-import/__tests__/codex-runner.test.ts`

  Expected: FAIL because the runner does not exist.

- [ ] **Step 3: Implement a minimal CodexRunner**

  Use `spawn` (`codex.cmd` on Windows). The parent writes the schema in tempDir; the Codex CLI host writes a temporary result through `--output-last-message`. Host output is separate from model tool file writes; the model remains in the read-only sandbox. Read and validate bounded output, clean up in finally, use a default 60-second timeout, and never construct shell commands.

- [ ] **Step 4: Run unit tests**

  Run: `npm test -- src/modules/recipe-import/__tests__/codex-runner.test.ts`

  Expected: PASS for success, nonzero exit, timeout, and missing-output branches.

- [ ] **Step 5: Write and run a structured CLI smoke test**

  `scripts/codex-smoke.mjs` uses an `{ok:true}` schema with `additionalProperties:false` to verify login, model selection, structured output, and runner arguments without printing authentication data.

  Run: `npm run smoke:codex`

  Expected: `PASS: <verified GPT-5.6 model> structured output`. This is only the CLI capability gate; the RecipeDraft/EvidenceSpan P0 gate follows Task 4 schema completion. Model changes must be explicit and accurately displayed, with no silent fallback.

- [ ] **Step 6: Commit capability verification and runner**

  ```bash
  git add package.json scripts/codex-smoke.mjs docs/verification/codex-capabilities.md src/modules/recipe-import
  git commit -m "feat(ai): verify Codex capabilities and add safe execution"
  ```

### Task 3: Establish shared time and kitchen-resource contracts

**Files:**
- Create: `src/shared/result.ts`, `src/shared/time.ts`, `src/shared/kitchen.ts`, `src/shared/index.ts`
- Create: `src/shared/__tests__/time.test.ts`, `src/shared/__tests__/kitchen.test.ts`

- [ ] **Step 1: Write failing offset-aware time tests**

  Reject time strings without zones; compare different offsets for the same instant; add minutes across hours/dates; normalize output to ISO `Z`. Use epoch milliseconds internally without a date library.

- [ ] **Step 2: Write failing kitchen-resource tests**

  Fix resources as `cook:1/oven:1/burner:1/burner:2`: one cook and one oven each have capacity one; burners have capacity two. Effective locks for active tasks must deterministically include `cook:1` without trusting model output.

- [ ] **Step 3: Implement and export shared pure functions**

  Keep `Result<T,E>`, `parseIsoInstant/toEpochMs/fromEpochMs/addMinutes`, and `effectiveResources` focused. Domain modules must not duplicate time parsing or active-task resource rules.

- [ ] **Step 4: Verify and commit**

  Run: `npm test -- src/shared && npm run typecheck`

  Expected: PASS。

  ```bash
  git add src/shared
  git commit -m "feat(shared): add time and kitchen-resource contracts"
  ```

### Task 4: Implement field-level review and evidence contracts

**Files:**
- Create: `src/modules/recipe-import/types.ts`, `src/modules/recipe-import/schemas.ts`, `src/modules/recipe-import/evidence.ts`, `src/modules/recipe-import/review-reducer.ts`, `src/modules/recipe-import/convert.ts`
- Create: `src/modules/recipe-import/__tests__/schemas.test.ts`, `src/modules/recipe-import/__tests__/evidence.test.ts`, `src/modules/recipe-import/__tests__/review-reducer.test.ts`, `src/modules/recipe-import/__tests__/convert.test.ts`
- Create: `tests/integration/codex-recipe-real.test.ts`, `docs/verification/local-ai.md`
- Modify: `src/modules/recipe-import/index.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing ReviewValue and evidence tests**

  Require exact-match spans for `source`, no span and a reason for `inferred`, confidence within `[0,1]`, UTF-16 half-open offsets around emoji, and initial model status `needs-review`. All EvidenceSpans are relative to root `RecipeDraft.sourceText`; IngredientDraft/CookingStepDraft sourceText must exactly match the root. Reject excerpts or wrong parent sources.

  Run: `npm test -- src/modules/recipe-import/__tests__/schemas.test.ts src/modules/recipe-import/__tests__/evidence.test.ts`

  Expected: FAIL because types and validators are undefined.

- [ ] **Step 2: Implement types, Zod schemas, and evidence validation**

  `ReviewValue<T>` includes `value/provenance/evidence/inferenceReason/confidence/status`. `sourceServings` is nullable; IngredientDraft reviews `foodState`; CookingStepDraft separately reviews `ovenOperation` and `ovenTemperatureC`. `validateEvidence(recipeSourceText,value)` always uses the root source and returns structured issues. The AI schema prohibits `nutritionRefId` and kcal fields.

- [ ] **Step 3: Write failing conversion-gate tests**

  First cover review transitions: edited fields become confirmed inferred values with evidence cleared; nutrition candidates write `nutritionRefId` only after user confirmation; unknown food state remains unresolved. Changing target servings or used/omitted clears derived results and resets steps. Conversion requires every ReviewValue for name, source servings (including explicitly confirmed null), ingredient name/amount/unit/food state, and step description/duration/mode/dependencies/resources/oven fields/terminal to be confirmed. No unconfirmed model value enters Recipe.

- [ ] **Step 4: Implement the Draft → Recipe converter**

  Remove AI metadata while retaining `sourceText` and nullable source servings. Return `Result<Recipe, ReviewIssue[]>`; do not throw exceptions for user-correctable issues.

- [ ] **Step 5: Run module tests and typecheck**

  Run: `npm test -- src/modules/recipe-import && npm run typecheck`

  Expected: PASS for all evidence, schema, and conversion tests.

- [ ] **Step 6: Execute the real RecipeDraft/EvidenceSpan P0 gate**

  `test:codex-real` sends one short original project recipe through the Task 2 runner. Assert exit code 0, the exact GPT-5.6 model, strict RecipeDraft schema, all initial needs-review values, reproducible root-text UTF-16 evidence, reasons for inferred fields, and no nutrition values. Run: `$env:RUN_REAL_CODEX='1'; $env:DINNERSYNC_CODEX_MODEL='<verified-id>'; npm run test:codex-real`. Expected: PASS. Any failure exits nonzero and stops Task 5 onward; skipping must not be reported as passing.

- [ ] **Step 7: Commit review contracts and the real gate**

  ```bash
  git add package.json src/modules/recipe-import tests/integration/codex-recipe-real.test.ts docs/verification/local-ai.md
  git commit -m "feat(recipe): implement field review and evidence gates"
  ```

### Task 5: Implement traceable nutrition calculations

**Files:**
- Create: `src/modules/nutrition/types.ts`
- Create: `src/modules/nutrition/catalog.ts`
- Create: `src/modules/nutrition/scale.ts`
- Create: `src/modules/nutrition/match.ts`
- Create: `src/modules/nutrition/calculate.ts`
- Create: `src/modules/nutrition/index.ts`
- Create: `src/modules/nutrition/__tests__/scale.test.ts`
- Create: `src/modules/nutrition/__tests__/match.test.ts`
- Create: `src/modules/nutrition/__tests__/calculate.test.ts`

- [ ] **Step 1: Write failing serving-scaling tests**

  Cover serving formulas, kg/g, L/ml, demo measuring cups, and unconvertible units. Null, zero, or negative `sourceServings` forces all used ingredients' plannedGrams to null; nutrition entry points must also reject externally supplied or stale nonnull plannedGrams.

  Run: `npm test -- src/modules/nutrition/__tests__/scale.test.ts`

  Expected: FAIL because the scaling function is undefined.

- [ ] **Step 2: Implement a pure scaling function**

  Return the `ResolvedWeight | UnresolvedWeight` discriminated union. Do not guess weights for “one,” “a little,” or branded packages; preserve original inputs and conversion sources. `findNutritionCandidates` proposes candidates only through exact canonical names, exact aliases, normalized matching, and stable ID ordering; it never writes `nutritionRefId` automatically.

- [ ] **Step 3: Write failing calorie-gate tests**

  Cover dish/meal/per-person kcal with fully resolved inputs, stable rounding, `completeness: "partial"` for any unresolved used ingredient, known subtotal only with `targetDelta: null`, and exclusion of omitted ingredients.

- [ ] **Step 4: Implement the catalog and calculateNutrition**

  Each record contains a stable ID, canonical name, state, kcal per 100g, source/version/date. First require positive Recipe.sourceServings, otherwise treat the whole dish's plannedGrams as null. Consume only used ingredients with reliable weights, matching foodState, confirmed matches, and user-confirmed references; anything missing remains unresolved.

- [ ] **Step 5: Run nutrition tests**

  Run: `npm test -- src/modules/nutrition && npm run typecheck`

  Expected: PASS with clear complete-versus-partial summary semantics.

- [ ] **Step 6: Commit the nutrition module**

  ```bash
  git add src/modules/nutrition
  git commit -m "feat(nutrition): add deterministic calories and completeness gates"
  ```

### Task 6: Implement task-graph and kitchen-resource validation

**Files:**
- Create: `src/modules/scheduling/types.ts`
- Create: `src/modules/scheduling/validate.ts`
- Create: `src/modules/scheduling/index.ts`
- Create: `src/modules/scheduling/__tests__/validate.test.ts`

- [ ] **Step 1: Write failing graph-validation tests**

  Cover missing/self/cyclic dependencies, zero or multiple terminal tasks per recipe, nonpositive durations, unknown resources, and active tasks always locking `cook:1`. `validateTaskGraph(tasks,kitchen)` rejects `burner:2` when burners=1. All oven tasks require confirmed `ovenOperation/ovenTemperatureC`; oven cooking must depend on a preheat/change task reaching the same temperature.

- [ ] **Step 2: Run tests and confirm RED**

  Run: `npm test -- src/modules/scheduling/__tests__/validate.test.ts`

  Expected: FAIL because `validateTaskGraph` is undefined.

- [ ] **Step 3: Implement a stable validator**

  Return ordered `ScheduleIssue[]` with public codes `MISSING_DEPENDENCY/DEPENDENCY_CYCLE/INVALID_TERMINAL/INVALID_DURATION/INVALID_RESOURCE/OVEN_TRANSITION_REQUIRED`. Topological ordering is deterministic by task ID. After Task 7 scheduling, adjacent oven-cooking tasks at different temperatures must have a confirmed temperature-change task between them, or the entire plan fails.

- [ ] **Step 4: Run tests and confirm GREEN**

  Run: `npm test -- src/modules/scheduling/__tests__/validate.test.ts`

  Expected: PASS with stable, nonrandom error ordering.

- [ ] **Step 5: Commit task-graph validation**

  ```bash
  git add src/modules/scheduling
  git commit -m "feat(schedule): validate task graphs and kitchen resources"
  ```

### Task 7: Implement synchronized scheduling and infeasibility explanations

**Files:**
- Create: `src/modules/scheduling/intervals.ts`
- Create: `src/modules/scheduling/schedule.ts`
- Create: `src/modules/scheduling/forward-schedule.ts`
- Create: `src/modules/scheduling/__tests__/intervals.test.ts`
- Create: `src/modules/scheduling/__tests__/schedule.test.ts`
- Create: `src/modules/scheduling/__tests__/forward-schedule.test.ts`
- Modify: `src/modules/scheduling/index.ts`

- [ ] **Step 1: Write failing capacity-interval tests**

  Cover half-open intervals, nonconflicting touching boundaries, cook/oven capacity one, burner capacity two, passive tasks releasing cooks while retaining equipment, and atomic reservations of multiple resources per task.

- [ ] **Step 2: Implement pure interval functions**

  `canReserve` and `reserve` never read system time. Inputs and outputs use epoch milliseconds parsed from offset-aware ISO timestamps; identical inputs produce identical ordering.

- [ ] **Step 3: Write failing backward-scheduling tests**

  Cover three recipe terminals within `[serveAt-5m, serveAt]`, nonoverlapping active cook tasks, parallel burners, exclusive oven use, dependency order, and no starts before `availableFrom`. Also write a failing `scheduleForwardEarliest(request)` test: schedule a complete dependency/resource-valid timeline forward from availableFrom and use the latest terminal end as a reproducible earliest service time.

- [ ] **Step 4: Implement stable backward list scheduling**

  Search backward minute by minute from terminal deadlines for the latest available intervals. Sort candidates stably by `latestEnd -> reverse critical path -> recipeId -> taskId`. Return `Schedule` on success. On failure, call pure `scheduleForwardEarliest`, placing its conflict-free timeline and latest terminal end in `InfeasibleSchedule.earliestFeasible` with stable reason codes. Never guess times from formulas or silently move `serveAt`.

- [ ] **Step 5: Add property-style boundary cases**

  Use fixed-seed, table-driven combinations to verify every scheduled task satisfies dependencies, resource capacities, and completion windows. Add no randomized-testing dependency.

- [ ] **Step 6: Run scheduling tests**

  Run: `npm test -- src/modules/scheduling && npm run typecheck`

  Expected: PASS; identical inputs produce identical snapshots.

- [ ] **Step 7: Commit the scheduler**

  ```bash
  git add src/modules/scheduling
  git commit -m "feat(schedule): generate synchronized dinner timelines"
  ```

### Task 8: Implement the cooking-session state machine and replanning

**Files:**
- Create: `src/modules/cooking-session/types.ts`
- Create: `src/modules/cooking-session/reducer.ts`
- Create: `src/modules/cooking-session/clock.ts`
- Create: `src/modules/cooking-session/selectors.ts`
- Create: `src/modules/cooking-session/persistence.ts`
- Create: `src/modules/cooking-session/index.ts`
- Create: `src/modules/cooking-session/__tests__/reducer.test.ts`
- Create: `src/modules/cooking-session/__tests__/clock.test.ts`
- Create: `src/modules/cooking-session/__tests__/persistence.test.ts`
- Create: `src/modules/scheduling/replan.ts`
- Create: `src/modules/scheduling/__tests__/replan.test.ts`
- Modify: `src/modules/scheduling/index.ts`

- [ ] **Step 1: Write failing state-transition tests**

  Commands are exactly `START{taskId,at}`, `DELAY{taskId,at,delayMinutes}`, and `COMPLETE{taskId,at}`. The reducer creates `TASK_STARTED/TASK_DELAYED/TASK_COMPLETED` events with consecutive `sequence=last+1`. `advanceSessionTime(state,now)` derives ready tasks when plannedStart is reached, dependencies are complete, and resources are free; it emits TASK_DUE ordered by `expectedEnd,taskId`. `restoreSession(snapshot,now)` replays events and calls the same clock function. Test the full `scheduled -> ready -> running -> due -> completed` flow.

- [ ] **Step 2: Implement reducer and selectors**

  Reducer/clock functions receive explicit at/now. Start rechecks dependencies/locks; due never completes automatically; Complete records actualEnd. `applySessionCommand` replans and atomically updates runtime/events/schedule on actual Start deviation, every Delay, and every Complete. Even on-time completion must release resources, reevaluate ready state, and replan; deviation controls warnings only. If original serveAt is infeasible, use earliestFeasible with WINDOW_INFEASIBLE.

- [ ] **Step 3: Write failing replanning tests**

  With public `ReplanRequest`, cover completedTaskIds satisfying dependencies, running `lockUntil=expectedEnd`, and due `lockUntil=null` retaining resources indefinitely until explicit Complete. now is the new lower bound for unstarted tasks; replan only scheduled/ready tasks. Due locks must return structured infeasibility instead of being bypassed. Repeated inputs produce identical results.

- [ ] **Step 4: Implement replanRemainingTasks**

  After reserving fixed active intervals, `replanRemainingTasks` processes dependencies: successors of running tasks cannot start before expectedEnd; due tasks have no end time and block all successors until explicit Complete. Only completed tasks leave the DAG and release successors. Never move active/completed tasks. Replanning/recovery updates planned fields without overwriting actual fields and reuses the same scheduler.

- [ ] **Step 5: Write versioned persistence tests and implement adapters**

  `SessionSnapshotV1` stores only ScheduleRequest, initial Schedule, and serializable SessionEvent[]. Recovery must replay events then call `advanceSessionTime(now)`, never automatic Complete. Unknown versions and malformed JSON return recoverable issues. Unavailable localStorage falls back to memory with a persistent warning.

- [ ] **Step 6: Run full Chunk 1 verification**

  Run: `npm run check:files && npm run lint && npm run typecheck && npm test -- --run`

  Expected: PASS with no failing domain tests.

- [ ] **Step 7: Commit sessions and replanning**

  ```bash
  git add src/modules/cooking-session src/modules/scheduling
  git commit -m "feat(session): support live steps and delay replanning"
  ```

## Chunk 2: Application experience, Hosted Demo, and Local AI

### Task 9: Establish demo data and top-level planning orchestration

**Files:**
- Create: `src/modules/demo/source-recipes.ts`
- Create: `src/modules/demo/parsed-drafts.ts`
- Create: `src/modules/demo/scenario.ts`
- Create: `src/modules/demo/index.ts`
- Create: `src/modules/demo/__tests__/fixtures.test.ts`
- Create: `src/modules/dinner-planner/types.ts`
- Create: `src/modules/dinner-planner/reducer.ts`
- Create: `src/modules/dinner-planner/build-plan.ts`
- Create: `src/modules/dinner-planner/persistence.ts`
- Create: `src/modules/dinner-planner/index.ts`
- Create: `src/modules/dinner-planner/__tests__/build-plan.test.ts`
- Create: `src/modules/dinner-planner/__tests__/persistence.test.ts`

- [ ] **Step 1: Write failing fixture-contract tests**

  Three English recipes must pass field-level Zod and evidence-offset validation, include at least one inferred field, one passive oven task, and two parallel burner tasks, and match every used ingredient to a sourced nutrition record.

  Run: `npm test -- src/modules/demo/__tests__/fixtures.test.ts`

  Expected: FAIL because fixtures do not exist.

- [ ] **Step 2: Write the three-dish demo fixture**

  Use a synchronizable dinner for two, such as lemon-herb chicken, roasted vegetables, and garlic rice. Manually verify agreement among source text, evidence, and parsed results. Use original project writing, not complete copyrighted third-party recipes.

- [ ] **Step 3: Write failing buildDinnerPlan tests**

  Assert confirmed Drafts only, combined nutrition/schedule results, target deltas for complete data, nullable `sourceServings` permitting scheduling but producing partial nutrition, and old-plan invalidation when `targetServings` changes.

- [ ] **Step 4: Implement the top-level reducer and buildDinnerPlan**

  Phases are strictly `setup/review/plan/cook/summary`. Orchestration calls only public module interfaces, never internals. Classify errors as `field/review/nutrition/schedule/storage/ai` for the UI.

- [ ] **Step 5: Implement complete workflow persistence**

  `DinnerPlannerSnapshotV1` stores current phase, reviewed Recipes, nutrition summaries, Schedule, and replayable session events. Malformed JSON/unknown versions require safe reset. QuotaExceeded switches to memory with persistent warnings. Never store Codex sessions, authentication data, or temporary execution directories.

- [ ] **Step 6: Add a fixed-delay demo scenario**

  After cooking starts, the scenario sends a fixed `+8 minutes` event to one running task. The accelerated clock changes only event timing, never content or the state machine.

- [ ] **Step 7: Verify and commit the complete demo domain workflow**

  Run: `npm test -- src/modules/demo src/modules/dinner-planner && npm run typecheck`

  Expected: PASS; the built-in dinner produces a conflict-free plan.

  ```bash
  git add src/modules/demo src/modules/dinner-planner
  git commit -m "feat(demo): connect the built-in dinner planning workflow"
  ```

### Task 10: Implement the visual system and Setup page

**Files:**
- Create: `src/components/ui/button.tsx`
- Create: `src/components/ui/panel.tsx`
- Create: `src/components/ui/progress-rail.tsx`
- Create: `src/components/ui/status-chip.tsx`
- Create: `src/components/dinner-sync-app.tsx`
- Create: `src/components/setup-screen.tsx`
- Create: `src/components/__tests__/setup-screen.test.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Establish a distinctive visual direction**

  A warm kitchen operations table: cream paper, charcoal text, tomato-red actions, saffron time markers, and sage-green completion. Use npm-hosted `Fraunces` for display and `Manrope` for body text. Three dish tracks converge on one `Dinner lands` marker, with restrained paper texture and ruler marks.

- [ ] **Step 2: Write failing Setup component tests**

  Assert mode descriptions, three recipe inputs, diners, serve time, kcal target, privacy consent, and `Build my service plan`. Local AI cannot submit without data-sharing consent; Hosted Demo loads in one click.

  Run: `npm test -- src/components/__tests__/setup-screen.test.tsx`

  Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement design tokens and UI primitives**

  CSS variables define colors, spacing, radii, shadows, fonts, and 150/250ms motion. Support `prefers-reduced-motion`, clear focus rings, and WCAG AA contrast. Buttons/panels carry shared presentation semantics only, not business state.

- [ ] **Step 4: Implement the top-level App and SetupScreen**

  Desktop uses an asymmetric input/workspace and service-preview layout; mobile is single-column. Associate labels with controls and errors through `aria-describedby`. Mode switching clearly states that Hosted Demo sends no data while Local AI sends inputs to OpenAI.

- [ ] **Step 5: Run component tests and the first visual check**

  Run: `npm test -- src/components/__tests__/setup-screen.test.tsx && npm run dev`

  Expected: Tests PASS; no horizontal scrolling at 390×844 or 1440×900, with the main action visible in the first viewport.

- [ ] **Step 6: Commit Setup experience**

  ```bash
  git add src/app src/components
  git commit -m "feat(ui): build dinner setup and visual system"
  ```

### Task 11: Implement Review and field-level correction

**Files:**
- Create: `src/components/review-screen.tsx`
- Create: `src/components/review-field.tsx`
- Create: `src/components/nutrition-match.tsx`
- Create: `src/components/__tests__/review-screen.test.tsx`
- Modify: `src/components/dinner-sync-app.tsx`
- Modify: `src/modules/dinner-planner/reducer.ts`

- [ ] **Step 1: Write failing Review interaction tests**

  Cover source/inferred labels, clicking evidence to locate source text, missing-value editing, nutrition-record confirmation, explicit omitted actions, per-field confirmation, disabled planning before all gates pass, and explicit confirmation of `sourceServings: null`.

- [ ] **Step 2: Implement ReviewField and evidence highlighting**

  Build before/highlight/after fragments from source spans using UTF-16 offsets, never a replacement text search. Inferred fields show reasons and prominent manual-confirmation status.

- [ ] **Step 3: Implement nutrition-match review**

  Show canonical name, state, kcal per 100g, source, and version without presenting confidence as a safety guarantee. Unconvertible values require grams or remain used/unresolved; do not steer users toward omitted.

- [ ] **Step 4: Connect editing and invalidation rules**

  Changing target servings or omitted ingredients immediately clears plannedGrams, nutrition summary, and schedule, and resets the recipe's step fields to `needs-review`.

- [ ] **Step 5: Run tests and accessibility checks**

  Run: `npm test -- src/components/__tests__/review-screen.test.tsx && npm run lint && npm run typecheck`

  Expected: PASS; every confirmation action works by keyboard.

- [ ] **Step 6: Commit Review experience**

  ```bash
  git add src/components src/modules/dinner-planner/reducer.ts
  git commit -m "feat(ui): add recipe and nutrition review workflow"
  ```

### Task 12: Implement Plan, Cook, and Summary pages

**Files:**
- Create: `src/components/plan-screen.tsx`
- Create: `src/components/service-timeline.tsx`
- Create: `src/components/cook-screen.tsx`
- Create: `src/components/task-card.tsx`
- Create: `src/components/summary-screen.tsx`
- Create: `src/components/__tests__/plan-screen.test.tsx`
- Create: `src/components/__tests__/cook-screen.test.tsx`
- Create: `src/components/__tests__/summary-screen.test.tsx`
- Modify: `src/components/dinner-sync-app.tsx`

- [ ] **Step 1: Write failing Plan page tests**

  Assert three dish tracks converge on the serve marker; active/passive modes, cook/oven/burner resources, and start/end times are distinguishable. Complete nutrition shows total/per-person/delta; partial nutrition shows only known subtotal and missing inputs. Infeasible plans show reasons and earliest completion.

- [ ] **Step 2: Implement ServiceTimeline and PlanScreen**

  Use CSS grid instead of inaccessible canvas. Mobile uses a start-time-sorted list while retaining dish and resource labels.

- [ ] **Step 3: Write failing Cook page tests**

  Cover current/next action, countdown, Start/Delay/Complete, rejected conflicting starts, retained due locks, `+4 min` replanning, changed-task markers, and refresh-recovery warnings.

- [ ] **Step 4: Implement CookScreen driven by actual timestamps**

  The UI ticker refreshes display only; event timestamps determine state rather than decrementing counters. Start/Complete buttons prevent duplicate submission, and accelerated replay uses the same dispatcher.

- [ ] **Step 5: Write and implement Summary**

  Show planned/actual completion, delay/replan counts, per-dish/per-person kcal, partial warnings, and next-time suggestions based only on actual critical-path deviations. Never call models for health advice.

- [ ] **Step 6: Run component regressions**

  Run: `npm test -- src/components && npm run typecheck`

  Expected: PASS; Plan, Cook, and Summary are keyboard-operable.

- [ ] **Step 7: Commit the complete main workflow**

  ```bash
  git add src/components
  git commit -m "feat(ui): complete planning cooking and summary experience"
  ```

### Task 13: Connect the safe Local AI HTTP boundary

**Files:**
- Create: `src/modules/recipe-import/codex-prompt.ts`, `src/modules/recipe-import/__tests__/codex-prompt.test.ts`
- Create: `src/app/api/local-ai/status/route.ts`, `src/app/api/local-ai/status/route.test.ts`, `src/app/api/local-ai/import/route.ts`, `src/app/api/local-ai/import/route.test.ts`
- Create: `tests/integration/codex-three-recipes-real.test.ts`
- Modify: `src/modules/recipe-import/codex-runner.ts`, `src/modules/recipe-import/schemas.ts`, `src/modules/recipe-import/index.ts`
- Modify: `src/components/dinner-sync-app.tsx`
- Modify: `next.config.ts`
- Modify: `package.json`
- Create: `.env.example`

- [ ] **Step 1: Write failing prompt-isolation tests**

  Assert system instructions treat recipes as untrusted data, ignore embedded instructions, prohibit tool/file/network requests, and return schema-only output. Embed user content as JSON strings with count/length bounds.

- [ ] **Step 2: Implement the prompt builder and complete output schema**

  JSON Schema and Zod use strict/`additionalProperties:false`; each ReviewValue.status is literal `needs-review`, not a general enum. The server rejects entire batches containing model-preconfirmed values. Models cannot output kcal, nutrition-record IDs, or final schedules.

- [ ] **Step 3: Write failing status/import route tests**

  Cover hosted 404, same-origin/consent, count/length, and `LOCAL_AI_DISABLED/CONSENT_REQUIRED/CODEX_NOT_INSTALLED/CODEX_NOT_LOGGED_IN/MODEL_UNAVAILABLE/CODEX_TIMEOUT/CODEX_QUOTA/INVALID_MODEL_OUTPUT/EVIDENCE_MISMATCH/INPUT_TOO_LARGE`. Success returns only validated Drafts and actual provider/model/schemaValidated/evidenceValidated metadata.

- [ ] **Step 4: Implement Node-runtime routes**

  Export Result-returning `runCodexImport({recipes,model,signal,timeoutMs})` from `codex-runner.ts`. It invokes verified GPT-5.6 in an empty tempDir with `cwd=tempDir` and `--sandbox read-only --ephemeral --ignore-user-config --ignore-rules`, supports timeout/cancellation/output limits, and cleans up in finally. Routes invoke it only when enabled, validate Origin/Host, enforce one concurrent call, never log source text or return raw stderr, and set no-store. `dev:local-ai` binds only 127.0.0.1.

- [ ] **Step 5: Add security headers and UI recovery**

  CSP at least restricts `default-src 'self'` and `frame-ancestors 'none'`. Local AI failures preserve input and permit retry or explicit switching to Hosted Demo without implying successful parsing.

- [ ] **Step 6: Run boundary tests and real parsing**

  Run: `npm test -- src/modules/recipe-import src/app/api/local-ai`

  Expected: Unit/route tests PASS.

  Run `npm run dev:local-ai` and verify it listens only on `127.0.0.1:3000`. In another terminal, run `$env:RUN_REAL_CODEX='1'; npm run test:codex-real:full` to parse three original fixtures through the real route.

  Expected: All three Drafts pass schema/root-source evidence checks as one batch, display actual model metadata, and enter Review. Failures exit nonzero, network responses use no-store, and logs/console contain no source text.

- [ ] **Step 7: Commit the Local AI workflow**

  ```bash
  git add .env.example package.json next.config.ts src/app/api src/components/dinner-sync-app.tsx src/modules/recipe-import
  git commit -m "feat(ai): connect local recipe parsing workflow"
  ```

## Chunk 3: End-to-end acceptance, documentation, demo, and submission

### Task 14: Complete Playwright end-to-end acceptance

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/hosted-demo.spec.ts`, `tests/e2e/local-ai.spec.ts`, `tests/e2e/local-ai-real.spec.ts`, `tests/e2e/persistence.spec.ts`, `tests/e2e/mobile.spec.ts`
- Modify: `package.json`

- [ ] **Step 1: Write a failing Hosted Demo scenario**

  Start at `Try the 650 kcal demo`, show three recipes, nutrition review, a five-minute synchronization window, accelerated cooking, a fixed eight-minute delay on a running task, visible replanning, and Summary. Intercept requests and assert no `/api/local-ai/*` or external model calls throughout.

  Run: `npm run test:e2e -- tests/e2e/hosted-demo.spec.ts`

  Expected: Initial FAIL identifies a missing user path rather than a configuration error.

- [ ] **Step 2: Fix integration gaps until Hosted Demo passes**

  Fix only module wiring and testability without adding scope. Use accessible button/state names, not test-only DOM.

- [ ] **Step 3: Write Local AI boundary E2E**

  Default local-ai.spec injects a fake process to verify consent/metadata/confirmation/Plan without quota usage. Add `e2e:local-ai-real` (`cross-env RUN_REAL_CODEX=1 playwright test tests/e2e/local-ai-real.spec.ts`) requiring `npm run dev:local-ai` in another terminal. Real GPT-5.6 parses all three texts; assert schemaValidated/evidenceValidated, then enter Plan after field-level confirmation. Write redacted exit-code/model/time evidence to ignored `.verification/local-ai-real.json`.

- [ ] **Step 4: Write refresh-recovery and mobile E2E**

  Persistence covers refreshing running/due tasks without automatic completion and clearing sessions. Mobile uses 390×844, checks no horizontal overflow, at least 44px primary touch targets, and a readable list timeline.

- [ ] **Step 5: Run the full browser suite**

  Run: `npx playwright install chromium`

  Run: `npm run test:e2e`

  Expected: Hosted, Local AI mock, persistence, and mobile all PASS. Save traces, screenshots, and videos on failure.

- [ ] **Step 6: Commit E2E coverage**

  ```bash
  git add package.json package-lock.json playwright.config.ts tests/e2e src
  git commit -m "test(e2e): cover dinner planning and delay replanning"
  ```

### Task 15: Complete responsive, accessibility, and visual acceptance

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/components/*.tsx`
- Create: `docs/verification/visual-checklist.md`
- Create: `docs/submission/assets/.gitkeep`

- [ ] **Step 1: Inspect every desktop and mobile screen in the browser**

  Check Setup, Review, Plan, Cook, and Summary at 1440×900, 1024×768, and 390×844. Record overflow, clipping, low contrast, lost focus, and motion discomfort.

- [ ] **Step 2: Fix visual and interaction issues**

  Retain cream paper, charcoal, tomato red, saffron, sage, and converging tracks. Avoid purple gradients, template heroes, and decorative cards without product purpose. Disable track entrances and pulses under reduced motion.

- [ ] **Step 3: Check keyboard and screen-reader semantics**

  Tab order follows visual order; due state uses restrained `aria-live`; input errors are associated; color is not the sole state signal. Any Dialog/Drawer manages focus and supports Escape.

- [ ] **Step 4: Generate submission screenshots**

  Playwright captures the fixed Hosted fixture's homepage, synchronized timeline, replan after an eight-minute delay, Summary, and mobile views into `docs/submission/assets/`. Screenshots must contain no usernames, email addresses, tokens, or local paths.

- [ ] **Step 5: Verify regressions and commit**

  Run: `npm run lint && npm run typecheck && npm test -- --run && npm run test:e2e`

  Expected: All PASS.

  ```bash
  git add src docs/verification docs/submission/assets
  git commit -m "style(ui): complete responsive and accessibility acceptance"
  ```

### Task 16: Complete README, license, and deployment gates

**Files:**
- Create: `README.md`
- Create: `LICENSE`
- Create: `docs/submission/testing.md`
- Create: `docs/submission/checklist.md`
- Create: `docs/submission/devpost-copy.md`
- Modify: `.env.example`
- Modify: `package.json`

- [ ] **Step 1: Write the English README**

  Include product claims, Apps for Your Life track, Hosted Demo URL placeholder, Node/Codex prerequisites, Hosted versus Local AI, `npm ci`/run/test/real-model commands, architecture, privacy boundaries, calorie-estimation/allergen/medical statements, known limitations, third-party data sources, and MIT license.

- [ ] **Step 2: Write judging instructions and English Devpost copy**

  `testing.md` gives two-minute Hosted and Local AI paths. `devpost-copy.md` includes name, tagline, problem, features, technical implementation, challenges, achievements, lessons, next steps, stack, and division of work among Codex/GPT-5.6 and deterministic engines.

- [ ] **Step 3: Write the submission checklist**

  Include Apps for Your Life, public Hosted URL, public repository/license, public YouTube, audio, video <180 seconds, real GPT-5.6, `/feedback` Session ID, last rules-verification time, sensitive-data scan, and final Devpost state.

- [ ] **Step 4: Run a clean installation and Hosted build**

  Run: `npm ci && npm run verify`

  Expected: lint, typecheck, unit tests, file-length checks, and production build all PASS.

  Run: `$env:DINNERSYNC_LOCAL_AI='disabled'; npm run build`

  Expected: Hosted build succeeds; Local AI routes return 404 at runtime and contain no bundled authentication data.

- [ ] **Step 5: Deploy Hosted Demo and retest signed out**

  The target supports Next.js 16. Set only `DINNERSYNC_LOCAL_AI=disabled`; the environment-variable inventory must contain no OpenAI/Codex secrets. Set `$env:PLAYWRIGHT_BASE_URL='<public-url>'` and run hosted-demo.spec, then send signed-out HTTP requests to exact paths `/api/local-ai/status` and `/api/local-ai/import`, asserting 404 for both. Save variable-name-only configuration and log summaries proving no model calls or handler hits.

- [ ] **Step 6: Create or connect a public code repository**

  Use repository name `DinnerSync`, with complete commit history and MIT license on the default branch. Scan secrets before pushing and verify the public URL signed out. If publication is unavailable, use private access and invite exactly `testing@devpost.com` and `build-week-event@openai.com`.

- [ ] **Step 7: Commit documentation and deployment configuration**

  ```bash
  git add README.md LICENSE .env.example package.json docs/submission
  git commit -m "docs(release): complete judging instructions and submission materials"
  ```

### Task 17: Produce and verify a public three-minute video

**Files:**
- Create: `docs/submission/demo-script.md`
- Create: `docs/submission/storyboard.json`
- Create: `scripts/validate-demo.mjs`
- Create: `artifacts/demo/dinnersync.mp4` (local artifact; do not commit)
- Modify: `package.json`, `.gitignore`

- [ ] **Step 1: Write a machine-checkable English script**

  Shot budget: 0:00–0:18 problem; 0:18–0:43 real Local AI consent and GPT-5.6 parsing; 0:43–1:05 field/nutrition confirmation; 1:05–1:32 resource timeline; 1:32–2:05 accelerated cooking; 2:05–2:28 eight-minute delay/replan; 2:28–2:48 Summary; 2:48–2:58 technical roles.

- [ ] **Step 2: Implement the script gate**

  `scripts/validate-demo.mjs` validates storyboard duration `<180` seconds and all eight required segments. Add exact ignores for `artifacts/demo/*.mp4`, `.verification/`, `playwright-report/`, and `test-results/`; do not use broad rules that hide source files.

- [ ] **Step 3: Record real UI and English audio**

  Model waits may be shortened, but show real clicks, real successful results, and accurate model badges. Never present fixtures as Local AI. Narration or captions must explain estimated kcal and that Hosted Demo sends no data.

- [ ] **Step 4: Validate the final video with ffprobe**

  Run: `ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 artifacts/demo/dinnersync.mp4`

  Expected: A value `<180`.

  Run: `ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 artifacts/demo/dinnersync.mp4`

  Expected: `audio` output.

  Run: `npm run validate:demo`

  Expected: PASS with all required shots present.

- [ ] **Step 5: Upload publicly to YouTube and verify**

  Title and description identify DinnerSync / OpenAI Build Week / Apps for Your Life. Set Public and disable copyrighted music. Open signed out and verify playback, sound, clarity, and duration.

- [ ] **Step 6: Commit script and video metadata**

  ```bash
  git add package.json scripts/validate-demo.mjs docs/submission/demo-script.md docs/submission/storyboard.json docs/submission/checklist.md
  git commit -m "docs(demo): complete three-minute demo gates"
  ```

### Task 18: Final acceptance and Devpost submission

**Files:**
- Modify: `README.md`
- Modify: `docs/submission/devpost-copy.md`
- Modify: `docs/submission/checklist.md`
- Create: `docs/submission/submission-record.md`

- [ ] **Step 1: Run final automated gates**

  Run:

  ```powershell
  npm ci
  npm run check:files
  npm run lint
  npm run typecheck
  npm test -- --run
  npm run build
  npm run test:e2e
  npm run smoke:codex
  # Keep npm run dev:local-ai running in another terminal.
  npm run e2e:local-ai-real
  git diff --check
  git status --short
  ```

  Expected: Every command PASS. Real E2E uses actual GPT-5.6 to parse all three recipes, returns schema/evidence true, enters Plan after manual confirmation, and emits redacted evidence. Video/test artifacts must have exact ignore rules; `git status --short` must be empty, with no intentionally retained exceptions.

- [ ] **Step 2: Run external-link gates**

  Verify Hosted Demo, public repository, and YouTube signed out. Set PLAYWRIGHT_BASE_URL and run Hosted E2E. Assert 404 for public `/api/local-ai/status` and `/api/local-ai/import`, and check deployment variable names/server logs for absence of model credentials/calls. README commands must be copyable and runnable.

- [ ] **Step 3: Record Codex/GPT-5.6 evidence**

  Record nonsensitive Codex session ID, exact model ID, verification time, and related commit range from real build/parsing runs. Enter the required `/feedback` Session ID in the checklist and Devpost without committing local session contents.

- [ ] **Step 4: Fill out and preview Devpost**

  Select `Apps for Your Life`, paste final English copy, and enter Hosted/repository/public YouTube URLs, testing instructions, and session ID. Preview every field, checking for placeholders, private data, and exaggerated medical or calorie claims.

- [ ] **Step 5: Submit and confirm success**

  After final submission, require an explicit Devpost submitted state and project URL. Reopen My projects and confirm the entry remains submitted. Saving a draft alone is not completion.

- [ ] **Step 6: Record submission evidence and commit**

  `submission-record.md` records the official rules URL, last verification time, Devpost URL, submission time with zone, Hosted/Repo/YouTube URLs, and page state. Save `docs/submission/assets/devpost-submitted.png` cropped only to Submitted status and project URL, excluding account/cookie/token data.

  ```bash
  git add README.md docs/submission
  git commit -m "docs(submission): record DinnerSync competition submission"
  git push
  git status --short
  ```

## Final definition of done

Declare completion only when all of these hold:

- Real GPT-5.6 parsed all three recipes, with schema and evidence validation passing.
- Hosted Demo completes confirmation, scheduling, eight-minute delay, replanning, and Summary without login or model requests.
- One cook, one oven, and two burners have no conflicts; terminals fall within five minutes or infeasibility is clearly reported.
- Complete nutrition is reproducible; incomplete data shows only known subtotal, without medical/safety guarantees.
- Desktop, mobile, refresh recovery, keyboard paths, and production build pass.
- The public video is under three minutes, includes audio, and shows real Codex/GPT-5.6 use.
- Public Hosted, repository, and YouTube URLs are accessible signed out.
- Devpost explicitly shows the entry as submitted, with project URL and time recorded.
