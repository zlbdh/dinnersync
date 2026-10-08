# DinnerSync Product and Technical Design

Date: July 18, 2026
Status: Independent review passed; awaiting user confirmation
Competition: OpenAI Build Week 2026
Track: Apps for Your Life

Document-length rationale: This specification aligns product, domain semantics, security, testing, and submission constraints in one review, so it remains the single design source of truth. This exception applies only to the design document; implementation code still follows the 300-line target and module-splitting rules.

## 1. Overview

DinnerSync is a local-first intelligent dinner-planning app. Individual recipes explain how to make one dish but rarely coordinate multiple dishes with limited equipment, limited help, a calorie target, and a shared serving time.

Users import up to three text recipes and set diners, target serving time, per-person calories, and kitchen resources. GPT-5.6 parses unstructured recipes into structured data with source evidence; a deterministic nutrition module calculates calories; a resource-constrained scheduler produces synchronized timelines; live cooking replans unstarted tasks after delays.

Core promise:

> Recipes tell you how to cook one dish. DinnerSync helps the whole meal land together.

## 2. Problem and audience

### 2.1 The real problem

Home cooks preparing multiple dishes must mentally coordinate:

- Each recipe's step dependencies and waiting times.
- One person's inability to chop, stir-fry, and plate simultaneously.
- Conflicts among ovens, burners, and other equipment.
- How one delayed step changes other dishes' completion times.
- Meal-wide calories and per-person portions across multiple recipes.
- Recipes that assume knowledge of specific actions and preparation order.

Recipes and ordinary timers cover instructions and countdowns separately, but lack whole-meal coordination and recovery.

### 2.2 Target users

The first version serves people who:

- Prepare two or three dishes alone at home.
- Want approximate meal-calorie control without medical nutrition advice.
- Have limited cooking experience and need clear current and next steps.
- Use a phone or tablet to follow kitchen progress.

### 2.3 Success criteria

The competition version must complete this workflow:

1. Parse three sample or pasted text recipes.
2. Let users review and confirm all AI parsing results and nutrition matches.
3. Calculate estimated meal and per-person calories only when all used ingredients are matched; otherwise show only a known-calorie subtotal.
4. Generate a conflict-free timeline for one cook, one oven, and two burners with a five-minute synchronization window.
5. Reschedule unstarted tasks after a simulated delay.
6. Demonstrate the full process within a three-minute video using accelerated replay.
7. Local AI must complete a real GPT-5.6 parse. Users without Codex login can still experience the deterministic core through built-in examples and replay.

## 3. Non-goals

The competition version explicitly excludes:

- Scraping arbitrary recipe websites.
- Image, video, or handwritten-recipe recognition.
- Medical, weight-loss, disease-specific, or pediatric nutrition advice.
- Guarantees of food safety, doneness, or absence of allergen risk.
- Shopping lists, refrigerator inventory, or leftovers planning.
- Multiuser collaboration, accounts, or cloud synchronization.
- Arbitrary cook counts, complex commercial kitchens, or general optimal scheduling.
- Automatic model changes to recipes without user confirmation.
- Cloud inference requiring additional OpenAI API balance.

## 4. Design principles

### 4.1 AI proposes; code verifies

GPT-5.6 interprets natural-language recipes, breaks down steps, and proposes candidate fields. Deterministic code handles nutrition, dependencies, resource conflicts, scheduling, and timing.

All AI-extracted values start as `needs-review`. Users explicitly confirm the full recipe before nutrition and scheduling. Model-reported `confidence` only orders review items and never grants automatic approval.

### 4.2 Source evidence first

Every extracted field includes provenance. `source` fields require an `EvidenceSpan` using JavaScript UTF-16 code-unit offsets and half-open `[start, end)` intervals whose text exactly matches the input slice. `inferred` fields require `evidence: null`, a nonempty `inferenceReason`, and user confirmation. Missing quantities, durations, temperatures, and equipment remain pending instead of being silently invented.

### 4.3 Readable at a glance in the kitchen

Live mode emphasizes only the current action, next action, and urgent changes. Complex editing and detailed evidence stay in preparation rather than the main cooking view.

### 4.4 Handle uncertainty honestly

Label calories as estimates and report infeasible plans explicitly. If a delay makes the original target impossible, show the revised serving time and reason.

## 5. User flow

### 5.1 Welcome

Users can:

- Open the built-in “650 kcal dinner” demo.
- Create a dinner plan.
- Paste recipes and run AI import when Codex is available locally.

The product has two explicit modes:

- `Hosted Demo`: Runs built-in examples and pregenerated parsing results without model calls.
- `Local AI`: A local Next.js Node route calls the user's signed-in Codex CLI and sends recipe text to OpenAI.

Before Local AI parsing, the interface must clearly disclose that Codex sends recipes to OpenAI and require active consent. Local mode must not imply fully offline processing.

### 5.2 Set goals

Users enter:

- Number of diners.
- Earliest preparation start time.
- Target serving time.
- Serving synchronization tolerance, fixed at five minutes for P0.
- Optional per-person calorie target.
- Cook count, fixed or limited to one initially.
- Oven count, initially one.
- Burner count, at most two initially.
- Dietary-preference and allergen notes.

The app never calculates calorie targets from height, weight, or disease; users supply their own targets.

In P0, dietary preferences and allergens are displayed notes only, with no automated identification, filtering, or safety judgment.

### 5.3 Import and review recipes

Users paste at most three recipes. After parsing, the review page shows each dish's:

- Name, original servings, and target servings.
- Ingredients, quantities, units, and normalized grams.
- Nutrition matches, sources, and confidence.
- Steps, durations, and active/passive mode.
- Cook and equipment resources.
- Prerequisite steps.
- Supporting source evidence.

All AI results begin pending review. Users explicitly confirm each recipe; `confidence` only controls review order. Gate rules determine which fields may be excluded. Required steps and scheduling fields cannot be bypassed by exclusion.

### 5.4 Calorie budget

The app displays:

- Total calories per dish.
- Total meal calories.
- Estimated calories per person.
- Difference from the user's target.
- How unresolved ingredients affect completeness.

P0 supports proportional serving-based scaling only:

```text
plannedGrams = sourceGrams * targetServings / sourceServings
```

`sourceGrams` is the original recipe weight; `plannedGrams` is the weight planned for this dinner. Serving changes scale ingredients only, never step durations automatically; users reconfirm affected durations.

The formula requires nonnull positive `sourceServings`. If the source omits serving count and the user confirms that absence, retain null, produce no plannedGrams for that recipe, and exclude it from complete-calorie or target-delta conclusions. Confirmed steps, dependencies, durations, and resources remain schedulable. Nutrition sums other used ingredients with reliable plannedGrams and labels the result a known-calorie subtotal.

Changing `targetServings` immediately invalidates all plannedGrams, nutrition summaries, and existing schedules and resets every step field in that recipe to `needs-review`. Recompute weights, reconfirm steps, and pass field gates before producing calories or timelines again.

`omitted` means the user explicitly will not use that ingredient; it contributes neither planned weight nor nutrition. Omitting resets all recipe step fields to `needs-review`. Ingredients that will be used but lack nutrition matches remain used and unresolved, never omitted merely for missing data.

If any used ingredient lacks reliable grams or a nutrition record, display only the known-calorie subtotal and unresolved list, disabling target-achieved conclusions. P0 provides no ingredient substitutions.

### 5.5 Timeline preview

Generated plans use swimlanes for:

- Cook.
- Oven.
- Burner one.
- Burner two.
- Each dish's completion window.

Mark conflicts and critical paths clearly. Each recipe has exactly one terminal task. Synchronized completion means every terminal ends within `[serveAt - serveToleranceMinutes, serveAt]`, with no task starting before `availableFrom`.

If the target is infeasible, schedule forward from availableFrom to compute the earliest serving time and structured reason codes instead of overlapping tasks or starting arbitrarily early. All times are ISO 8601 strings with UTC offsets.

### 5.6 Live cooking

The cooking interface shows:

- Active steps that need attention now.
- All running or due passive tasks and timers.
- Ingredients and quantities.
- Original recipe instructions and simplified explanations.
- Remaining time.
- Observation cues.
- Next step.
- Currently occupied equipment.
- Start, Delay, and Complete actions.

Timing uses absolute timestamps. Task state recovers after backgrounding or refreshing the browser.

Task states are fixed:

```text
scheduled -> ready -> running -> due -> completed
```

- A task becomes `ready` only after prerequisites complete, planned start arrives, and all required resources are available.
- Only a user Start action with an atomic resource recheck enters `running`, records `actualStart`, and computes `expectedEnd`.
- Reaching expectedEnd enters `due`, never automatic completion; resources stay locked.
- Resources held by `running` or `due` tasks cannot be reused. Conflicting tasks remain `scheduled`, and conflicting Start requests are rejected.
- User Complete enters `completed` and records `actualEnd`.
- Actual starts or completions differing from the plan invoke the same remaining-task replanning logic as delays.
- Refresh recovers `ready`, `running`, or `due` from persisted events and timestamps, never automatically completing overdue tasks.

### 5.7 Delays and replanning

Users select a running task and add a delay:

1. Completed tasks stay unchanged.
2. The delayed task updates expectedEnd and extends resource locks.
3. Other running tasks stay unchanged.
4. Unstarted tasks are recalculated.
5. Dependency and resource constraints remain enforced.
6. If the original target is impossible, show a revised serving time.
7. Highlight differences so users need not reread the whole timeline.

P0 does not allow skipping tasks, which could break required dependencies or fabricate completion.

### 5.8 Completion summary

The final page shows:

- Planned and actual completion times.
- Delay and replan counts.
- Estimated calories per dish and person.
- Unconfirmed or excluded nutrition data.
- Next-time preparation suggestions listing only critical-path tasks whose actualStart was later than planned; no other model-generated suggestions.

## 6. Feature scope

### 6.1 P0: Required for competition

- Hosted Demo and Local AI with explicit data-sharing consent. Both are P0; Hosted Demo cannot replace real Local AI acceptance.
- GPT-5.6 structured parsing of three text recipes.
- Strict schemas, evidence-offset validation, and full manual confirmation.
- Built-in traceable demo nutrition records.
- Deterministic ingredient-weight and calorie calculations.
- Known-calorie subtotals, complete-total gates, servings, and target deltas.
- `availableFrom`, a five-minute synchronization window, and terminal tasks.
- Resource-constrained scheduling for one cook, one exclusive oven, and two burners.
- Dependency-cycle, resource-conflict, and infeasibility detection.
- Mobile-first preparation, timeline, and cooking views.
- Multiple timers, delays, and dynamic replanning.
- Local persistence.
- Built-in examples, replay, and an accelerated clock.
- English UI and demo content.
- Installation, testing, and Codex/GPT-5.6 instructions.

### 6.2 P1: If time permits

- Protein, carbohydrate, and fat display.
- Browser speech for the current step.
- DinnerSync Codex Skill packaging.
- Plan JSON import/export.
- Basic offline PWA support.

### 6.3 P2: After competition

- Image recognition.
- Shopping lists and inventory.
- Leftovers planning.
- Household profiles.
- Long-term dietary trends.
- Manually curated ingredient-substitution allowlists.
- Multiple cooks and complex kitchens.
- Online recipe connectors.

## 7. System architecture

### 7.1 Overall structure

```text
Hosted Demo ----------------> pre-generated confirmed fixture
                                      |
Local AI recipe text                  |
   |                                  |
   v                                  |
Consent gate                          |
   |                                  |
   v                                  |
Local Next.js Node route              |
   |                                  |
   v                                  |
Codex importer (GPT-5.6, isolated read-only process)
   |
   v
Strict recipe schema + validated source evidence
   |
   v
Review UI --> confirmed meal input <--+
                  |
                  +--> Nutrition engine
                  +--> Scheduling engine
                  +--> Live session state machine
                               |
                               v
                       Timeline / Cook / Summary UI
```

### 7.2 Suggested directory boundaries

```text
src/
  app/                    # Next.js routes and page composition
  modules/
    recipe-import/        # Codex adapters, schemas, and review workflow
    nutrition/            # Nutrition records, unit conversion, and calories
    scheduling/           # DAG, resource constraints, scheduling, and replanning
    cooking-session/      # Runtime state machine, timing, and persistence
    demo/                 # Built-in recipes, demo results, and accelerated clock
  components/             # Reusable presentation components
  shared/                 # Shared types, errors, and basic utilities
skills/
  dinner-sync/            # P1 Codex Skill
docs/
  superpowers/specs/      # Design specifications
  plans/                  # Implementation plans
```

Each module exports through `index.ts`. UI uses public interfaces only, never internal scheduling or nutrition files.

### 7.3 Codex importer

Local AI calls noninteractive Codex from local Next.js Node routes. Hosted Demo exposes no such routes and makes no model calls.

The local adapter must:

- Use GPT-5.6.
- Run in an empty temporary directory.
- Use `--ephemeral` without saving sessions.
- Use a read-only sandbox.
- Enforce a strict output JSON Schema.
- Set timeout, cancellation, and maximum input length.
- Prevent model access to user projects or write operations.
- Revalidate output with runtime schemas.

Models return values, confidence, provenance, and source-evidence offsets. The adapter verifies EvidenceSpan start, end, and text against the input exactly. Any mismatch rejects the whole batch; partial AI results are not accepted.

Models propose ingredient names, states, and unit interpretations only, never nutrition values. Local nutrition matching requires user confirmation. Parsing failures do not enter scheduling; users may choose the built-in demo.

Verify exact model IDs and command flags from local Codex documentation and real CLI behavior before implementation, rather than hardcoding them from memory during design.

### 7.4 Nutrition module

The nutrition module uses pure functions over confirmed normalized ingredients and nutrition records.

Core formula:

```text
ingredient_kcal = plannedGrams / 100 * kcal_per_100g
recipe_kcal = sum(resolved ingredient_kcal)
meal_kcal_per_person = sum(recipe_kcal) / diners
```

Every nutrition record includes at least:

- Stable ID.
- Canonical name.
- Raw/cooked or other food state.
- Calories per 100 grams.
- Optional macronutrients.
- Data source and version.
- Applicable unit conversions.

P0 supports grams, kilograms, milliliters, liters, and measuring-cup/spoon conversions explicitly configured in demo data. Unreliable units such as “one,” “a little,” or branded packaging require user-entered grams or remain unresolved.

`sourceServings` must exist and be positive. Otherwise reject serving conversion and complete-calorie calculation, leaving all recipe plannedGrams null. Unknown ingredients and unreliable conversions never enter complete totals. Any unresolved used ingredient limits the UI to known subtotal, resolved count, and unresolved list. Do not show misleading calorie-coverage percentages or claim the target is met.

The demo uses a small manually verified local dataset. Confirm licensing, fields, and version policy before integrating external nutrition data.

### 7.5 Scheduling module

The scheduler never reads sourceServings or nutrition summaries. It accepts only confirmed steps, dependencies, durations, resources, terminal markers, availableFrom, and serveAt. Recipes whose absent source servings were explicitly confirmed can therefore still be scheduled.

Tasks are atomic actions. Split “put in the oven, bake, and remove” into three tasks. Each task includes:

- Unique ID and owning dish.
- Duration.
- Active/passive mode.
- Prerequisite tasks.
- Required resources.
- Optional oven temperature.
- Target completion window.
- Original step evidence.

Active tasks lock cook:1 throughout. Passive tasks release the cook but retain equipment for their full duration. In P0 the oven is exclusive even at matching temperatures. Preheating and temperature changes are explicit tasks; transition durations are never inferred implicitly.

Scheduling steps:

1. Validate task references and dependency cycles.
2. Verify exactly one terminal task per dish.
3. Calculate critical paths and earliest possible completion.
4. Schedule backward from `serveAt` without starting before `availableFrom`.
5. Active tasks lock `cook:1`.
6. Equipment tasks lock their respective resources.
7. Detect oven-temperature and occupancy conflicts.
8. Verify every terminal task falls inside the synchronization window.
9. If the target is infeasible, schedule forward from availableFrom for the earliest serving time and return stable codes such as `WINDOW_INFEASIBLE`, `RESOURCE_CONFLICT`, `DEPENDENCY_CYCLE`, and `MISSING_TERMINAL`.
10. Use deterministic heuristics for small task sets to maintain millisecond-scale response.

Do not introduce a general commercial-kitchen solver. Three dishes with limited steps are manageable with explainable list scheduling and backtracking corrections.

### 7.6 Dynamic replanning

Replanning inputs include current time, delayed running-task ID, completed tasks, all active tasks, actual delay, and remaining tasks.

Freeze completed tasks, extend only the selected task and its locks, preserve other running tasks, and reschedule the remaining DAG. Return:

- Updated timeline.
- Changed tasks.
- Revised estimated serving time.
- Key conflicts causing the changes.
- Whether completion still fits the user's allowed window.

### 7.7 Live session state machine

Sessions are event-driven:

- `TASK_STARTED`: Only ready tasks qualify. Atomically recheck resource availability, record actualStart, and compute expectedEnd from actualStart plus duration.
- `TASK_DELAYED`: Only running/due tasks qualify; update expectedEnd and extend locks.
- `TASK_DUE`: When current time reaches expectedEnd, transition running to due without releasing resources.
- `TASK_COMPLETED`: User-triggered; record actualEnd, release resources, and replan remaining tasks.
- `SESSION_RESTORED`: Rebuild from events and timestamps without synthesizing completion events.

Running/due tasks always retain resources. Conflicting tasks remain scheduled and cannot become ready. Conflicting Start requests return structured rejection. After Complete releases resources, reevaluate waiting tasks and replan.

A timer ending is not task completion. Summary actuals come only from actualStart, actualEnd, and explicit events. Hosted Demo replay injects the same Start, Due, Delay, and Complete events, without a second state machine.

### 7.8 Local persistence

The competition version needs no accounts or database server. Plans, confirmations, and cooking sessions remain in browser storage with one-click clearing. Unavailable persistence or failed writes fall back to memory with persistent warnings without blocking the current demo.

Persisted objects include schema versions. Failed legacy-data reads offer safe reset so corrupted state cannot block the built-in demo.

## 8. Core data contracts

### 8.1 Import and review contracts

```ts
type EvidenceSpan = {
  start: number;
  end: number;
  text: string;
};

type Provenance = "source" | "inferred";

type ReviewValue<T> = {
  value: T | null;
  provenance: Provenance;
  evidence: EvidenceSpan | null;
  inferenceReason: string | null;
  confidence: number;
  status: "needs-review" | "confirmed";
};

type RecipeDraft = {
  id: string;
  sourceText: string;
  name: ReviewValue<string>;
  sourceServings: ReviewValue<number | null>;
  ingredients: IngredientDraft[];
  steps: CookingStepDraft[];
};

type IngredientDraft = {
  id: string;
  sourceText: string;
  name: ReviewValue<string>;
  quantity: ReviewValue<number>;
  unit: ReviewValue<string>;
};

type CookingStepDraft = {
  id: string;
  sourceText: string;
  instruction: ReviewValue<string>;
  durationMinutes: ReviewValue<number>;
  mode: ReviewValue<"active" | "passive">;
  dependsOn: ReviewValue<string[]>;
  resources: ReviewValue<ResourceRequirement[]>;
  isTerminal: ReviewValue<boolean>;
};
```

ReviewValue wraps each AI-import field. Recipe name, source servings, ingredient name/amount/unit, and step description/duration/mode/dependencies/resources/terminal markers all require individual review.

EvidenceSpan uses JavaScript UTF-16 code-unit offsets and half-open `[start, end)` intervals. For `provenance === "source"`, evidence is nonnull and exactly reproducible through `sourceText.slice(start, end)` on the corresponding record. For inferred provenance, evidence is null and inferenceReason is nonempty.

RecipeDraft is the source of truth for editing/review. Only confirmed scheduling-required ReviewValues produce pure domain objects without AI metadata. Users may explicitly confirm missing sourceServings as null; this is not a scheduling gate, and converters preserve null. Changing servings or omitting ingredients discards derived domain objects and resets all recipe step fields to needs-review.

### 8.2 Confirmed Recipe

```ts
type Recipe = {
  id: string;
  name: string;
  sourceText: string;
  sourceServings: number | null;
  targetServings: number;
  ingredients: Ingredient[];
  steps: CookingStep[];
};
```

### 8.3 Confirmed Ingredient

```ts
type Ingredient = {
  id: string;
  sourceText: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  sourceGrams: number | null;
  plannedGrams: number | null;
  nutritionRefId: string | null;
  status: "used" | "omitted";
};
```

### 8.4 Confirmed CookingStep

```ts
type CookingStep = {
  id: string;
  recipeId: string;
  sourceText: string;
  instruction: string;
  durationMinutes: number;
  mode: "active" | "passive";
  dependsOn: string[];
  resources: ResourceRequirement[];
  isTerminal: boolean;
};
```

### 8.5 MealPlan

```ts
type MealPlan = {
  id: string;
  diners: number;
  availableFrom: string;
  serveAt: string;
  serveToleranceMinutes: 5;
  targetCaloriesPerPerson: number | null;
  kitchen: KitchenResources;
  recipes: Recipe[];
  nutritionSummary: NutritionSummary;
  schedule: ScheduleResult;
  schemaVersion: number;
};
```

### 8.6 TaskRuntimeState

```ts
type TaskRuntimeState = {
  taskId: string;
  status: "scheduled" | "ready" | "running" | "due" | "completed";
  plannedStart: string;
  plannedEnd: string;
  expectedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
};
```

Implementation plans place concrete types in their respective domains; the above describes only cross-module contracts.

## 9. Error handling

### 9.1 Field gates

| Condition | Scheduling allowed? | Complete calorie conclusion allowed? | Handling |
|---|---:|---:|---|
| Missing step duration | No | Depends on nutrition fields | User supplies and confirms |
| Missing dependencies or resources | No | Depends on nutrition fields | User supplies and confirms |
| Missing or duplicate terminal task | No | Depends on nutrition fields | Correct recipe task graph |
| Missing or mismatched source-field evidence | No | No | Reject the entire AI batch |
| Unconfirmed inferred field | No | Depends on nutrition fields | Show inference reason for user confirmation |
| Missing ingredient grams or nutrition record | Yes | No | Show known subtotal and unresolved list |
| Missing or nonpositive sourceServings | Yes | No | Disable serving conversion; request user input/confirmation |
| Changed targetServings without reconfirming derived data | No | No | Invalidate weights, nutrition, and schedule; review again |
| AI schema or evidence validation failure | No | No | Reject the entire batch and preserve original input |
| Local persistence failure | Yes | Yes | Fall back to memory with persistent warning |

Required steps cannot be excluded. Missing nutrition does not prevent scheduling but prohibits target-achieved conclusions.

### 9.2 Required error coverage

Cover:

- Codex missing, signed out, timed out, or out of quota.
- Model output failing schemas.
- Recipes exceeding length limits.
- Ambiguous ingredient amounts, units, or raw/cooked states.
- Missing nutrition records.
- Missing step durations.
- Missing or cyclic dependencies.
- Insufficient cook or equipment resources.
- Oven-temperature conflicts.
- Delays making the original serving time infeasible.
- Browser refresh, background timing, or corrupt local data.
- Declined Local AI data-sharing consent.

Errors explain impact and recovery, for example: “Two ingredients are unmatched. Only the known-calorie subtotal is shown, so the target cannot be evaluated.”

## 10. Security, privacy, and health boundaries

- Hosted Demo uses built-in data without model calls.
- Local AI sends user-approved recipe text through Codex to OpenAI; disclose this before sending.
- Codex parsing runs in an empty temporary directory and read-only sandbox.
- Do not read email, browser history, personal files, or other projects.
- Do not collect height, weight, diseases, or medical goals.
- Always label calories as estimates.
- P0 allergen information is user notes only, without automatic detection, filtering, or safety guarantees.
- Do not generate medical, weight-loss, or disease-specific dietary advice.
- Do not invent food-safety temperatures or doneness conclusions.
- The competition version offers no ingredient substitutions.
- Observation cues and step explanations may only quote or faithfully paraphrase the source recipe. Missing source information displays “Not provided in the original recipe”; never add temperatures, doneness, or safety advice.
- Built-in demo data uses fictional or explicitly redistributable content.

## 11. Test strategy

### 11.1 Unit tests

Nutrition:

- Gram weights and calories per 100 grams.
- Serving scaling.
- Known subtotal only when unresolved ingredients exist.
- Complete totals and target deltas only after every ingredient is resolved.
- Decimal rounding and invalid inputs.

Scheduling:

- Dependency order.
- Terminal-task uniqueness.
- availableFrom lower bound.
- Five-minute synchronized completion window.
- Exclusive active-task use of one cook.
- Exclusive oven/burner resource use.
- Parallel passive tasks.
- Passive tasks retaining equipment.
- No oven sharing in P0.
- Dependency cycles.
- Infeasible plans.
- Delay propagation and stable replanning.
- Delays change only the selected running task and its locks.
- Forward earliest-completion calculation and reason codes for infeasibility.
- Identical results for identical inputs.

Sessions:

- Timestamp recovery.
- `scheduled -> ready -> running -> due -> completed` transitions.
- Due tasks retain resources and never complete automatically.
- Due tasks prevent later users of the same resources from becoming ready.
- Rejection of conflicting Start requests.
- Start/Delay correctly set or update expectedEnd.
- Start, Delay, and Complete event validity.
- Actual start/end deviations invoke shared replanning.
- State recovery after refresh.
- Replay and real clocks share events and state machines.

### 11.2 Contract tests

- Codex output schemas.
- Built-in sample JSON.
- Persistence schema versions.
- Confirmed Drafts with absent sourceServings convert to Recipe and schedule normally, while nutrition shows only known subtotal.
- Recovery paths after model failure.

### 11.3 End-to-end tests

- Local AI: consent, actual GPT-5.6 execution, schema validation, and complete manual confirmation.
- Hosted Demo: load built-in dinner and complete replay without login.
- Load the demo dinner.
- Set diners, time, and calorie target.
- Review recipes.
- Generate the timeline.
- Start accelerated cooking.
- Inject an eight-minute delay.
- Verify timeline replanning.
- Finish and view Summary.

### 11.4 Manual verification

- One-handed operation at phone widths.
- Large text and high contrast.
- Key information readable at kitchen working distance.
- Clear English copy.
- Complete workflow within the three-minute demo.

## 12. UI information architecture

### 12.1 Views

These are product views, not necessarily seven routes. P0 may use a single-page step flow to reduce implementation cost:

1. Home: Value proposition, built-in demo, and new plan.
2. Setup: Diners, time, calories, and kitchen resources.
3. Import: Recipe inputs and AI parsing progress.
4. Review: Fields, provenance, and confidence.
5. Plan: Calorie budget, conflicts, and resource swimlanes.
6. Cook: Current active steps, running/due timers, next steps, and delays.
7. Summary: Actual results and improvement suggestions.

### 12.2 Visual priorities

- Combine warm culinary colors with a clear engineering timeline.
- Do not make chat the main interface.
- Use large touch targets for key actions.
- Reserve red for infeasibility or issues requiring immediate attention.
- Use known subtotals, complete-total gates, and unresolved lists without implying false calorie precision.
- Provide a timeline list view for mobile usability.

## 13. Competition and demo plan

### 13.1 Three-minute script

- 0:00–0:20: Problem—three recipes do not explain how to finish together.
- 0:20–0:45: Import recipes; show GPT-5.6 structured parsing and source evidence.
- 0:45–1:10: Discover calories above target and an oven-resource conflict.
- 1:10–1:35: Confirm servings and generate a resource timeline.
- 1:35–2:05: Enter accelerated cooking.
- 2:05–2:30: Inject an eight-minute delay and replan automatically.
- 2:30–2:50: Show Summary and revised estimated serving time.
- 2:50–3:00: Explain the roles of Codex, GPT-5.6, and deterministic engines.

### 13.2 Judging path

- Open the static demo online or locally.
- Click “Try the 650 kcal demo.”
- Complete the accelerated workflow without login.
- Enable real GPT-5.6 import after local installation, Codex login, and data-sharing consent.
- README specifies setup, supported platforms, sample data, and verification commands.
- Repository records Codex use, key decisions, and the `/feedback` Session ID.

### 13.3 Mandatory three-day implementation order

#### Day 1: Technical viability and domain core

- Verify local GPT-5.6 IDs, login, structured output, read-only sandboxing, and timeouts.
- If the preferred Codex CLI path cannot run reliably, switch within a bounded time to a verified Codex SDK adapter. If real GPT-5.6 parsing still cannot run that day, P0 is unmet: pause and reconsider the plan instead of claiming Hosted Demo completes it.
- Lock strict schemas, three demo recipes, and a small nutrition dataset.
- Use TDD for nutrition, task-graph validation, and initial scheduling.

#### Day 2: Complete user workflow

- Complete Setup, Review, Plan, and Cook.
- Complete timestamp timing, delay replanning, and memory/local persistence.
- Connect Hosted Demo, accelerated clock, and English UI.

#### Day 3: Acceptance and submission only

- Complete E2E, mobile, and error-path verification.
- Fix blockers without adding features.
- Finish README, demo video, screenshots, Devpost copy, and final submission.

### 13.4 Devpost checklist

- English project name and description.
- Apps for Your Life track.
- Accessible Hosted Demo or clear local testing path.
- Public repository URL and appropriate license; private repositories grant access to `testing@devpost.com` and `build-week-event@openai.com`.
- English README covering setup, samples, running, tests, limitations, and Codex/GPT-5.6 use.
- Public YouTube demo under three minutes with audio.
- Video clearly demonstrates the product, Codex, and GPT-5.6.
- Main build task's `/feedback` Session ID.
- Recheck current official rules and deadline before submission.

## 14. Acceptance criteria

The competition version is complete only when all conditions hold:

- The three built-in dishes reliably produce a nonoverlapping plan.
- Local AI completes real GPT-5.6 parsing, strict schemas, and complete manual confirmation. Hosted Demo serves only as the signed-out judging path.
- All AI extraction results require full confirmation, with verifiable evidence offsets.
- Nutrition results are sourced and reproducible; missing data yields only known subtotal.
- Unconfirmed fields never silently pass.
- All terminals finish inside the five-minute window, with no task before availableFrom.
- Dependencies and resource constraints remain valid after delays.
- Infeasible plans return explicit reasons.
- Accelerated and real timing share one state machine.
- Built-in demos work without Codex login.
- English UI, README, public demo, and test instructions are complete.
- Unit, contract, and E2E tests pass.
- The under-three-minute video shows the full workflow and explains GPT-5.6/Codex use.

## 15. Reference design ideas

No directly reusable food, nutrition, or scheduling project was found locally. DinnerSync will be an original implementation.

Stable ideas to learn from without copying:

- Schema.org Recipe fields to reduce custom naming.
- Authoritative nutrition records per 100 grams with source and food state.
- Job-shop dependency and resource-exclusivity modeling.
- Codex noninteractive read-only sandboxing, ephemeral sessions, and structured output.
- Timestamp-driven frontend timers and recoverable state machines.

Network failures prevented reading online references in this round. Before implementation, reverify exact fields, data licenses, and Codex flags. Until then, do not lock external APIs or copy third-party implementations.

## 16. Agreed tradeoffs

- Local-first operation sacrifices instant cloud access for no additional API fees and clearer privacy boundaries.
- Narrow deterministic scheduling sacrifices generality for a verifiable, stable product within three days.
- P0 portion control excludes ingredient substitution, reducing nutrition and allergen risk.
- Text recipes defer image recognition for reliable parsing and demos.
- Explicit human review sacrifices one-step completion for transparent provenance and manageable errors.
- The original design chose English competition UI and Chinese internal documentation/collaboration; current project rules now use American English throughout.
