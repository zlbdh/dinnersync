# Local AI 业务门禁状态

核验日期：2026-07-18（Asia/Shanghai）

## 已真实通过的基础能力

Task 2 在提交 `355078c` 之前，已分别使用精确模型 ID `gpt-5.6-terra` 与
`gpt-5.6-sol` 真实执行严格 `{ "ok": true }` structured-output 门禁；两次均退出码
0，且结果符合 `additionalProperties: false` schema。该记录只证明 Codex CLI、精确
模型选择和 structured output 可用，不等同于 RecipeDraft 业务门禁通过。

上述历史运行使用的 `read-only` sandbox 后来被证实不能阻止读取宿主文件，因此也不等同
于当前安全门禁通过。当前 runner 会在模型启动前执行无模型 OS canary；本机 Windows
sandbox 无法拒绝目录外的无敏感 canary，故 `npm run test:codex-sandbox` 稳定返回
`SANDBOX_UNAVAILABLE` 和非零退出。status/import 会明确返回同一稳定码，不能绕过。

## RecipeDraft 业务门禁当前阻塞

本账户额度当前耗尽，外部服务返回 `usage limit reached`，预计恢复时间为
2026-07-25 12:02；该时间晚于本次比赛截止时间。因此本任务没有再次调用或重试真实
模型，也没有把跳过的消费型测试记录成 PASS。

`tests/integration/codex-recipe-real.test.ts` 已通过 fake runner 测试证明以下接线：精确
允许列表模型原样传递、严格 AI JSON Schema、RecipeDraft/Zod + 根 UTF-16 evidence
validator、原始英文菜谱 prompt、有界超时与输出上限。普通 `npm test` 会明确把真实用例
列为 skipped；fake 接线通过不代表真实业务门禁通过。

## 隔离修复且额度恢复后的补跑命令

必须先运行 `npm run test:codex-sandbox` 并取得真实 exit 0。当前结果为 exit 1 时，禁止
调用真实模型；历史 structured-output PASS 不能替代此门禁。

在已登录 Codex CLI 的本机 PowerShell 中显式选择一个经过核验的模型，再运行：

```powershell
$env:DINNERSYNC_CODEX_MODEL='gpt-5.6-terra'
npm run test:codex-real
```

也可把精确模型改为 `gpt-5.6-sol`。`test:codex-real` 会显式设置
`RUN_REAL_CODEX=1`；此时真实用例绝不 skip，缺少/错误模型、额度限制、schema/evidence
不合规、超时或 runner 失败都会令命令非零退出。只有命令真实退出 0，才可在本文新增
“RecipeDraft 业务门禁 PASS”记录。
