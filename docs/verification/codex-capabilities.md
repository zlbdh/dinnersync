# Codex CLI 能力核验

核验时间：2026-07-18（Asia/Shanghai）
核验环境：Windows x64、Node.js 22.20.0、Codex CLI 0.144.4

## 只读发现

执行了以下命令，输出只记录非敏感结论：

```text
codex --version       -> codex-cli 0.144.4
codex login status    -> Logged in using ChatGPT
codex exec --help     -> exit 0
```

当前 `exec --help` 明确列出了本项目所需参数：`--model`、`--sandbox`
（包含 `read-only`）、`--ephemeral`、`--ignore-user-config`、`--ignore-rules`、
`--strict-config`、`--config`、`--output-schema`、`--output-last-message`、
`--skip-git-repo-check` 与 `--cd`。Prompt 可通过 stdin 的 `-` 传入。

## 精确模型能力门禁

使用全新隔离目录、`read-only` sandbox、ephemeral 会话以及
`additionalProperties: false` 的严格 `{ok: true}` JSON Schema 分别实测：

| 精确模型 ID | 退出码 | `output-last-message` | 结论 |
| --- | ---: | --- | --- |
| `gpt-5.6-sol` | 0 | `{"ok":true}` | 通过 |
| `gpt-5.6-terra` | 0 | `{"ok":true}` | 通过 |

因此当前允许列表只包含上表两个精确 ID。调用方必须显式传入其中一个 ID；
runner 不会静默切换或回退模型。最初的发现 schema 仅写 `const` 时，服务端明确
要求属性同时提供 `type`；最终门禁与烟雾测试均使用 `type: boolean` 加 `const: true`。

同一安全 runner 的最终 smoke 结果：

```text
npm run smoke:codex                                                   -> PASS: gpt-5.6-terra structured output
$env:DINNERSYNC_CODEX_MODEL='gpt-5.6-sol'; npm run smoke:codex        -> PASS: gpt-5.6-sol structured output
```

## Windows 启动器实测说明

本机 npm shim 是 `codex.cmd`。Node.js 22 使用
`spawn("codex.cmd", ..., {shell: false})` 会立即返回 `EINVAL`；这是一项本机组合的
实测结果，不是 Codex CLI 的官方跨平台保证。为坚持“不拼 shell”，runner 在 Windows
选择全局 `@openai/codex` 包内的原生 `codex.exe`，并允许通过
`DINNERSYNC_CODEX_EXECUTABLE` 显式指定绝对 `.exe` 路径。非 Windows 使用 `codex`。

本机 PATH 中的 WindowsApps `codex.exe` 别名经 Node 直接启动返回 `EPERM`，而 npm
包内原生二进制可用 `shell: false` 启动并报告同一 CLI 版本。上述路径布局同样只是
当前安装方式的实测，不应解释为官方稳定接口。

## 安全边界与已知局限

- runner 的 cwd 是项目外新建的临时目录；schema 与最终结果都只存在于该目录，且
  `finally` 清理。
- 模型运行于 `read-only`，忽略用户配置与 rules，采用 ephemeral 会话；prompt 只走
  stdin，不进入命令参数。
- `shell_environment_policy.inherit="none"` 经 `--strict-config` 传入；最终真实 smoke
  成功才视为此组合在当前 CLI 可用。
- stdout 与 stderr 在进程存活期间按流式字节上限处理。`resultPath` 在进程存活期间采用
  轻量轮询做 best-effort 大小监测，一旦观察到超限便进入同一进程树终止流程；这不是
  OS 硬配额，不能保证在两次轮询之间阻止瞬时增长。进程退出后，runner 会在同一文件
  handle 上执行初始 `stat`、有界循环读取到 EOF 和最终 `stat`，严格拒绝超限或大小变化。
- 超时、取消或超限时会向直接 child 请求 `SIGTERM`，并立即启动树级强制终止：POSIX
  对独立进程组发送 `SIGKILL`，Windows 通过 `taskkill.exe /PID <pid> /T /F` 处理目标
  进程树。这里为封闭直接 child 提前退出、孙进程仍存活的竞态，安全优先，不提供额外
  宽限期。只有直接 child 已 close 且树级动作成功，才会标记 `terminationConfirmed: true`；
  树动作失败、超时或无法确认时保留首个错误码，并明确标记 `terminationConfirmed: false`。
- 错误不回传 prompt、原始 stderr、认证信息或本地路径；清理失败只附加脱敏诊断。
- CLI 在本机报告 models cache 字段兼容性告警和 PowerShell shell snapshot 告警，但两次
  精确模型调用仍以退出码 0 返回合规结构化结果。若后续升级 CLI，必须重新执行本门禁。
- 这里只验证 CLI 登录、精确模型和 structured output。RecipeDraft/EvidenceSpan 的真实
  业务门禁属于后续任务，不能由本 smoke 代替。
