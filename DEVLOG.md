# DinnerSync Development Log

## 2026-07-19 [Final submission video review] Task 19

### 1. The final media gate must enforce storyboard duration

- **Symptom:** The old validator required only an MP4 longer than zero and shorter than 180 seconds, so a one-second black video or a 179.5-second video could pass automatically.
- **Root cause:** Media probing checked only the competition's hard limit and audio/video streams without connecting actual media to the verified 150–170-second strategy and 168-second storyboard.
- **Fix:** Actual media must now be 150–170 seconds by default. Final mode also requires ffprobe duration within ±0.5 seconds of `storyboard.totalSeconds`, while retaining real audio/video streams and a strict under-180-second limit.
- **Lesson:** Plans and final-artifact checks must validate their relationship, not merely pass independently. The release gate must prove that the deliverable matches the approved plan.

### 2. Frame inspection catches language leaks missed by tests

- **Symptom:** In the English product and demo, the replanned Session notice still showed two Chinese warnings.
- **Root cause:** Chinese messages remained in the domain reducer. Existing tests checked structured warning codes but did not assert final user-facing copy.
- **Fix:** Added failing English-message assertions for real infeasible replanning, translated both warnings, rerecorded Hosted footage, and inspected key frames.
- **Lesson:** Automated E2E proves workflow completion but cannot replace frame-by-frame final-video inspection. User-facing errors also belong in behavior tests.

### 3. Generated-language requirements must exclude verbatim evidence fields

- **Symptom:** The prompt required all `sourceText` fields to copy input verbatim while requiring all human-readable values in English, creating a conflict for non-English recipes.
- **Root cause:** Language rules did not distinguish generated values from evidence carriers. Backend validation safely rejected altered `sourceText`, but conflicting instructions could still mislead the model.
- **Fix:** Limited English requirements to generated readable fields and inference reasons, explicitly excluding verbatim `sourceText` and `evidence.text`, and added a Chinese-source regression test.
- **Lesson:** Output language and source fidelity are separate constraints in structured extraction. Their precedence and exempt fields must be explicit.

## 2026-07-19 [Local AI live-environment gate] Task 18

### 1. Permission configuration must be parsed by the real Codex CLI

- **Symptom:** Unit tests checking argument shapes passed, but the real Codex CLI returned a `FilesystemPermissionToml` parsing error, leaving Local AI at `SANDBOX_UNAVAILABLE`.
- **Root cause:** Placing `:root`, `:minimal`, and `:workspace_roots` directly into dotted `--config` keys did not reliably express colon-containing TOML path keys.
- **Fix:** Passed the entire filesystem permission configuration as one inline table, retaining root denial, read-only minimal runtime/workspace, and disabled networking. Verified with the real CLI canary on WSL/Linux.
- **Lesson:** String snapshots are insufficient for security configuration. The target CLI version must parse it, and OS boundary behavior must pass the canary.

### 2. Sandbox-hidden paths may produce `ENOENT`

- **Symptom:** Linux bubblewrap hid files outside the workspace, but the probe accepted only `EACCES`/`EPERM` and incorrectly reported valid isolation as failure.
- **Root cause:** OS sandboxes report invisible paths differently; hidden mounts often return `ENOENT`.
- **Fix:** Accepted `ENOENT` as a candidate denial result, then reread the fixed canary from the host after sandbox exit and checked its contents, preventing a genuinely missing file from being mistaken for isolation.
- **Lesson:** Cross-platform canaries should verify capability outcomes instead of a single errno. Broadening accepted errors requires host-side counterchecks.

### 3. Evidence prompts must specify nested sourceText and index formulas

- **Symptom:** The first real `gpt-5.6-terra` response had correct evidence offsets but shortened ingredient/step `sourceText` to excerpts, so the business gate rejected it with `EVIDENCE_MISMATCH`.
- **Root cause:** The prompt said to retain complete sourceText without explicitly covering root, ingredient, and step fields or explaining evidence calculations and uncertainty fallback.
- **Fix:** Required every nested `sourceText` to repeat the complete input verbatim and `end = start + evidence.text.length`. Uncertain spans must use inferred status, empty evidence, and a concrete reason. The real Terra RecipeDraft gate then passed.
- **Lesson:** Structured-output schemas constrain shape. Cross-field equality, relative indexes, and evidence authenticity still require clear prompts and deterministic validators. Never fall back to fixtures and claim success.

## 2026-07-19 [Complete demo domain workflow] Task 9

### 1. Nutrition records must identify specific official entries

- **Record:** 2026-07-19 01:26 by Codex — Recorded a traceability gap found during nutrition-source review.
- **Symptom:** The catalog initially linked only to the USDA FoodData Central homepage, and the corresponding official entry did not support “red onion, 32 kcal/100g.”
- **Root cause:** Demo values were chosen before source verification. Source fields passed format checks without proving that name, food state, and calories came from the same record.
- **Fix:** Linked each record to a unique FDC ID page, replaced the mismatched red onion with sweet onion from FDC 170008, and documented rounding for the red sweet pepper Foundation energy value.
- **Lesson:** Verify name, state, value, and record ID before locking nutrition-fixture totals. A database homepage is not per-item provenance.

### 2. Text evidence must be anchored to the current semantic line

- **Record:** 2026-07-19 01:26 by Codex — Recorded evidence misalignment caused by repeated amounts and temperatures.
- **Symptom:** Repeated `6 g` and `200 C` values could point to an earlier ingredient or preheating step while still passing root-text slice validation.
- **Root cause:** Evidence lookup used the first whole-document match without restricting it to the current ingredient or step line.
- **Fix:** Scoped ingredient amounts and step source fields to their corresponding lines, with regression tests for repeated values and roasting temperatures.
- **Lesson:** Evidence correctness requires more than text existence; the text must belong to the current field's semantic context.

### 3. Persistence recovery must recompute derived state and reject malformed snapshots

- **Record:** 2026-07-19 01:26 by Codex — Recorded browser-snapshot boundaries and state-machine closure decisions.
- **Symptom:** Permissive recovery could accept malformed nested settings, incomplete summaries, or phase combinations the reducer could never produce normally.
- **Root cause:** Validation checked only top-level versions and field presence, excluding nested structures, phase invariants, and derived results from the trust boundary.
- **Fix:** Strictly validate nested snapshots, recompute plans through the public builder, replay session events, and constrain the flow to setup → review → plan → cook → summary.
- **Lesson:** Client storage is untrusted input. Recovery must validate structure, derived consistency, and reachable state, safely returning to the seed on failure.

## 2026-07-19 [Setup page accessibility] Task 10

### 1. Local control rules can override global focus rings

- **Record:** 2026-07-19 02:34 by Codex — Recorded a keyboard-focus gap found in independent setup-page review.
- **Symptom:** Although the page defined `:focus-visible`, later form-control `outline: none` rules hid keyboard focus on radios, inputs, and selects. The original saffron color also had less than 3:1 contrast against the paper background.
- **Root cause:** Review checked design tokens and global rules without verifying final computed styles and actual keyboard paths.
- **Fix:** Removed outline overrides, used a darker `--focus` token, added adjacent-element focus rings to mode cards, and verified contrast, CSS gates, and real keyboard navigation together.
- **Lesson:** Focus visibility requires final cascade, contrast, and real Tab-path verification; merely finding `:focus-visible` in source is insufficient.

### 2. Cross-field validation must attach recovery guidance to the field that failed

- **Record:** 2026-07-19 02:34 by Codex — Recorded the service-time combination validation accessibility fix.
- **Symptom:** Clearing `Available from` initially associated the error only with `Dinner lands` through `aria-describedby`, leaving screen-reader users without recovery guidance on the missing field.
- **Root cause:** One `timesValid` boolean represented three different conditions: missing start time, missing service time, and invalid time order.
- **Fix:** Separated start/service presence checks from ordering. Each field now has its own `aria-invalid` and description; ordering errors belong only to service time.
- **Lesson:** Combined constraints may share a final gate, but field errors must map to actionable inputs and specific recovery copy.

## 2026-07-19 [Local AI batch identity integrity] Task 11

### 1. Valid individual structures do not guarantee unique batch identities

- **Record:** 2026-07-19 04:06 by Codex — Recorded why Local AI output needs additional identity constraints at aggregation boundaries.
- **Symptom:** Two drafts independently passing schema/evidence checks could reuse a recipe ID. Duplicate ingredient or step IDs within one draft could also make Review keys, reducer targeting, and later dependency references ambiguous.
- **Root cause:** Existing validation checked each object's shape, provenance, and evidence without enforcing uniqueness within arrays or across the batch.
- **Fix:** Strict single-draft schemas reject duplicate ingredient/step IDs. Server Codex batch parsing and the frontend Local AI helper reject recipe-ID duplicates across drafts and enforce batch-wide step-ID uniqueness. Snapshot recovery applies the same aggregate constraints. Prompts explicitly state uniqueness scopes, and all violations fail safely.
- **Lesson:** Model output connected to UI, reducers, or dependency graphs by IDs requires both individual validation and aggregate uniqueness checks, enforced on both server and consumer boundaries.

### 2. Invalidating derived confirmation must also clear local component selections

- **Record:** 2026-07-19 04:23 by Codex — Recorded disagreement between nutrition-review component state and domain state.
- **Symptom:** Editing an ingredient reset old nutrition confirmation to unresolved in the reducer, but NutritionMatch could retain its radio selection, allowing reconfirmation without making a new choice.
- **Root cause:** The reducer managed derived domain state while component `useState` managed candidate selection. Resetting one did not automatically clear the other.
- **Fix:** Observe transitions from confirmed to unresolved with an empty reference and clear candidate selection. Preserve active unsubmitted selections, and add a regression requiring reselection after invalidation.
- **Lesson:** Invalidating derived results must include temporary UI state that could bypass renewed confirmation, not merely backend or reducer fields.

### 3. Untrusted domain IDs must not directly become DOM identifiers

- **Record:** 2026-07-19 04:23 by Codex — Recorded identifier separation from the Review accessibility audit.
- **Symptom:** Model-generated recipe, ingredient, and step IDs used directly as DOM `id`, radio `name`, or ARIA references could collide with landmarks; duplicate or crafted values could break label relationships.
- **Root cause:** Domain identity and document identity cross different trust boundaries but were reused as if interchangeable.
- **Fix:** Keep domain IDs only for reducer/dependency mapping. Generate DOM relationships and radio groups with React `useId()`, validate domain-ID uniqueness at consumption, and test adversarial collisions to ensure all DOM IDs remain unique.
- **Lesson:** External or model-generated IDs can be validated business keys without automatically being allowed as DOM, CSS, or ARIA identifiers.

## 2026-07-19 [Planning, cooking, and recovery workflow] Task 12

### 1. Accelerated demos must reuse real command entry points

- **Record:** 2026-07-19 04:58 by Codex — Recorded the decision for 60× replay and the real cooking state machine to share event paths.
- **Symptom:** Directly constructing a final Summary made the page look complete without proving that normal interaction produced delays, resource occupancy, replanning, and the event ledger.
- **Root cause:** Treating shorter waits as permission to bypass domain processing creates a second business-logic path unlike real buttons.
- **Fix:** Replay computes `START`, `DELAY`, or `COMPLETE` from the next event time, permits conflict-free parallel tasks, and sends events through the Cook page's same dispatcher. The controller maintains a mirror session with the same domain functions; the reducer reaches Summary only after every task actually completes. The replay cursor is clamped to the current Cook clock, preventing past-event backfilling after waiting or recovery. The fixed eight-minute delay now yields 19:08 instead of an artificial serial-replay 19:57.
- **Lesson:** Demo acceleration may change event spacing, not event semantics, validation entry points, parallel relationships, or completion conditions.

### 2. Refresh recovery must validate before hydration and read before writing

- **Record:** 2026-07-19 04:58 by Codex — Recorded browser-recovery boundaries for active cooking sessions.
- **Symptom:** Saving initial setup on mount could overwrite an existing Cook snapshot. Trusting `localStorage` directly could inject malformed phases or fabricated derived results into the reducer.
- **Root cause:** Persistence effects did not distinguish unhydrated state from save-ready state, and browser storage is untrusted input.
- **Fix:** Use the strict persistence adapter to validate nested structures, recompute the plan, and replay the session before injecting a dedicated validated restore action. Save only after hydration. Persist a wall-clock anchor for virtual cooking time so background throttling or refresh projects actual elapsed time into `running`/`due`, never automatic `complete`, and clearly announces recovery.
- **Lesson:** Refresh recovery must preserve read order, trust boundaries, and time semantics. Deserialization alone is not recovery.

### 3. Phase-transition focus must handle asynchronous button-unmount races

- **Record:** 2026-07-19 04:58 by Codex — Recorded the fix for intermittent Summary-heading focus loss after accelerated replay.
- **Symptom:** Summary rendered, but unmounting the replay button with Cook could cause the browser to return focus to `body`.
- **Root cause:** Ordinary effects raced with asynchronous click completion and old-node unmounting.
- **Fix:** Summary uses a layout effect to focus its heading during commit, retaining the semantic `tabIndex=-1` focus target.
- **Lesson:** Cross-page focus tests must verify final `activeElement` under real asynchronous interaction and unmount order, not just that a node appears.

### 4. Summary suggestions must be attributable to explicit delay events

- **Record:** 2026-07-19 09:34 by Codex — Recorded incorrect attribution of cumulative lateness found in replay review.
- **Symptom:** Old logic described downstream cumulative lateness as a step needing about 57 minutes of buffer, hiding the only actual injected delay: eight minutes of chicken roasting.
- **Root cause:** Ranking only `actualEnd - initial.plannedEnd` combined dependency waits, resource handoffs, and a step's own delay into one value.
- **Fix:** Derive suggested delay amounts only from explicit `TASK_DELAYED` events, then verify affected paths through explicit dependencies and zero-gap resource handoffs. Without a Delay event, do not invent a step buffer.
- **Lesson:** Event ledgers establish what happened. Derived lateness describes results but cannot substitute for causal attribution.

### 5. Persistence across separate keys needs a shared revision

- **Record:** 2026-07-19 09:58 by Codex — Recorded the fix for planner-snapshot and UI-time-context mismatches.
- **Symptom:** Planner state and source/virtual-clock context were written to two separate `localStorage` keys. A crash or quota error could save only half, applying a new source and clock to an old plan.
- **Root cause:** Independent writes shared no transaction identifier, so recovery could validate each structure without proving they came from one save.
- **Fix:** Each planner save generates a UUID v4 revision, also stored in the context. Recovery accepts only strictly matching pairs. Partial or legacy writes fall back to unknown provenance and recover the clock from the last verified event. Provenance also remains unknown before hydration, avoiding a false Hosted label on the first frame.
- **Lesson:** Browser storage has no cross-key transaction. Related snapshots need at least a shared revision/fingerprint, treating mismatches as ordinary recoverable failures.

### 6. Server and browser time text need deterministic hydration boundaries

- **Record:** 2026-07-19 09:58 by Codex — Recorded the hydration-mismatch fix for local time-zone display.
- **Symptom:** The server formatted task times in its deployment time zone while the browser used the user's zone, producing different initial `<time>` text and hydration warnings or flicker.
- **Root cause:** Local time zone is browser environment information but was evaluated during SSR.
- **Fix:** SSR and initial hydration use deterministic placeholders; browser-local times appear after hydration. Replay `aria-busy` now wraps only locked task areas so live startup announcements outside them remain audible.
- **Lesson:** Client-dependent display values must distinguish server and browser snapshots. Busy semantics should cover only regions whose updates are actually paused.

### 7. Resource-causality edges must account for consumed slack and actual order

- **Record:** 2026-07-19 09:58 by Codex — Recorded Summary delay-attribution boundaries when slack is nonzero.
- **Symptom:** Connecting only zero-gap adjacent resource tasks missed cases where an eight-minute delay consumed five minutes of slack and delayed a successor by three minutes. Reusing initial order also misattributed delays after replanning.
- **Root cause:** Static plan adjacency was treated as actual resource causality without combining explicit delay, original slack, and current/actual execution order.
- **Fix:** Build resource order from actual start times or the current replan. Add causal edges for resource handoffs and explicit dependencies only when delay exceeds original slack and actually postpones the successor. Added counterexamples for absorbed slack and reversed order.
- **Lesson:** Critical-path attribution must establish who used a resource first, whether delay exceeded slack, and whether the successor was actually postponed; matching planned endpoints alone is insufficient.
