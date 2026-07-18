# DinnerSync MVP Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在比赛截止前交付一个可公开体验、可本地调用真实 GPT-5.6、能把三道菜同步排到开饭时间并在延误后重排的 DinnerSync 参赛作品。

**Architecture:** 使用 Next.js App Router 承载单页向导和仅本地启用的解析路由；菜谱复核、营养、排程、会话分别是无框架依赖的 TypeScript 模块，UI 只能通过各模块 `index.ts` 公开接口调用。Hosted Demo 使用已校验 fixtures，Local AI 通过受限子进程调用已登录的 Codex CLI；模型只提出候选字段，所有计算和状态转换保持确定性。

**Tech Stack:** Node.js 22、Next.js 16、React 19、TypeScript、Zod 4、Tailwind CSS 4、Vitest + Testing Library、Playwright、Codex CLI 0.144+、npm。

**Review Status:** Chunk 1、2、3 均已通过独立计划审计。

---

## 执行约束

- 必须遵循 `@test-driven-development`：领域行为先写失败测试，再写最小实现。
- 每个任务完成后运行指定验证并单独提交，不把多个任务压成一个大提交。
- 必须遵循 `@modular-architecture`：代码文件目标不超过 300 行，模块只经 `index.ts` 暴露接口。
- 前端遵循 `@frontend-design`：采用“温暖的厨房作战台”方向，而非通用 SaaS 卡片页。
- Local AI 是 P0；若真实 GPT-5.6 技术门禁失败，立即停止扩展功能并修复，不得以 Hosted Demo 冒充完成。
- 禁止医疗、减重、食品安全或过敏原保证；营养数据不完整时只能显示已知热量小计。
- 公开仓库、英文 README、带音频且少于三分钟的公开视频和 Devpost 表单都是完成条件。

## 范围与分块

本规格含多个模块，但它们不是可独立提交的产品：复核数据是营养与排程的共同输入，排程是烹饪会话和演示 UI 的前提。因此保留一份纵向 MVP 计划，分成三个可单独评审且逐步可运行的 chunk：

1. 项目基础与确定性领域核心；
2. 应用体验、Hosted Demo 与 Local AI；
3. 端到端验收、文档、演示和提交。

## 文件职责图

| 路径 | 单一职责 |
|---|---|
| `package.json`, `next.config.ts`, `vitest.config.mts`, `playwright.config.ts` | 命令、框架和测试配置 |
| `scripts/check-file-lengths.mjs`, `scripts/codex-smoke.mjs` | 文件规模与真实模型门禁 |
| `src/app/` | App Router、样式、元数据和 Local AI routes |
| `src/components/` | 五步向导、时间线及小型 UI primitives |
| `src/shared/` | Result、ISO 时间和固定厨房资源 |
| `src/modules/recipe-import/` | 草稿 schema、证据、复核、转换和 Codex 适配 |
| `src/modules/nutrition/` | 带来源目录、候选匹配、单位/份量和 kcal |
| `src/modules/scheduling/` | 图校验、资源区间、逆向/正向排程和重排 |
| `src/modules/cooking-session/` | 事件、时钟派生、状态机和持久化 |
| `src/modules/dinner-planner/` | 跨领域编排和完整工作流快照 |
| `src/modules/demo/` | 三份原创菜谱、已校验 Draft 和八分钟回放 |
| `tests/e2e/` | Hosted、Local AI、刷新和移动端验收 |
| `docs/submission/`, `README.md`, `LICENSE` | 英文评委材料、演示和许可证 |

## Chunk 1：项目基础与确定性领域核心

### Chunk 1 公共接口归属

以下契约在实现前锁定；每个领域只通过自己的 `index.ts` 导出，外部禁止直接引用内部文件。`src/shared/` 只承载无业务归属的结果、时间和资源基础类型，Recipe/Schedule/Session 类型仍由对应领域拥有。

```ts
// src/shared/{result,time,kitchen}.ts
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
export type IsoInstant = string; // runtime schema 强制 Z 或 ±HH:mm
export type ResourceId = "cook:1" | "oven:1" | "burner:1" | "burner:2";
export type ResourceRequirement = { resourceId: ResourceId };
export type KitchenResources = { cooks: 1; ovens: 1; burners: 1 | 2 };
```

```ts
// src/modules/recipe-import/types.ts
export type EvidenceSpan = { start: number; end: number; text: string };
export type ReviewValue<T> = {
  value: T; provenance: "source" | "inferred"; evidence: EvidenceSpan | null;
  inferenceReason: string | null; confidence: number; status: "needs-review" | "confirmed";
};
export type FoodState = "raw" | "cooked" | "other";
export type IngredientDraft = {
  id: string; sourceText: string; // 必须与所属 RecipeDraft.sourceText 完全相同
  name: ReviewValue<string>; quantity: ReviewValue<number | null>;
  unit: ReviewValue<string | null>; foodState: ReviewValue<FoodState | null>;
};
export type CookingStepDraft = {
  id: string; sourceText: string; instruction: ReviewValue<string>;
  durationMinutes: ReviewValue<number>; mode: ReviewValue<"active" | "passive">;
  dependsOn: ReviewValue<string[]>; resources: ReviewValue<ResourceRequirement[]>;
  ovenOperation: ReviewValue<"preheat" | "cook" | "temperature-change" | null>;
  ovenTemperatureC: ReviewValue<number | null>; isTerminal: ReviewValue<boolean>;
};
export type RecipeDraft = {
  id: string; sourceText: string; name: ReviewValue<string>;
  sourceServings: ReviewValue<number | null>; ingredients: IngredientDraft[]; steps: CookingStepDraft[];
};
export type Ingredient = {
  id: string; sourceText: string; name: string; quantity: number | null; unit: string | null;
  foodState: FoodState | null; sourceGrams: number | null; plannedGrams: number | null;
  nutritionRefId: string | null; nutritionMatchStatus: "confirmed" | "unresolved";
  status: "used" | "omitted";
};
export type CookingStep = {
  id: string; recipeId: string; sourceText: string; instruction: string; durationMinutes: number;
  mode: "active" | "passive"; dependsOn: string[]; resources: ResourceRequirement[];
  ovenOperation: "preheat" | "cook" | "temperature-change" | null;
  ovenTemperatureC: number | null; isTerminal: boolean;
};
export type Recipe = {
  id: string; name: string; sourceText: string; sourceServings: number | null;
  targetServings: number; ingredients: Ingredient[]; steps: CookingStep[];
};
```

```ts
// src/modules/nutrition/types.ts
export type NutritionRecord = {
  id: string; canonicalName: string; foodState: FoodState; kcalPer100g: number;
  sourceUrl: string; sourceVersion: string; accessedAt: string;
};
export type NutritionSummary = {
  completeness: "complete" | "partial"; knownMealKcal: number; knownKcalPerPerson: number;
  estimatedMealKcal: number | null; estimatedKcalPerPerson: number | null;
  targetDeltaPerPerson: number | null;
  unresolvedIngredientIds: string[];
};
```

```ts
// src/modules/scheduling/types.ts
export type ScheduleTask = CookingStep & { recipeId: string };
export type ScheduleRequest = {
  tasks: ScheduleTask[]; kitchen: KitchenResources; availableFrom: IsoInstant;
  serveAt: IsoInstant; serveToleranceMinutes: 5;
};
export type ScheduledTask = {
  taskId: string; plannedStart: IsoInstant; plannedEnd: IsoInstant; effectiveResources: ResourceId[];
};
export type ScheduleIssueCode =
  | "INVALID_DURATION" | "MISSING_DEPENDENCY" | "DEPENDENCY_CYCLE"
  | "INVALID_TERMINAL" | "INVALID_RESOURCE" | "OVEN_TRANSITION_REQUIRED"
  | "RESOURCE_UNAVAILABLE" | "RESOURCE_CONFLICT" | "WINDOW_INFEASIBLE";
export type Schedule = { feasible: true; tasks: ScheduledTask[]; serveAt: IsoInstant };
export type InfeasibleSchedule = {
  feasible: false; issues: Array<{ code: ScheduleIssueCode; taskIds: string[] }>;
  earliestFeasible: { tasks: ScheduledTask[]; serveAt: IsoInstant } | null;
};
export type ScheduleResult = Schedule | InfeasibleSchedule;
export type ReplanRequest = {
  request: ScheduleRequest; previous: Schedule; now: IsoInstant; completedTaskIds: string[];
  activeTasks: Array<{ taskId: string; status: "running" | "due"; actualStart: IsoInstant;
    expectedEnd: IsoInstant; lockUntil: IsoInstant | null; effectiveResources: ResourceId[] }>;
};
```

```ts
// src/modules/cooking-session/types.ts
export type TaskStatus = "scheduled" | "ready" | "running" | "due" | "completed";
export type TaskRuntimeState = {
  taskId: string; status: TaskStatus; plannedStart: IsoInstant; plannedEnd: IsoInstant;
  actualStart: IsoInstant | null;
  actualEnd: IsoInstant | null; expectedEnd: IsoInstant | null;
};
export type SessionEvent =
  | { sequence: number; type: "TASK_STARTED"; taskId: string; at: IsoInstant }
  | { sequence: number; type: "TASK_DELAYED"; taskId: string; at: IsoInstant; delayMinutes: number }
  | { sequence: number; type: "TASK_DUE"; taskId: string; at: IsoInstant }
  | { sequence: number; type: "TASK_COMPLETED"; taskId: string; at: IsoInstant };
export type CookingSessionState = {
  request: ScheduleRequest; schedule: Schedule; runtime: Record<string, TaskRuntimeState>;
  events: SessionEvent[]; warning: string | null;
};
```

跨模块调用方向固定为：`shared <- recipe-import <- nutrition/scheduling <- cooking-session <- dinner-planner <- UI`。排程不读取 nutrition；nutrition 不读取 scheduling；由 dinner-planner 组合二者，避免循环依赖。

### Task 1：建立可验证的 Next.js 工程

**Files:**
- Create: `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`, `vitest.config.mts`
- Create: `src/test/setup.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/page.test.tsx`, `src/app/globals.css`
- Create: `scripts/check-file-lengths.mjs`
- Modify: `.gitignore`

- [ ] **Step 1: 写最小 package 与配置文件**

  dependencies 固定 `next@16.2.10`、`react@19.2.7`、`react-dom@19.2.7`、`zod@4.4.3`、`lucide-react`、`@fontsource/fraunces`、`@fontsource/manrope`；devDependencies 明列 `typescript`、`@types/node`、`@types/react`、`@types/react-dom`、`eslint`、`eslint-config-next`、`vitest`、`vite`、`@vitejs/plugin-react`、`vite-tsconfig-paths`、`jsdom`、`@testing-library/react`、`@testing-library/dom`、`@testing-library/jest-dom`、`@testing-library/user-event`、`@playwright/test`、`tailwindcss`、`@tailwindcss/postcss`、`cross-env`。scripts 精确为 `dev: next dev`、`dev:local-ai: cross-env DINNERSYNC_LOCAL_AI=enabled next dev -H 127.0.0.1`、`build: next build`、`start: next start`、`lint: eslint .`、`typecheck: tsc --noEmit`、`test: vitest run`、`test:watch: vitest`、`test:e2e: playwright test`、`check:files: node scripts/check-file-lengths.mjs`、`verify: npm run check:files && npm run lint && npm run typecheck && npm test && npm run build`。`vitest.config.mts` 使用 `jsdom`、React plugin、tsconfig paths 和 `src/test/setup.ts`；setup 导入 `@testing-library/jest-dom/vitest`。

- [ ] **Step 2: 安装依赖并生成锁文件**

  Run: `npm install`

  Expected: 生成 `package-lock.json`，无高危审计错误，Node 版本满足 Next.js `>=20.9`。

- [ ] **Step 3: 写会失败的工程烟雾测试**

  Create `src/app/page.test.tsx`，断言页面具有名称为 `DinnerSync` 的一级标题；此时空页面应失败。

  Run: `npm test -- src/app/page.test.tsx`

  Expected: FAIL，找不到目标标题。

- [ ] **Step 4: 实现最小布局与页面**

  `layout.tsx` 设置英文 `lang`、产品元数据并导入本地 npm 字体；`page.tsx` 只渲染 `<main><h1>DinnerSync</h1></main>`，为后续顶层组件留下稳定边界。

- [ ] **Step 5: 加入文件长度守卫**

  `scripts/check-file-lengths.mjs` 递归检查 `src/`、`scripts/`、`tests/` 中 `.ts/.tsx/.js/.mjs`，超过 300 行时失败；生成文件与测试 fixture 可通过显式 allowlist 豁免，不允许通配豁免整个目录。

- [ ] **Step 6: 运行基线验证**

  Run: `npm run check:files && npm run lint && npm run typecheck && npm test -- --run`

  Expected: 所有命令 PASS，至少 1 个测试通过。

- [ ] **Step 7: 提交工程基础**

  ```bash
  git add package.json package-lock.json tsconfig.json next.config.ts eslint.config.mjs postcss.config.mjs vitest.config.mts .gitignore scripts src/app src/test
  git commit -m "chore(app): 初始化 DinnerSync 工程"
  ```

### Task 2：核验 Codex CLI 能力并封装安全 runner

**Files:**
- Create: `scripts/codex-smoke.mjs`, `docs/verification/codex-capabilities.md`
- Create: `src/modules/recipe-import/codex-runner.ts`, `src/modules/recipe-import/__tests__/codex-runner.test.ts`, `src/modules/recipe-import/index.ts`
- Modify: `package.json`

- [ ] **Step 1: 先做只读能力发现并记录**

  Run: `codex --version; codex login status; codex exec --help`

  Expected: 记录 CLI 版本、登录状态及所需参数的实际支持情况；再用最小严格 schema 实测候选 GPT-5.6 模型，只把成功的精确 ID 写入 `codex-capabilities.md`。2026-07-18 预检已成功启动 `gpt-5.6-sol` 和 `gpt-5.6-terra`，实施时仍须在当前 CLI 复核。

- [ ] **Step 2: 写子进程参数的失败测试**

  注入假的 `spawn`，断言显式选择的已验证模型原样传给 `codex exec`，并包含所需只读/临时/schema 参数；同时断言 `shell:false`、`cwd:tempDir`、stdin 只含 prompt、输出上限、取消与超时终止，保证子进程看不到项目目录。

  Run: `npm test -- src/modules/recipe-import/__tests__/codex-runner.test.ts`

  Expected: FAIL，因为 runner 尚不存在。

- [ ] **Step 3: 实现最小 CodexRunner**

  使用 `spawn`（Windows 为 `codex.cmd`），父进程在 tempDir 写 schema，并让 Codex CLI 宿主通过 `--output-last-message` 写临时结果；该宿主输出不等同于模型工具写文件，模型仍处于 read-only sandbox。runner 限长读取/校验结果并 finally 清理，默认 60 秒超时，不拼接 shell。

- [ ] **Step 4: 运行单元测试**

  Run: `npm test -- src/modules/recipe-import/__tests__/codex-runner.test.ts`

  Expected: PASS，成功、非零退出、超时、无输出四种分支均覆盖。

- [ ] **Step 5: 写并运行 CLI 结构化烟雾**

  `scripts/codex-smoke.mjs` 用 `additionalProperties:false` 的 `{ok:true}` schema 验证登录、模型、structured output 和 runner 参数，不打印认证信息。

  Run: `npm run smoke:codex`

  Expected: `PASS: <verified GPT-5.6 model> structured output`。这只是 CLI 能力门禁；DinnerSync 的 RecipeDraft/EvidenceSpan P0 门禁在 Task 4 schema 完成后执行。任何模型切换必须显式设置并如实显示，禁止静默回退。

- [ ] **Step 6: 提交能力核验与 runner**

  ```bash
  git add package.json scripts/codex-smoke.mjs docs/verification/codex-capabilities.md src/modules/recipe-import
  git commit -m "feat(ai): 核验 Codex 能力并封装安全调用"
  ```

### Task 3：建立共享时间与厨房资源契约

**Files:**
- Create: `src/shared/result.ts`, `src/shared/time.ts`, `src/shared/kitchen.ts`, `src/shared/index.ts`
- Create: `src/shared/__tests__/time.test.ts`, `src/shared/__tests__/kitchen.test.ts`

- [ ] **Step 1: 写带偏移时间失败测试**

  覆盖拒绝无时区字符串、同一时刻不同偏移比较相等、跨小时/跨日加分钟、输出稳定为 ISO `Z`；内部统一 epoch milliseconds，不引入日期库。

- [ ] **Step 2: 写厨房资源失败测试**

  固定资源为 `cook:1/oven:1/burner:1/burner:2`；一名厨师和一个烤箱容量 1、灶台容量 2；主动任务的有效锁必须确定性补入 `cook:1`，不能依赖模型写对。

- [ ] **Step 3: 实现共享纯函数并导出**

  `Result<T,E>`、`parseIsoInstant/toEpochMs/fromEpochMs/addMinutes`、`effectiveResources` 分别保持单一职责；业务模块不得复制时间解析或主动任务资源规则。

- [ ] **Step 4: 验证并提交**

  Run: `npm test -- src/shared && npm run typecheck`

  Expected: PASS。

  ```bash
  git add src/shared
  git commit -m "feat(shared): 增加时间与厨房资源契约"
  ```

### Task 4：实现字段级复核与证据契约

**Files:**
- Create: `src/modules/recipe-import/types.ts`, `src/modules/recipe-import/schemas.ts`, `src/modules/recipe-import/evidence.ts`, `src/modules/recipe-import/review-reducer.ts`, `src/modules/recipe-import/convert.ts`
- Create: `src/modules/recipe-import/__tests__/schemas.test.ts`, `src/modules/recipe-import/__tests__/evidence.test.ts`, `src/modules/recipe-import/__tests__/review-reducer.test.ts`, `src/modules/recipe-import/__tests__/convert.test.ts`
- Create: `tests/integration/codex-recipe-real.test.ts`, `docs/verification/local-ai.md`
- Modify: `src/modules/recipe-import/index.ts`
- Modify: `package.json`

- [ ] **Step 1: 写 ReviewValue 与证据失败测试**

  覆盖 `source` 必须具有 exact-match span、`inferred` 必须没有 span 且具有理由、confidence 在 `[0,1]`、emoji 前后的 UTF-16 左闭右开偏移、模型返回字段初始为 `needs-review`。所有 EvidenceSpan 一律相对根 `RecipeDraft.sourceText`；IngredientDraft/CookingStepDraft 的 `sourceText` 必须与根原文完全相等，测试拒绝片段文本或错误宿主。

  Run: `npm test -- src/modules/recipe-import/__tests__/schemas.test.ts src/modules/recipe-import/__tests__/evidence.test.ts`

  Expected: FAIL，类型和验证函数未定义。

- [ ] **Step 2: 实现类型、Zod schema 与证据验证**

  `ReviewValue<T>` 必须包含 `value/provenance/evidence/inferenceReason/confidence/status`；`sourceServings` 使用可空值，IngredientDraft 复核 `foodState`，CookingStepDraft 独立复核 `ovenOperation` 与 `ovenTemperatureC`。`validateEvidence(recipeSourceText,value)` 永远使用根原文并返回结构化 issue；AI schema 禁止 `nutritionRefId` 和 kcal 字段。

- [ ] **Step 3: 写转换门禁失败测试**

  先覆盖复核状态转换：用户编辑字段后保存为已确认的 inferred 值并清空 evidence；营养候选只有用户确认后才能写入 `nutritionRefId`；生熟状态不明只能 unresolved。修改目标份数或 used/omitted 时清空全部派生结果并重置步骤。转换前要求菜名、原份数（含已显式确认的 null）、食材名称/数量/单位/生熟状态，以及步骤说明/时长/模式/依赖/资源/烤箱字段/terminal 的每个 ReviewValue 均为 confirmed；任何未确认模型值都不得进入 Recipe。

- [ ] **Step 4: 实现 Draft -> Recipe 转换器**

  转换结果剥离 AI 元数据，保留 `sourceText` 和可空原份数；返回 `Result<Recipe, ReviewIssue[]>`，不使用异常表达用户可修复问题。

- [ ] **Step 5: 运行模块测试与类型检查**

  Run: `npm test -- src/modules/recipe-import && npm run typecheck`

  Expected: PASS，证据、schema、转换测试全部通过。

- [ ] **Step 6: 执行真实 RecipeDraft/EvidenceSpan P0 门禁**

  `test:codex-real` 用一份项目原创的短菜谱调用 Task 2 runner，断言退出码 0、精确 GPT-5.6 模型、严格 RecipeDraft schema、全部初始 needs-review、根原文 UTF-16 evidence 可复算、inferred 有理由、且没有营养数值。Run: `$env:RUN_REAL_CODEX='1'; $env:DINNERSYNC_CODEX_MODEL='<verified-id>'; npm run test:codex-real`。Expected: PASS；任何失败均为非零退出并停止 Task 5 以后开发，不能 skip 后显示通过。

- [ ] **Step 7: 提交复核契约与真实门禁**

  ```bash
  git add package.json src/modules/recipe-import tests/integration/codex-recipe-real.test.ts docs/verification/local-ai.md
  git commit -m "feat(recipe): 实现字段复核与证据门禁"
  ```

### Task 5：实现可追溯营养计算

**Files:**
- Create: `src/modules/nutrition/types.ts`
- Create: `src/modules/nutrition/catalog.ts`
- Create: `src/modules/nutrition/scale.ts`
- Create: `src/modules/nutrition/match.ts`
- Create: `src/modules/nutrition/calculate.ts`
- Create: `src/modules/nutrition/index.ts`
- Create: `src/modules/nutrition/__tests__/scale.test.ts`
- Create: `src/modules/nutrition/__tests__/match.test.ts`
- Create: `src/modules/nutrition/__tests__/calculate.test.ts`

- [ ] **Step 1: 写份量缩放失败测试**

  覆盖份量公式、kg/g、L/ml、演示量杯和不可换算单位；`sourceServings` 为 null/零/负时，该菜全部 used 食材的 plannedGrams 强制为 null，营养入口还要拒绝外部传入或陈旧的非空 plannedGrams。

  Run: `npm test -- src/modules/nutrition/__tests__/scale.test.ts`

  Expected: FAIL，缩放函数未定义。

- [ ] **Step 2: 实现纯函数缩放器**

  返回 `ResolvedWeight | UnresolvedWeight` 判别联合；不猜测“一个”“少许”或品牌包装重量；统一保留原始输入与换算来源。`findNutritionCandidates` 只按标准名精确、别名精确、归一化匹配、稳定 ID 排序提出候选，绝不自动写入 `nutritionRefId`。

- [ ] **Step 3: 写热量门禁失败测试**

  覆盖全部解析时的菜品/整餐/每人 kcal、稳定舍入、任一 used 食材未解析时 `completeness: "partial"`、只返回 known subtotal 且 `targetDelta: null`、omitted 食材不计入。

- [ ] **Step 4: 实现 catalog 和 calculateNutrition**

  每条记录包含稳定 ID、标准名、状态、每 100g kcal、来源/版本/日期；计算先验证 Recipe.sourceServings 为正数，否则整菜 plannedGrams 视为 null；之后只消费 used、可靠重量、匹配 foodState、confirmed match 和用户确认 ref。任一缺失即 unresolved。

- [ ] **Step 5: 运行营养测试**

  Run: `npm test -- src/modules/nutrition && npm run typecheck`

  Expected: PASS，完整与部分汇总语义清晰。

- [ ] **Step 6: 提交营养模块**

  ```bash
  git add src/modules/nutrition
  git commit -m "feat(nutrition): 加入确定性热量与完整性门禁"
  ```

### Task 6：实现任务图与厨房资源校验

**Files:**
- Create: `src/modules/scheduling/types.ts`
- Create: `src/modules/scheduling/validate.ts`
- Create: `src/modules/scheduling/index.ts`
- Create: `src/modules/scheduling/__tests__/validate.test.ts`

- [ ] **Step 1: 写图校验失败测试**

  覆盖不存在依赖、自依赖、依赖环、每道菜零个或多个 terminal、非正时长、未知资源、主动任务始终有效占用 `cook:1`；`validateTaskGraph(tasks,kitchen)` 在 burners=1 时必须拒绝 `burner:2`。所有 oven 任务必须有已确认的 `ovenOperation/ovenTemperatureC`；oven cook 必须依赖到达同温度的 preheat/change 任务。

- [ ] **Step 2: 运行测试确认红灯**

  Run: `npm test -- src/modules/scheduling/__tests__/validate.test.ts`

  Expected: FAIL，`validateTaskGraph` 未定义。

- [ ] **Step 3: 实现稳定校验器**

  返回有序 `ScheduleIssue[]`，原因码使用公共契约中的 `MISSING_DEPENDENCY/DEPENDENCY_CYCLE/INVALID_TERMINAL/INVALID_DURATION/INVALID_RESOURCE/OVEN_TRANSITION_REQUIRED`；拓扑排序按任务 ID 保持确定性。Task 7 排完后还要验证：若按时间相邻的 oven cook 温度不同，中间必须存在已确认的 temperature-change 任务，否则整份计划失败。

- [ ] **Step 4: 运行测试确认绿灯**

  Run: `npm test -- src/modules/scheduling/__tests__/validate.test.ts`

  Expected: PASS，错误顺序稳定且无随机性。

- [ ] **Step 5: 提交任务图校验**

  ```bash
  git add src/modules/scheduling
  git commit -m "feat(schedule): 校验任务图与厨房资源"
  ```

### Task 7：实现同步排程器与不可行解释

**Files:**
- Create: `src/modules/scheduling/intervals.ts`
- Create: `src/modules/scheduling/schedule.ts`
- Create: `src/modules/scheduling/forward-schedule.ts`
- Create: `src/modules/scheduling/__tests__/intervals.test.ts`
- Create: `src/modules/scheduling/__tests__/schedule.test.ts`
- Create: `src/modules/scheduling/__tests__/forward-schedule.test.ts`
- Modify: `src/modules/scheduling/index.ts`

- [ ] **Step 1: 写容量区间失败测试**

  覆盖半开区间、边界相接不冲突、cook/oven 容量 1、burner 容量 2、被动任务释放厨师但持续占用设备、同任务多资源原子预留。

- [ ] **Step 2: 实现 intervals 纯函数**

  `canReserve` 与 `reserve` 不读取系统时间，输入输出使用带偏移 ISO 时间解析后的 epoch milliseconds；同一输入产生同一排序。

- [ ] **Step 3: 写逆向排程失败测试**

  覆盖三道菜 terminal 在 `[serveAt-5m, serveAt]` 内、一名厨师主动任务不重叠、两个 burner 可并行、烤箱完全互斥、依赖先后、不得早于 `availableFrom`。另先写 `scheduleForwardEarliest(request)` 失败测试：从 availableFrom 正向生成满足依赖/资源的完整时间线，以最晚 terminal end 作为可复算的 earliest serve time。

- [ ] **Step 4: 实现稳定逆向列表排程**

  从 terminal deadline 向前按分钟寻找最晚可用区间；候选按 `latestEnd -> reverse critical path -> recipeId -> taskId` 稳定排序。成功返回 `Schedule`；失败时调用独立纯函数 `scheduleForwardEarliest`，把其无冲突时间线和最晚 terminal end 放入 `InfeasibleSchedule.earliestFeasible`，并返回稳定原因码，不得凭公式猜时间或静默移动 `serveAt`。

- [ ] **Step 5: 加入属性式边界样例**

  用固定种子的表驱动组合验证所有已排任务满足依赖、资源容量和完成窗口；不引入随机测试依赖。

- [ ] **Step 6: 运行排程测试**

  Run: `npm test -- src/modules/scheduling && npm run typecheck`

  Expected: PASS，相同输入快照完全一致。

- [ ] **Step 7: 提交排程器**

  ```bash
  git add src/modules/scheduling
  git commit -m "feat(schedule): 生成同步晚餐时间线"
  ```

### Task 8：实现烹饪会话状态机与重排

**Files:**
- Create: `src/modules/cooking-session/types.ts`
- Create: `src/modules/cooking-session/reducer.ts`
- Create: `src/modules/cooking-session/clock.ts`
- Create: `src/modules/cooking-session/selectors.ts`
- Create: `src/modules/cooking-session/persistence.ts`
- Create: `src/modules/cooking-session/index.ts`
- Create: `src/modules/cooking-session/__tests__/reducer.test.ts`
- Create: `src/modules/cooking-session/__tests__/clock.test.ts`
- Create: `src/modules/cooking-session/__tests__/persistence.test.ts`
- Create: `src/modules/scheduling/replan.ts`
- Create: `src/modules/scheduling/__tests__/replan.test.ts`
- Modify: `src/modules/scheduling/index.ts`

- [ ] **Step 1: 写状态转换失败测试**

  精确 command 为 `START{taskId,at}`、`DELAY{taskId,at,delayMinutes}`、`COMPLETE{taskId,at}`；reducer 生成连续 `sequence=last+1` 的 `TASK_STARTED/TASK_DELAYED/TASK_COMPLETED` 事件。`advanceSessionTime(state,now)` 负责把已到 plannedStart、依赖完成且资源可用的 scheduled 派生为 ready，并按 `expectedEnd,taskId` 生成 TASK_DUE；`restoreSession(snapshot,now)` 重放事件后调用同一时钟函数。测试覆盖完整 `scheduled -> ready -> running -> due -> completed`。

- [ ] **Step 2: 实现 reducer 与 selectors**

  reducer/clock 显式接收 at/now；Start 复查依赖/locks，due 不自动完成，Complete 写 actualEnd。`applySessionCommand` 对 Start 实际偏差、每次 Delay、每次 Complete 都统一重排并原子写回 runtime/events/schedule；Complete 即使准时也必须释放资源、重新评估 ready 并重排，偏差只控制警告。原 serveAt 不可行时使用带 WINDOW_INFEASIBLE 标记的 earliestFeasible 时间线。

- [ ] **Step 3: 写重排失败测试**

  用公共 `ReplanRequest` 覆盖：completedTaskIds 作为已满足依赖；running 使用 `lockUntil=expectedEnd`，due 使用 `lockUntil=null` 表示显式 Complete 前无限期占用资源；now 是未开始任务新下界，只重排 scheduled/ready。若 due 锁使资源暂不可用，返回结构化不可行结果而不得越过锁；重复输入产生相同结果。

- [ ] **Step 4: 实现 replanRemainingTasks**

  `replanRemainingTasks` 注册 active 固定区间后处理依赖：running 的后继最早开始不早于 expectedEnd；due 无完成时间，显式 Complete 前阻塞全部后继。completed 才从 DAG 移除并释放后继；active/completed 不得移动。重排/恢复同步 planned 字段但不覆盖 actual 字段，并复用同一排程器。

- [ ] **Step 5: 写版本化持久化测试并实现适配器**

  `SessionSnapshotV1` 只保存 ScheduleRequest、初始 Schedule 和可序列化 SessionEvent[]；恢复必须重放事件再调用 `advanceSessionTime(now)`，绝不自动 Complete。未知版本、损坏 JSON 返回 recoverable issue；localStorage 不可用时降级到内存并持续显示警告。

- [ ] **Step 6: 运行 Chunk 1 全量验证**

  Run: `npm run check:files && npm run lint && npm run typecheck && npm test -- --run`

  Expected: PASS，领域测试无失败。

- [ ] **Step 7: 提交会话与重排**

  ```bash
  git add src/modules/cooking-session src/modules/scheduling
  git commit -m "feat(session): 支持实时步骤与延误重排"
  ```

## Chunk 2：应用体验、Hosted Demo 与 Local AI

### Task 9：建立演示数据与顶层规划编排

**Files:**
- Create: `src/modules/demo/source-recipes.ts`
- Create: `src/modules/demo/parsed-drafts.ts`
- Create: `src/modules/demo/scenario.ts`
- Create: `src/modules/demo/index.ts`
- Create: `src/modules/demo/__tests__/fixtures.test.ts`
- Create: `src/modules/dinner-planner/types.ts`
- Create: `src/modules/dinner-planner/reducer.ts`
- Create: `src/modules/dinner-planner/build-plan.ts`
- Create: `src/modules/dinner-planner/persistence.ts`
- Create: `src/modules/dinner-planner/index.ts`
- Create: `src/modules/dinner-planner/__tests__/build-plan.test.ts`
- Create: `src/modules/dinner-planner/__tests__/persistence.test.ts`

- [ ] **Step 1: 写 fixture 契约失败测试**

  三份英文菜谱必须逐字段通过 Zod 和证据偏移校验；至少包含一项模型推断、一项被动烤箱任务、两项可并行灶台任务；所有 used 食材必须匹配带来源的营养记录。

  Run: `npm test -- src/modules/demo/__tests__/fixtures.test.ts`

  Expected: FAIL，fixture 尚不存在。

- [ ] **Step 2: 编写三道菜演示 fixture**

  使用适合 2 人晚餐且步骤可同步的组合，例如柠檬香草鸡、烤蔬菜和蒜香米饭；原文、证据和解析结果必须人工逐项一致。不要使用第三方受版权保护的整篇菜谱，文字由项目原创。

- [ ] **Step 3: 写 buildDinnerPlan 失败测试**

  断言只接受已确认 Draft；组合 nutrition 与 schedule；完整数据产生目标差值；空 `sourceServings` 仍可排程但汇总为 partial；`targetServings` 变化会使旧计划失效。

- [ ] **Step 4: 实现顶层 reducer 与 buildDinnerPlan**

  阶段严格为 `setup/review/plan/cook/summary`；编排层只调用各模块公共接口，不导入内部文件；错误按 `field/review/nutrition/schedule/storage/ai` 分类供 UI 呈现。

- [ ] **Step 5: 实现完整工作流持久化**

  `DinnerPlannerSnapshotV1` 保存当前阶段、复核后的 Recipe、营养汇总、Schedule 和可重放 session events；损坏 JSON/未知版本安全要求重置，QuotaExceeded 时切换内存并持续警告。不得保存 Codex 会话、认证信息或临时运行目录。

- [ ] **Step 6: 加入固定延误演示场景**

  scenario 在开始烹饪后向一个运行任务发送固定 `+8 minutes` 事件；加速时钟只改变事件到达速度，不改变事件内容和状态机。

- [ ] **Step 7: 验证并提交演示领域闭环**

  Run: `npm test -- src/modules/demo src/modules/dinner-planner && npm run typecheck`

  Expected: PASS，内置晚餐可生成无资源冲突计划。

  ```bash
  git add src/modules/demo src/modules/dinner-planner
  git commit -m "feat(demo): 串联内置晚餐规划闭环"
  ```

### Task 10：实现视觉系统与 Setup 页面

**Files:**
- Create: `src/components/ui/button.tsx`
- Create: `src/components/ui/panel.tsx`
- Create: `src/components/ui/progress-rail.tsx`
- Create: `src/components/ui/status-chip.tsx`
- Create: `src/components/dinner-sync-app.tsx`
- Create: `src/components/setup-screen.tsx`
- Create: `src/components/__tests__/setup-screen.test.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: 锁定可辨识的视觉方向**

  “温暖的厨房作战台”：奶油纸张底、炭黑文字、番茄红动作色、藏红花黄时间标记、鼠尾草绿完成态；`Fraunces` 做显示字体、`Manrope` 做正文，字体通过 npm 自托管。视觉记忆点是三道菜的轨道向同一 `Dinner lands` 标记汇合，背景使用克制的纸张噪点与刻度线。

- [ ] **Step 2: 写 Setup 组件失败测试**

  断言模式说明、三份菜谱输入、diners、serve time、kcal target、隐私确认和 `Build my service plan` 按钮；未确认发送数据时 Local AI 不可提交，Hosted Demo 可一键载入。

  Run: `npm test -- src/components/__tests__/setup-screen.test.tsx`

  Expected: FAIL，组件不存在。

- [ ] **Step 3: 实现设计 token 与 UI primitives**

  CSS variables 定义颜色、间距、圆角、阴影、字体和 150/250ms motion；支持 `prefers-reduced-motion`、清晰焦点环和 WCAG AA 对比。按钮/面板只包含通用展示语义，不持有业务状态。

- [ ] **Step 4: 实现顶层 App 和 SetupScreen**

  桌面为不对称双栏“输入台 + service preview”，手机为单列；所有 label 关联表单控件，错误信息使用 `aria-describedby`，模式切换清楚说明 Hosted Demo 不发送数据、Local AI 会发送输入给 OpenAI。

- [ ] **Step 5: 运行组件测试与首次视觉检查**

  Run: `npm test -- src/components/__tests__/setup-screen.test.tsx && npm run dev`

  Expected: 测试 PASS；在 390x844 和 1440x900 下无横向滚动，主操作在首屏可见。

- [ ] **Step 6: 提交 Setup 体验**

  ```bash
  git add src/app src/components
  git commit -m "feat(ui): 构建晚餐设置与视觉系统"
  ```

### Task 11：实现 Review 页面与字段级修正

**Files:**
- Create: `src/components/review-screen.tsx`
- Create: `src/components/review-field.tsx`
- Create: `src/components/nutrition-match.tsx`
- Create: `src/components/__tests__/review-screen.test.tsx`
- Modify: `src/components/dinner-sync-app.tsx`
- Modify: `src/modules/dinner-planner/reducer.ts`

- [ ] **Step 1: 写 Review 交互失败测试**

  覆盖 source/inferred 标识、点击证据定位原文、缺失值编辑、营养记录确认、omitted 显式操作、逐字段确认、未完成门禁时禁用计划按钮、`sourceServings: null` 可被显式确认。

- [ ] **Step 2: 实现 ReviewField 与证据高亮**

  source span 使用 UTF-16 offset 从原文生成前/高亮/后片段；不得用重新搜索文本代替偏移。inferred 字段显示理由和醒目的人工确认状态。

- [ ] **Step 3: 实现营养匹配核对**

  显示标准名、状态、每 100g kcal、来源和版本；不把置信度表现成安全保证。无法换算时要求填写克数或保持 used/unresolved，不能诱导用户改成 omitted。

- [ ] **Step 4: 串联字段编辑与失效规则**

  修改目标份数或 omitted 食材后立即清空 plannedGrams、nutrition summary 和 schedule，并将该菜谱步骤字段设回 `needs-review`。

- [ ] **Step 5: 运行测试与可访问性检查**

  Run: `npm test -- src/components/__tests__/review-screen.test.tsx && npm run lint && npm run typecheck`

  Expected: PASS，键盘可完成全部确认操作。

- [ ] **Step 6: 提交 Review 体验**

  ```bash
  git add src/components src/modules/dinner-planner/reducer.ts
  git commit -m "feat(ui): 加入菜谱与营养复核流程"
  ```

### Task 12：实现 Plan、Cook 与 Summary 页面

**Files:**
- Create: `src/components/plan-screen.tsx`
- Create: `src/components/service-timeline.tsx`
- Create: `src/components/cook-screen.tsx`
- Create: `src/components/task-card.tsx`
- Create: `src/components/summary-screen.tsx`
- Create: `src/components/__tests__/plan-screen.test.tsx`
- Create: `src/components/__tests__/cook-screen.test.tsx`
- Create: `src/components/__tests__/summary-screen.test.tsx`
- Modify: `src/components/dinner-sync-app.tsx`

- [ ] **Step 1: 写 Plan 页面失败测试**

  断言三条菜品轨道汇聚到 serve marker；主动/被动、厨师/烤箱/灶台、开始结束时间可辨；完整营养显示总量/每人/差值，partial 只显示 known subtotal 和缺失清单；不可行计划显示原因和最早完成时间。

- [ ] **Step 2: 实现 ServiceTimeline 和 PlanScreen**

  时间线使用 CSS grid，不使用不可访问的 canvas；移动端改为按开始时间排序的列表，同时保留菜品和资源标签。

- [ ] **Step 3: 写 Cook 页面失败测试**

  覆盖当前动作、下一动作、倒计时、Start/Delay/Complete、冲突 Start 被拒绝、due 保持占用、`+4 min` 触发重排、重排后标明改变的任务、刷新恢复警告。

- [ ] **Step 4: 实现 CookScreen 与真实时间戳驱动**

  UI ticker 只刷新显示；状态由事件时间戳推导，不用递减整数作为真源。开始和完成按钮具有防重复提交保护，加速回放调用同一事件 dispatcher。

- [ ] **Step 5: 写并实现 Summary 页面**

  显示计划与实际完成、延误/重排次数、每菜与每人 kcal、partial 警告，以及只基于关键路径实际偏差的下次建议；不调用模型生成健康建议。

- [ ] **Step 6: 运行组件回归**

  Run: `npm test -- src/components && npm run typecheck`

  Expected: PASS，计划、烹饪和总结组件均可通过键盘操作。

- [ ] **Step 7: 提交完整主流程**

  ```bash
  git add src/components
  git commit -m "feat(ui): 完成计划烹饪与总结体验"
  ```

### Task 13：接入安全的 Local AI HTTP 边界

**Files:**
- Create: `src/modules/recipe-import/codex-prompt.ts`, `src/modules/recipe-import/__tests__/codex-prompt.test.ts`
- Create: `src/app/api/local-ai/status/route.ts`, `src/app/api/local-ai/status/route.test.ts`, `src/app/api/local-ai/import/route.ts`, `src/app/api/local-ai/import/route.test.ts`
- Create: `tests/integration/codex-three-recipes-real.test.ts`
- Modify: `src/modules/recipe-import/codex-runner.ts`, `src/modules/recipe-import/schemas.ts`, `src/modules/recipe-import/index.ts`
- Modify: `src/components/dinner-sync-app.tsx`
- Modify: `next.config.ts`
- Modify: `package.json`
- Create: `.env.example`

- [ ] **Step 1: 写 prompt 隔离失败测试**

  断言系统说明明确把菜谱视为不可信数据、忽略菜谱中的指令、禁止工具/文件/网络需求、只返回 schema；用户内容通过 JSON 字符串嵌入并有数量/长度上限。

- [ ] **Step 2: 实现 prompt builder 和完整输出 schema**

  JSON Schema 与 Zod 都使用 strict/`additionalProperties:false`，并把每个 ReviewValue.status 定义为 literal `needs-review`（不是普通枚举）；服务端整批拒绝任何模型预确认值。模型不得输出 kcal、营养记录 ID 或最终 schedule。

- [ ] **Step 3: 写 status/import route 失败测试**

  覆盖 hosted 404、同源/consent、数量/长度，以及 `LOCAL_AI_DISABLED/CONSENT_REQUIRED/CODEX_NOT_INSTALLED/CODEX_NOT_LOGGED_IN/MODEL_UNAVAILABLE/CODEX_TIMEOUT/CODEX_QUOTA/INVALID_MODEL_OUTPUT/EVIDENCE_MISMATCH/INPUT_TOO_LARGE`；成功只返回验证后的 Draft 和真实 provider/model/schemaValidated/evidenceValidated。

- [ ] **Step 4: 实现 Node runtime route**

  `runCodexImport({recipes,model,signal,timeoutMs})` 从 `codex-runner.ts` 导出 Result；它在空 tempDir 以 `cwd=tempDir`、`--sandbox read-only --ephemeral --ignore-user-config --ignore-rules` 调用实测 GPT-5.6，finally 清理，且支持超时/取消/输出上限。routes 仅在 enabled 时调用，校验 Origin/Host、单并发、不记录原文或回传原始 stderr，并设置 no-store；`dev:local-ai` 只绑定 127.0.0.1。

- [ ] **Step 5: 加入安全响应头与 UI 错误恢复**

  CSP 至少限制 `default-src 'self'`、`frame-ancestors 'none'`；Local AI 失败后保留输入并允许重试或明确切换 Hosted Demo，不能让用户误以为解析成功。

- [ ] **Step 6: 运行边界测试和真实解析**

  Run: `npm test -- src/modules/recipe-import src/app/api/local-ai`

  Expected: 单元/路由测试 PASS。

  Run: `npm run dev:local-ai`，确认只监听 `127.0.0.1:3000`；另一终端执行 `$env:RUN_REAL_CODEX='1'; npm run test:codex-real:full`，使用三份原创 fixture 经真实 route 解析。

  Expected: 三份 Draft 整批通过 schema/根原文 evidence、显示真实模型元数据并进入 Review；测试失败必须非零，Network 为 no-store，日志/控制台无原文。

- [ ] **Step 7: 提交 Local AI 闭环**

  ```bash
  git add .env.example package.json next.config.ts src/app/api src/components/dinner-sync-app.tsx src/modules/recipe-import
  git commit -m "feat(ai): 接入本地菜谱解析闭环"
  ```

## Chunk 3：端到端验收、文档、演示和提交

### Task 14：完成 Playwright 端到端验收

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/hosted-demo.spec.ts`, `tests/e2e/local-ai.spec.ts`, `tests/e2e/local-ai-real.spec.ts`, `tests/e2e/persistence.spec.ts`, `tests/e2e/mobile.spec.ts`
- Modify: `package.json`

- [ ] **Step 1: 写 Hosted Demo 失败场景**

  流程必须从 `Try the 650 kcal demo` 开始，依次看到三份菜谱、营养核对、五分钟同步窗口、开始加速烹饪、向固定运行任务注入八分钟延误、看到重排变化、完成并看到 Summary。拦截请求并断言全程没有 `/api/local-ai/*` 或外部模型请求。

  Run: `npm run test:e2e -- tests/e2e/hosted-demo.spec.ts`

  Expected: 初次 FAIL，并明确指出缺失的用户路径，而非配置错误。

- [ ] **Step 2: 修正集成缝隙直到 Hosted Demo 通过**

  只修复跨模块接线和可测试性，不在此任务新增范围；为按钮和状态使用可访问名称，不添加仅测试可见的 DOM。

- [ ] **Step 3: 写 Local AI 边界 E2E**

  默认 local-ai.spec 注入 fake process 验证 consent/meta/确认/Plan，不耗额度。另建 `e2e:local-ai-real`（`cross-env RUN_REAL_CODEX=1 playwright test tests/e2e/local-ai-real.spec.ts`）：要求另一终端先运行 `npm run dev:local-ai`，真实 GPT-5.6 整批解析三份文本，断言 schemaValidated/evidenceValidated、逐字段确认三菜后进入 Plan，并输出不含原文的退出码/模型/时间证据到已忽略的 `.verification/local-ai-real.json`。

- [ ] **Step 4: 写刷新恢复与移动端 E2E**

  persistence 覆盖 running 刷新、due 刷新不自动完成、清除会话；mobile 使用 390x844，断言无横向溢出、主要触控区至少 44px、列表时间线可读。

- [ ] **Step 5: 运行全套浏览器测试**

  Run: `npx playwright install chromium`

  Run: `npm run test:e2e`

  Expected: Hosted、Local AI mock、persistence、mobile 全部 PASS；失败时保存 trace、截图和视频。

- [ ] **Step 6: 提交 E2E**

  ```bash
  git add package.json package-lock.json playwright.config.ts tests/e2e src
  git commit -m "test(e2e): 覆盖晚餐规划与延误重排闭环"
  ```

### Task 15：完成响应式、可访问性与视觉验收

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/components/*.tsx`
- Create: `docs/verification/visual-checklist.md`
- Create: `docs/submission/assets/.gitkeep`

- [ ] **Step 1: 用浏览器逐屏检查桌面与手机**

  检查 1440x900、1024x768、390x844 的 Setup、Review、Plan、Cook、Summary；记录溢出、截断、低对比、焦点丢失和动画眩晕问题。

- [ ] **Step 2: 修复视觉与交互问题**

  保持奶油纸张/炭黑/番茄红/藏红花/鼠尾草配色和汇合轨道记忆点；不引入紫色渐变、模板化 hero 或无业务意义的装饰卡片。减少动画设置下禁用轨道入场和脉冲。

- [ ] **Step 3: 执行键盘和读屏语义检查**

  Tab 顺序与视觉顺序一致；due 状态使用适度的 `aria-live`；输入错误可被关联；颜色不是唯一状态信号；Dialog/Drawer 若存在必须管理焦点并支持 Escape。

- [ ] **Step 4: 生成提交截图**

  通过 Playwright 使用固定 Hosted fixture 输出首页、同步时间线、八分钟延误后的重排、Summary 和移动端截图到 `docs/submission/assets/`；截图不得含用户名、邮箱、token 或本机路径。

- [ ] **Step 5: 回归验证并提交**

  Run: `npm run lint && npm run typecheck && npm test -- --run && npm run test:e2e`

  Expected: 全部 PASS。

  ```bash
  git add src docs/verification docs/submission/assets
  git commit -m "style(ui): 完成响应式与可访问性验收"
  ```

### Task 16：完善 README、许可证与部署门禁

**Files:**
- Create: `README.md`
- Create: `LICENSE`
- Create: `docs/submission/testing.md`
- Create: `docs/submission/checklist.md`
- Create: `docs/submission/devpost-copy.md`
- Modify: `.env.example`
- Modify: `package.json`

- [ ] **Step 1: 写英文 README**

  必须包含主张、Apps for Your Life 赛道、Hosted Demo URL 占位、Node/Codex 前置要求、Hosted 与 Local AI 区别、`npm ci`/运行/测试/真实模型命令、架构、隐私边界、热量估算/过敏原/医疗声明、已知限制、第三方数据来源和 MIT license。

- [ ] **Step 2: 写评委测试说明与 Devpost 英文文案**

  `testing.md` 提供 2 分钟 Hosted 路径和 Local AI 路径；`devpost-copy.md` 包含名称、tagline、问题、功能、技术实现、挑战、成果、所学、下一步、技术栈，以及 Codex/GPT-5.6 与确定性引擎的分工。

- [ ] **Step 3: 写提交清单**

  checklist 必须包含 Apps for Your Life、公开 Hosted URL、公开仓库和许可证、公开 YouTube、音轨、视频 <180 秒、真实 GPT-5.6、`/feedback` Session ID、规则最后核验时间、无敏感信息检查、Devpost 最终状态。

- [ ] **Step 4: 执行干净安装与 Hosted 构建**

  Run: `npm ci && npm run verify`

  Expected: lint、typecheck、单元测试、文件长度和 production build 全部 PASS。

  Run: `$env:DINNERSYNC_LOCAL_AI='disabled'; npm run build`

  Expected: Hosted build 成功，Local AI 路由运行时返回 404，不打包认证数据。

- [ ] **Step 5: 部署 Hosted Demo 并从未登录浏览器复测**

  部署目标支持 Next.js 16；仅设置 `DINNERSYNC_LOCAL_AI=disabled`，环境变量清单不得含 OpenAI/Codex secret。设置 `$env:PLAYWRIGHT_BASE_URL='<public-url>'` 后运行 hosted-demo.spec；再对精确路径 `/api/local-ai/status` 与 `/api/local-ai/import` 分别执行未登录 HTTP 请求并断言 404。保存仅含变量名的部署配置和运行日志摘要，证明无模型调用/handler 命中。

- [ ] **Step 6: 创建或连接公开代码仓库**

  仓库名称使用 `DinnerSync`，默认分支最终包含完整提交历史和 MIT license。推送前运行 secret scan；公开 URL 必须在未登录窗口可访问。若无法公开，则改用 private 并精确邀请 `testing@devpost.com` 与 `build-week-event@openai.com`。

- [ ] **Step 7: 提交文档与部署配置**

  ```bash
  git add README.md LICENSE .env.example package.json docs/submission
  git commit -m "docs(release): 完善评委测试与提交材料"
  ```

### Task 17：制作并验证三分钟公开视频

**Files:**
- Create: `docs/submission/demo-script.md`
- Create: `docs/submission/storyboard.json`
- Create: `scripts/validate-demo.mjs`
- Create: `artifacts/demo/dinnersync.mp4`（本地产物，不提交）
- Modify: `package.json`, `.gitignore`

- [ ] **Step 1: 写可机器检查的英文脚本**

  镜头预算：0:00–0:18 问题；0:18–0:43 真实 Local AI 同意和 GPT-5.6 解析；0:43–1:05 字段/营养确认；1:05–1:32 资源时间线；1:32–2:05 加速烹饪；2:05–2:28 八分钟延误与重排；2:28–2:48 Summary；2:48–2:58 技术分工。

- [ ] **Step 2: 实现脚本门禁**

  `scripts/validate-demo.mjs` 校验 storyboard 总时长 `<180` 秒及八个必选片段；`.gitignore` 精确加入 `artifacts/demo/*.mp4`、`.verification/`、`playwright-report/`、`test-results/`，不得使用会掩盖源码的宽泛规则。

- [ ] **Step 3: 录制真实 UI 与英文音轨**

  模型等待可剪短，但视频必须展示真实点击、真实成功结果和准确模型徽标；不得把 fixture 冒充 Local AI。旁白或字幕说明 kcal 是估算、Hosted Demo 不发送数据。

- [ ] **Step 4: 用 ffprobe 验收成片**

  Run: `ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 artifacts/demo/dinnersync.mp4`

  Expected: 数值 `<180`。

  Run: `ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 artifacts/demo/dinnersync.mp4`

  Expected: 输出 `audio`。

  Run: `npm run validate:demo`

  Expected: PASS，所有必选镜头存在。

- [ ] **Step 5: 上传公开 YouTube 并复核**

  标题和描述明确 DinnerSync / OpenAI Build Week / Apps for Your Life；设为 Public，关闭版权音乐。用未登录窗口打开视频，确认可播放、有声音、清晰度和时长正确。

- [ ] **Step 6: 提交脚本与视频元数据**

  ```bash
  git add package.json scripts/validate-demo.mjs docs/submission/demo-script.md docs/submission/storyboard.json docs/submission/checklist.md
  git commit -m "docs(demo): 完成三分钟演示门禁"
  ```

### Task 18：最终验收并提交 Devpost 作品

**Files:**
- Modify: `README.md`
- Modify: `docs/submission/devpost-copy.md`
- Modify: `docs/submission/checklist.md`
- Create: `docs/submission/submission-record.md`

- [ ] **Step 1: 执行最终自动门禁**

  Run:

  ```powershell
  npm ci
  npm run check:files
  npm run lint
  npm run typecheck
  npm test -- --run
  npm run build
  npm run test:e2e
  npm run smoke:codex
  # 另一终端保持 npm run dev:local-ai
  npm run e2e:local-ai-real
  git diff --check
  git status --short
  ```

  Expected: 所有命令 PASS；real E2E 用真实 GPT-5.6 整批解析三菜、schema/evidence 为 true、人工确认后进入 Plan，并产出脱敏证据。视频和测试产物必须已被精确 ignore，`git status --short` 必须为空，不允许“有意保留”例外。

- [ ] **Step 2: 执行外部链接门禁**

  从未登录浏览器验证 Hosted Demo、公开仓库、YouTube。设置 PLAYWRIGHT_BASE_URL 运行 hosted E2E；对公开 URL 的 `/api/local-ai/status` 和 `/api/local-ai/import` 分别断言 HTTP 404，并核对部署变量名/服务端日志证明没有模型凭据和调用；README 命令可复制执行。

- [ ] **Step 3: 记录 Codex/GPT-5.6 证据**

  从真实构建或解析运行中记录不含敏感信息的 Codex session ID、精确模型 ID、验证时间和相关提交范围；把活动要求的 `/feedback` Session ID 填入清单与 Devpost，不提交本机会话内容。

- [ ] **Step 4: 填写并预览 Devpost**

  选择 `Apps for Your Life`；粘贴最终英文文案；填 Hosted URL、repository URL、公开 YouTube URL、测试说明和 session ID。预览全部字段，确认无占位符、无隐私数据、无夸大医疗或热量主张。

- [ ] **Step 5: 提交作品并确认成功状态**

  点击最终提交后，必须看到 Devpost 明确的 submitted 状态和项目 URL；重新打开 My projects 验证仍为已提交。仅保存草稿不算完成。

- [ ] **Step 6: 记录提交凭证并做最后提交**

  `submission-record.md` 记录官方规则 URL、最后核验时间、Devpost 项目 URL、提交时间（含时区）、Hosted/Repo/YouTube URL 和页面状态；保存只裁切 Submitted 状态与项目 URL、无账号/cookie/token 的 `docs/submission/assets/devpost-submitted.png`。

  ```bash
  git add README.md docs/submission
  git commit -m "docs(submission): 记录 DinnerSync 参赛提交"
  git push
  git status --short
  ```

## 最终完成定义

只有同时满足以下条件才可宣布完成：

- 真实 GPT-5.6 对三份菜谱完成解析，schema 与证据均验证通过；
- Hosted Demo 无登录、无模型请求也能完成确认、排程、八分钟延误、重排和总结；
- 一名厨师、一个烤箱、两个灶台无冲突，terminal 均落在五分钟窗口或明确报告不可行；
- 营养完整时可复算，缺失时只有 known subtotal，且不含医疗/安全保证；
- 桌面、手机、刷新恢复、键盘路径和 production build 均通过；
- 公开视频少于三分钟、有音频，并展示 Codex/GPT-5.6 的真实使用；
- 公开 Hosted URL、仓库和 YouTube 在未登录窗口可访问；
- Devpost 页面明确显示作品已提交，并已记录项目 URL 与时间。
