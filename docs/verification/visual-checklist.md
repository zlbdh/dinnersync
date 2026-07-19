# DinnerSync 视觉验收清单

验收日期：2026-07-19

## 捕获环境

- Next.js production build 与 `next start`，不是开发模式页面。
- Chromium，`en-US` locale，UTC 时区，浅色主题，reduced motion。
- Hosted fixture；固定浏览器墙钟，未调用 Local AI。
- 页面截图仅包含应用 viewport，不包含浏览器工具栏、桌面或终端。

复现命令：

```powershell
npm.cmd run build
node scripts/capture-submission.mjs
```

脚本使用独立端口 `3211`，完成或失败后都会终止其精确进程树。可通过
`DINNERSYNC_CAPTURE_PORT` 覆盖端口。

## 自动验收结果

| 阶段 / viewport | 横向溢出 | 重复 ID | 阶段焦点 | 关键触控 | 时间线模式 |
|---|---:|---:|---|---|---|
| Setup · 1440×900 | 0 px | 0 | Setup 标题 | Try demo ≥44×44 | — |
| Review · 1440×900 | 0 px | 0 | Review 标题 | Build timeline ≥44×44 | — |
| Plan · 1440×900 | 0 px | 0 | Plan 标题 | Start cooking ≥44×44 | tracks=`grid`，compact=`none` |
| Plan · 1024×768 | 0 px | 0 | Plan 标题保持 | Start cooking ≥44×44 | tracks=`grid`，compact=`none` |
| Cook 重排 · 1440×900 | 0 px | 0 | Cook 标题 | Replay ≥44×44 | 可见 `Replanned` 标记 |
| Summary · 1440×900 | 0 px | 0 | Summary 标题 | Start another dinner ≥44×44 | — |
| Plan · 390×844 | 0 px | 0 | Plan 标题 | Start cooking ≥44×44 | tracks=`none`，compact=`grid` |

额外门禁：

- Desktop 与 mobile 的 console warning/error、`pageerror` 均为 0。
- Hosted 捕获过程中 `/api/local-ai/*`、外部 XHR/fetch、已知模型域名请求均为 0。
- Cook 截图前确认快照已记录 `TASK_DELAYED` 且 `delayMinutes: 8`，同时页面存在可见重排标记。
- Summary 焦点落在完成标题；画面显示计划 7:00 PM、实际 7:08 PM、晚 8 分钟及 25 次 replan。

## 提交截图

| 画面 | 文件 | 尺寸 | 目视结果 |
|---|---|---:|---|
| Setup | [setup-1440x900.png](../submission/assets/setup-1440x900.png) | 1440×900 | CTA、Hosted 状态与 service preview 清晰 |
| Review | [review-1440x900.png](../submission/assets/review-1440x900.png) | 1440×900 | reviewed fixture、首份菜谱与 decision ledger 清晰 |
| Plan timeline | [plan-timeline-1440x900.png](../submission/assets/plan-timeline-1440x900.png) | 1440×900 | 三菜并行时间线与营养卡清晰 |
| Plan tablet | [plan-timeline-1024x768.png](../submission/assets/plan-timeline-1024x768.png) | 1024×768 | 页面无横溢，轨道使用组件内滚动 |
| Cook 延误重排 | [cook-replanned-1440x900.png](../submission/assets/cook-replanned-1440x900.png) | 1440×900 | Replay running、当前/下一动作及 Replanned 标记清晰 |
| Summary | [summary-1440x900.png](../submission/assets/summary-1440x900.png) | 1440×900 | 7:00 / 7:08、8 分钟、1 次延误、25 次 replan 清晰 |
| Mobile plan | [mobile-plan-390x844.png](../submission/assets/mobile-plan-390x844.png) | 390×844 | compact chronological timeline 生效，无横溢 |

## 隐私与提交安全

逐张目视检查确认截图中没有：

- 用户名、邮箱或账户头像；
- token、密钥、服务器凭证或请求头；
- 本机绝对路径、终端内容或浏览器地址栏；
- Local AI 输入或个人菜谱。

截图只使用内置 Hosted demo 数据，并显示 `Hosted · no model`。

## 结论与非阻断观察

- 未发现 P0/P1 视觉或交互问题。
- 1024px 时间线按设计使用轨道内部横向滚动；document 本身横向溢出仍为 0。
- Cook 延误态的底层排程警告已统一为英文，并由 reducer 行为测试和新录制 Hosted 片段复核。
