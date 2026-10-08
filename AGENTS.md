# DinnerSync Project Rules

## Communication and delivery language

- Use American English by default for internal plans, commit messages, and development collaboration.
- Interfaces, README files, demo video scripts, and Devpost materials for competition judges must use American English.
- Keep commands, code identifiers, protocols, and third-party library names in their original English form.

## File and module boundaries

- Ideally, files stay under 300 lines. Evaluate splitting files with 301–500 lines; justify files exceeding 500 lines. Files exceeding 1,000 lines must not be committed.
- Give each file one clear responsibility. Avoid large `utils.ts`, `helpers.ts`, and all-purpose components.
- Each domain module exposes its public API through `index.ts`; external callers must not import internal implementations directly.
- Put shared types in explicit schema or shared modules and avoid circular domain-module dependencies.
- Separate UI, domain logic, external adapters, and persistence. React components must not directly implement nutrition or scheduling algorithms.

## Domain correctness

- Treat GPT-5.6 output as untrusted input requiring JSON Schema/Zod validation and user confirmation.
- Models must not generate calorie or nutrient values directly. Compute them only from sourced nutrition records and deterministic formulas.
- Ingredients with no match, unknown units, or ambiguous raw/cooked state must remain pending confirmation and must not silently contribute to totals.
- Do not provide medical, weight-loss, or disease-specific dietary advice or promise that food is allergen-free or safe to eat.
- Cooking steps must retain supporting source-recipe evidence. Models must not invent doneness, temperature, or food-safety conclusions.
- Scheduling must detect dependency cycles, cook/equipment conflicts, and infeasible plans instead of fabricating on-time completion.

## Engineering quality

- Prefer pure TypeScript for domain modules, keeping them deterministic, serializable, and unit-testable.
- Write a failing test before adding behavior, then implement the smallest change that passes it.
- Track time with timestamps rather than accumulating `setInterval` calls.
- Run relevant tests, typecheck, and lint after changes; run complete verification before finishing.
- Never commit secrets, personal recipes, real health data, Codex session files, or local caches.

## Git rules

- Each commit contains one logical change.
- Use American English Conventional Commits, for example: `feat(schedule): add resource conflict detection`.
- Do not force-push, skip hooks, or perform destructive resets without explicit user authorization.
