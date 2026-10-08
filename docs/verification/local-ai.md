# Local AI Business Gate Status

Verified: July 19, 2026, 11:08 a.m. (Asia/Shanghai)

## Current conclusion

DinnerSync's real Local AI RecipeDraft gate passed on WSL/Linux. The verification environment was
Ubuntu 24.04 (WSL), Node.js 22.22, and Codex CLI 0.144.4, reusing the user's signed-in ChatGPT
Codex session. The sequence was strictly:

1. Run the model-free OS sandbox canary first.
2. Only after the canary exits with code 0, call the exact model `gpt-5.6-terra`.
3. After receiving the real RecipeDraft, validate JSON Schema, Zod, batch identity, and UTF-16 source
   evidence.

The real import took about 57 seconds and entered Review. Returned metadata showed
`provider: openai-codex-cli` and `model: gpt-5.6-terra`, with schema and source evidence
both checked. All model fields remained `needs-review`; this PASS does not mean the system automatically confirmed model content.

```text
npm run test:codex-sandbox                         -> PASS (WSL/Linux, actual exit 0)
DINNERSYNC_CODEX_MODEL=gpt-5.6-terra npm run test:codex-real
                                                   -> PASS (real RecipeDraft gate)
```

Skipped quota-consuming tests in default `npm test` were not counted as real passes, and no claim was made that
`gpt-5.6-sol` passed the RecipeDraft business gate.

## Difference from historical smoke tests

Task 2 previously ran strict `{ "ok": true }` structured-output smoke tests using the exact model IDs
`gpt-5.6-terra` and `gpt-5.6-sol`; both exited with code 0. Those records prove only that model
selection and structured output worked then. The old `read-only` sandbox did not prevent host-file reads,
so it cannot substitute for the current OS canary or RecipeDraft, evidence, and batch-identity gates.

## Platform differences and fail-closed behavior

On the same machine, native Windows elevated sandboxing still could not deny access to the nonsensitive external canary. The native
Windows path therefore consistently returned `SANDBOX_UNAVAILABLE` and stopped before model launch. Real WSL/Linux
sandboxing hid the external canary. Linux may express that isolation as `ENOENT`, rather than only
`EACCES`/`EPERM`. The runner accepts all three denial forms and rereads the canary from the host after the sandbox exits
to confirm that it still exists and has not changed.

Dedicated filesystem permissions must be passed to Codex CLI as one inline table. Splitting colon-containing keys into
separate dotted arguments fails `FilesystemPermissionToml` parsing. The current implementation still denies root access,
allows read-only minimal runtime and temporary workspace access, and disables networking.

## Rerun commands

Every new environment must first pass the model-free canary:

```bash
npm run test:codex-sandbox
```

Only after an actual exit code of 0 may you explicitly choose a model and run the quota-consuming business gate:

```bash
DINNERSYNC_CODEX_MODEL=gpt-5.6-terra npm run test:codex-real
```

`test:codex-real` sets `RUN_REAL_CODEX=1`. Missing or wrong models, quota limits, schema/evidence
violations, timeouts, output overflow, and runner failures all produce nonzero exits. Never bypass a failed canary.
