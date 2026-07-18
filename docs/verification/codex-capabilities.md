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

当前 `exec --help` 明确列出了本项目所需参数：`--model`、`--ephemeral`、
`--ignore-user-config`、`--ignore-rules`、
`--strict-config`、`--config`、`--output-schema`、`--output-last-message`、
`--skip-git-repo-check` 与 `--cd`。Prompt 可通过 stdin 的 `-` 传入。

## 2026-07-18 安全复核更新

后续安全复核确认，旧的 `--sandbox read-only` 只限制写入，不能阻止模型读取宿主文件，
因此旧 smoke 不能证明 Local AI 具备安全文件隔离，runner 已不再使用该模式。

当前实现改用专用 named permission profile：根目录拒绝、仅最小运行时与临时工作目录可读、
网络禁用，并显式禁用 shell、shell snapshot、unified exec、browser、apps、plugins、
computer use 与 workspace dependencies 等工具族。runner 在任何模型进程启动前，必须先用
同一 profile 执行无模型 canary：临时工作目录内的无敏感文件必须可读，目录外的无敏感
canary 必须被 OS 拒绝。
该专用 canary 位于 `public/dinnersync-sandbox-canary.txt`，只含固定无敏感文本；部署时
必须随 `public` 一起复制。文件缺失或内容不符同样 fail closed。

本机 Codex CLI 0.144.4 的 Windows elevated sandbox 仍能读取目录外 canary，故能力门禁
正确失败：

```text
npm run test:codex-sandbox -> FAIL: SANDBOX_UNAVAILABLE（exit 1）
```

这不是测试误报，也不能绕过。status 与 import 都返回稳定的 `SANDBOX_UNAVAILABLE`，
真实解析在调用模型前停止。只有 CLI/OS 更新后该 canary 真实退出 0，才允许重新执行消费
额度的模型门禁。

完整 `codex exec` argv 另以本机 mock provider 做了无额度解析检查：permission 配置、
全部 `--disable`（含 `shell_snapshot`）和 `--strict-config` 均成功解析并到达本地
`/v1/responses`。该检查只证明参数可解析，不能替代 OS canary，也不会正向放行。

## 精确模型能力门禁

以下历史记录使用全新临时目录、旧 `read-only` sandbox、ephemeral 会话以及
`additionalProperties: false` 的严格 `{ok: true}` JSON Schema 分别实测：

| 精确模型 ID | 退出码 | `output-last-message` | 结论 |
| --- | ---: | --- | --- |
| `gpt-5.6-sol` | 0 | `{"ok":true}` | 通过 |
| `gpt-5.6-terra` | 0 | `{"ok":true}` | 通过 |

这些记录只证明当时的模型 ID 与 structured output 可用，不证明当前安全门禁通过。
允许列表只包含上表两个精确 ID；调用方必须显式传入其中一个 ID；
runner 不会静默切换或回退模型。最初的发现 schema 仅写 `const` 时，服务端明确
要求属性同时提供 `type`；最终门禁与烟雾测试均使用 `type: boolean` 加 `const: true`。

旧 runner 的历史 smoke 结果（不得作为当前安全 PASS）：

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
- 模型进程仅在无模型 OS canary 通过后才可启动；当前 Windows 实测不通过，因此
  fail closed。named profile 不能仅凭配置解析成功或 prompt 声明视为安全。
- 执行参数忽略用户配置与 rules，采用 ephemeral 会话；prompt 只走 stdin，不进入命令
  参数。`shell_environment_policy.inherit="none"`、权限配置和工具禁用项经
  `--strict-config` 传入；`shell_snapshot` 也被显式禁用。
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
- CLI 或 Windows sandbox 后续升级时，必须先重新执行无模型 canary；不得直接重跑真实
  模型或沿用历史 PASS。
- 这里只验证 CLI 登录、精确模型和 structured output。RecipeDraft/EvidenceSpan 的真实
  业务门禁属于后续任务，不能由本 smoke 代替。
