# Codex CLI Capability Verification

Verification period: July 18–19, 2026 (Asia/Shanghai)
Environment: Windows x64 / WSL Ubuntu 24.04, Node.js 22.20.0 / 22.22, Codex CLI 0.144.4

## Read-only discovery

The following commands were run, recording only nonsensitive conclusions:

```text
codex --version       -> codex-cli 0.144.4
codex login status    -> Logged in using ChatGPT
codex exec --help     -> exit 0
```

The current `exec --help` explicitly lists the required flags: `--model`, `--ephemeral`,
`--ignore-user-config`、`--ignore-rules`、
`--strict-config`、`--config`、`--output-schema`、`--output-last-message`、
`--skip-git-repo-check`, and `--cd`. Prompts can be passed through stdin with `-`.

## July 18, 2026 security review update

A subsequent security review confirmed that the old `--sandbox read-only` restricts writes but does not prevent reading host files.
The old smoke test therefore does not prove safe Local AI file isolation, and the runner no longer uses that mode.

The implementation now uses a dedicated named permission profile: deny the root filesystem, allow reads only of the minimal runtime and temporary workspace,
disable networking, and explicitly disable shell, shell snapshots, unified exec, browser, apps, plugins,
computer use, and workspace dependencies. Before starting any model process, the runner must execute
a model-free canary under the same profile: nonsensitive files inside the temporary workspace must be readable,
while the operating system must deny access to the nonsensitive canary outside it.
The dedicated canary at `public/dinnersync-sandbox-canary.txt` contains only fixed nonsensitive text and must be
copied with `public` during deployment. Missing files or unexpected contents also fail closed.

On this machine, the Codex CLI 0.144.4 Windows elevated sandbox could still read the external canary, so the capability gate
correctly failed:

```text
npm run test:codex-sandbox -> FAIL: SANDBOX_UNAVAILABLE（exit 1）
```

This is not a false positive and must not be bypassed. Both status and import return stable `SANDBOX_UNAVAILABLE`,
stopping real parsing before any model call. A quota-consuming model gate may run again only after a CLI/OS update
makes the real canary exit with code 0.

The complete `codex exec` argument list was also checked without quota consumption using a local mock provider. Permission configuration,
all `--disable` flags (including `shell_snapshot`), and `--strict-config` parsed successfully and reached the local
`/v1/responses` endpoint. This proves only argument parsing, not OS isolation, and does not authorize execution.

## July 19, 2026 WSL/Linux gate

Subsequent testing found that filesystem permission keys `:root`, `:minimal`, and `:workspace_roots` cannot be split into
separate colon-containing dotted CLI arguments. The entire filesystem configuration must be passed as one inline table.
With that correction, the OS canary ran under the same Codex CLI 0.144.4 on WSL Ubuntu 24.04. Files inside the temporary
workspace were readable, the sandbox hid the external canary, and the actual command exited with code 0.

Linux sandboxing may report `ENOENT` for hidden external files. The runner therefore accepts `ENOENT`,
`EACCES`, or `EPERM`, then rereads the fixed canary outside the sandbox to verify that it still exists and its contents
are unchanged, preventing deletion or corruption from being mistaken for successful isolation.

Only after that canary passed did the runner call the exact model `gpt-5.6-terra`. On July 19, 2026 at 11:08
(Asia/Shanghai), RecipeDraft import passed strict JSON Schema, Zod, batch identity, and UTF-16
source-evidence validation and entered Review. `gpt-5.6-sol` still has only historical structured-output smoke
evidence; this document does not claim that it passed the RecipeDraft business gate.

## Exact-model capability gate

The following historical runs used fresh temporary directories, the old `read-only` sandbox, ephemeral sessions, and
a strict `{ok: true}` JSON Schema with `additionalProperties: false`:

| Exact model ID | Exit code | `output-last-message` | Result |
| --- | ---: | --- | --- |
| `gpt-5.6-sol` | 0 | `{"ok":true}` | Passed |
| `gpt-5.6-terra` | 0 | `{"ok":true}` | Passed |

These records show only that those model IDs and structured output worked at the time; they do not prove the current security gate passes.
The allowlist contains only the two exact IDs above. Callers must explicitly provide one of them;
the runner never switches models or falls back silently. The initial discovery schema used only `const`, but the server explicitly
required `type` as well. Final gates and smoke tests therefore use both `type: boolean` and `const: true`.

Historical smoke results from the old runner (not evidence of current security acceptance):

```text
npm run smoke:codex                                                   -> PASS: gpt-5.6-terra structured output
$env:DINNERSYNC_CODEX_MODEL='gpt-5.6-sol'; npm run smoke:codex        -> PASS: gpt-5.6-sol structured output
```

## Windows launcher observations

The local npm shim is `codex.cmd`. With Node.js 22,
`spawn("codex.cmd", ..., {shell: false})` immediately returned `EINVAL`. This is an observation of this local combination,
not an official cross-platform Codex CLI guarantee. To avoid constructing shell commands, the Windows runner
selects the native `codex.exe` inside the global `@openai/codex` package and permits an explicit
absolute `.exe` path through `DINNERSYNC_CODEX_EXECUTABLE`. Non-Windows systems use `codex`.

Direct Node execution of the WindowsApps `codex.exe` alias on this machine's PATH returned `EPERM`, while the native npm-package
binary launched with `shell: false` and reported the same CLI version. These path layouts are also observations
of the current installation, not an officially stable interface.

## Security boundaries and known limitations

- The runner's cwd is a newly created temporary directory outside the project. Schema and final results exist only there and are
  cleaned up in `finally`.
- A model process may start only after the model-free OS canary passes. Native Windows testing failed closed,
  while WSL/Linux testing passed. Successful configuration parsing or prompt assertions alone do not establish profile safety.
- Execution ignores user configuration and rules and uses an ephemeral session. Prompts travel through stdin, never command-line
  arguments. `shell_environment_policy.inherit="none"`, permission configuration, and disabled tools are passed through
  `--strict-config`; `shell_snapshot` is explicitly disabled too.
- stdout and stderr are bounded by streaming byte limits while the process runs. Lightweight polling monitors `resultPath`
  on a best-effort basis; observing an oversized file invokes the same process-tree termination path. This is not an
  OS-enforced quota and cannot prevent transient growth between polls. After process exit, the runner uses the same file
  handle for an initial `stat`, bounded reads through EOF, and a final `stat`, strictly rejecting oversize files or size changes.
- Timeout, cancellation, or overflow requests `SIGTERM` for the direct child and immediately starts forced tree termination:
  POSIX sends `SIGKILL` to the separate process group; Windows uses `taskkill.exe /PID <pid> /T /F` on the target
  process tree. To close the race where the direct child exits before its descendants, safety takes priority and no extra
  grace period is provided. `terminationConfirmed: true` requires both direct-child closure and successful tree termination;
  failed, timed-out, or unconfirmed tree termination preserves the first error code and explicitly sets `terminationConfirmed: false`.
- Errors never return prompts, raw stderr, authentication information, or local paths. Cleanup failures add only redacted diagnostics.
- After any CLI or OS sandbox upgrade, rerun the model-free canary first. Never directly rerun real models
  or reuse a historical PASS.
- Historical smoke tests cover only CLI login, exact-model selection, and structured output. The current Terra
  RecipeDraft/EvidenceSpan PASS has separate real business-gate evidence; neither substitutes for the other.
