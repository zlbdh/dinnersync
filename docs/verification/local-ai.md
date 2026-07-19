# Local AI 业务门禁状态

核验时间：2026-07-19 11:08（Asia/Shanghai）

## 当前结论

DinnerSync 的真实 Local AI RecipeDraft 门禁已在 WSL/Linux 环境通过。核验环境为
Ubuntu 24.04（WSL）、Node.js 22.22、Codex CLI 0.144.4，并复用用户已登录的 ChatGPT
Codex 会话。执行顺序严格保持为：

1. 先运行不调用模型的 OS sandbox canary；
2. canary 退出 0 后，才允许调用精确模型 `gpt-5.6-terra`；
3. 真实 RecipeDraft 返回后，再执行 JSON Schema、Zod、批次身份与 UTF-16 source evidence
   校验。

本次真实导入用时约 57 秒，最终进入 Review，返回元数据显示
`provider: openai-codex-cli`、`model: gpt-5.6-terra`，并显示 schema 与 source evidence
均已检查。所有模型字段仍保持 `needs-review`；该 PASS 不代表模型内容由系统自动确认。

```text
npm run test:codex-sandbox                         -> PASS（WSL/Linux，真实 exit 0）
DINNERSYNC_CODEX_MODEL=gpt-5.6-terra npm run test:codex-real
                                                   -> PASS（真实 RecipeDraft 门禁）
```

没有把默认 `npm test` 中被跳过的消费型测试当作真实 PASS，也没有声称
`gpt-5.6-sol` 已通过 RecipeDraft 业务门禁。

## 与历史 smoke 的区别

Task 2 曾分别使用精确模型 ID `gpt-5.6-terra` 与 `gpt-5.6-sol` 运行严格
`{ "ok": true }` structured-output smoke；两次均退出 0。该历史记录只证明当时的模型
选择与 structured output 可用。旧运行使用的 `read-only` sandbox 不能阻止读取宿主文件，
因此不能替代当前 OS canary，也不能替代 RecipeDraft、evidence 与批次身份门禁。

## 平台差异与 fail-closed 行为

同一台机器的原生 Windows elevated sandbox 仍无法拒绝目录外的无敏感 canary，故原生
Windows 路径稳定返回 `SANDBOX_UNAVAILABLE` 并在模型启动前停止。WSL/Linux 的真实
sandbox 能隐藏目录外 canary；Linux 可能以 `ENOENT` 表达这种隐藏，而不是只返回
`EACCES`/`EPERM`。runner 接受这三种拒绝表现，并在 sandbox 结束后从宿主侧再次读取
canary，确认它仍存在且内容未被修改。

专用 filesystem 权限必须以一张 inline table 传给 Codex CLI；把带冒号的 key 拆成
多个 dotted CLI 参数会触发 `FilesystemPermissionToml` 解析失败。当前实现同时保持根目录
拒绝、最小运行时只读、临时工作区只读和网络禁用。

## 复跑命令

任何新环境都必须先通过无模型 canary：

```bash
npm run test:codex-sandbox
```

只有它真实退出 0 后，才可显式选择模型并运行消费额度的业务门禁：

```bash
DINNERSYNC_CODEX_MODEL=gpt-5.6-terra npm run test:codex-real
```

`test:codex-real` 会设置 `RUN_REAL_CODEX=1`；缺少或错误模型、额度限制、schema/evidence
不合规、超时、输出超限或 runner 失败都会令命令非零退出。任何 canary 失败都禁止绕过。
