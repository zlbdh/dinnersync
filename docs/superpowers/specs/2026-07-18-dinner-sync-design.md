# DinnerSync 产品与技术设计

日期：2026-07-18
状态：Revision 4 完成，待复审
比赛：OpenAI Build Week 2026
赛道：Apps for Your Life

文档长度说明：本规格需要在一次评审中统一产品、领域语义、安全、测试和比赛提交约束，因此保留为单一设计真源；该豁免只适用于设计文档，实施代码仍遵守 300 行目标和模块拆分规则。

## 1. 摘要

DinnerSync 是一款本地优先的智能晚餐编排应用。单道菜菜谱通常只解释“这道菜怎么做”，却不解决一顿饭中多道菜如何在有限厨具、有限人手、目标热量和指定时间下同步完成的问题。

用户导入最多三份文字菜谱，设置人数、目标开饭时间、每人目标热量和厨房资源。GPT-5.6 将非结构化菜谱解析成带来源证据的结构化数据；确定性营养模块计算热量；资源约束调度器生成同步时间线；实时烹饪模式在步骤延误后重排尚未开始的任务。

核心主张：

> Recipes tell you how to cook one dish. DinnerSync helps the whole meal land together.

## 2. 问题与目标用户

### 2.1 真实问题

家庭做饭者同时准备多道菜时，需要在脑中处理以下信息：

- 每道菜的前后步骤和等待时间；
- 一个人不能同时切菜、翻炒和装盘；
- 烤箱、灶台和厨具可能发生冲突；
- 某一步延迟会影响其余菜的完成时间；
- 多份菜谱的总热量和每人份量不直观；
- 菜谱常假设读者已经知道具体动作和准备顺序。

现有菜谱和普通计时器分别覆盖“内容”和“倒计时”，但缺少整顿饭级别的协调与恢复。

### 2.2 目标用户

首版服务以下人群：

- 一个人在家同时准备两到三道菜；
- 希望控制每餐大致热量，但不需要医疗级营养建议；
- 烹饪经验有限，需要清晰的当前步骤和下一步骤；
- 使用手机或平板在厨房查看进度。

### 2.3 成功标准

比赛版必须完成以下闭环：

1. 解析三份样例或用户粘贴的文字菜谱；
2. 让用户核对并确认整份 AI 解析结果和营养匹配；
3. 在全部实际使用食材已匹配时计算整餐与每人的预估热量；否则只显示已知热量小计；
4. 为一名厨师、一个烤箱和两个灶台生成满足五分钟同步窗口的无冲突时间线；
5. 在模拟延误后重新安排未开始任务；
6. 用加速演示模式在三分钟视频内展示完整过程；
7. Local AI 必须完成一次真实 GPT-5.6 解析；无 Codex 登录时仍可通过内置样例和回放模式体验确定性核心。

## 3. 非目标

比赛版明确不做：

- 自动抓取任意菜谱网站；
- 图片、视频或手写菜谱识别；
- 医疗、减重、疾病或儿童营养建议；
- 食品安全、熟度或过敏原无风险保证；
- 购物清单、冰箱库存和剩菜规划；
- 多用户协作、账号系统和云同步；
- 任意数量厨师、复杂商用厨房或通用最优调度；
- 模型自动修改原菜谱且不经用户确认；
- 依赖额外 OpenAI API 余额的云端推理。

## 4. 设计原则

### 4.1 AI 提议，程序验证

GPT-5.6 负责理解自然语言菜谱、拆解步骤和提出候选字段。营养计算、依赖检查、资源冲突、排程和计时必须由确定性代码完成。

所有 AI 提取结果初始状态均为 `needs-review`。用户必须显式确认整份菜谱后才能进入营养与排程；模型自报的 `confidence` 只用于排序核对项，绝不作为自动放行条件。

### 4.2 来源优先

每个模型提取字段必须带来源类型。`source` 字段必须提供 `EvidenceSpan`；偏移采用 JavaScript UTF-16 code unit，区间为左闭右开 `[start, end)`，且切片文本必须和输入完全匹配。`inferred` 字段的 `evidence` 必须为 `null`，同时提供非空 `inferenceReason` 并强制用户确认。缺失的数量、时长、温度和设备显示为待确认，不允许模型静默补齐。

### 4.3 厨房中一眼可读

实时模式只突出当前动作、下一动作和紧急变化。复杂编辑和详细证据放在准备阶段，不带入烹饪主界面。

### 4.4 诚实处理不确定性

热量标记为估算值；不可行计划明确报告；延误后若无法保持原定时间，展示新的预计上桌时间和原因。

## 5. 用户流程

### 5.1 欢迎页

用户可以：

- 打开内置的 “650 kcal dinner” 演示；
- 新建晚餐计划；
- 在本机可用 Codex 时粘贴菜谱文字并运行 AI 导入。

产品有两个明确运行模式：

- `Hosted Demo`：只运行内置样例和预生成解析结果，不调用模型；
- `Local AI`：本地 Next.js Node 路由调用用户已登录的 Codex CLI，将菜谱发送给 OpenAI 处理。

进入 `Local AI` 并点击解析前，界面必须明确告知菜谱文本将通过 Codex 发送给 OpenAI，并要求用户主动确认。本地模式不可伪装成完全离线处理。

### 5.2 设置目标

用户填写：

- 用餐人数；
- 最早可以开始准备的时间；
- 目标开饭时间；
- 同步上桌容差，P0 默认且固定为五分钟；
- 每人目标热量，可留空；
- 厨师数量，首版固定或限制为一人；
- 烤箱数量，首版为一个；
- 灶台数量，首版最多两个；
- 饮食偏好和过敏原备注文本。

应用不根据身高、体重或疾病计算热量目标，目标值必须由用户自行提供。

P0 中饮食偏好和过敏原只作为用户备注展示，不参与自动识别、过滤或安全判断。

### 5.3 导入与核对菜谱

用户最多粘贴三份菜谱。解析完成后进入核对页，按菜展示：

- 名称、原始份数和目标份数；
- 食材、数量、单位和标准化克数；
- 营养记录匹配、来源和置信度；
- 步骤、时长、主动/被动类型；
- 使用的人员与厨具资源；
- 前置步骤；
- 对应原文证据。

整份 AI 结果默认待核对。用户必须逐菜完成显式确认；`confidence` 只决定核对顺序。字段能否排除由门禁规则决定，必要步骤和排程字段不得通过“排除”绕过。

### 5.4 热量预算

应用展示：

- 每道菜总热量；
- 整餐总热量；
- 每人预估热量；
- 与用户目标的差值；
- 未解析食材对结果完整性的影响。

P0 只支持按份量等比例缩放：

```text
plannedGrams = sourceGrams * targetServings / sourceServings
```

`sourceGrams` 表示原菜谱重量，`plannedGrams` 表示当前晚餐实际计划重量。份量变化只缩放食材重量，不自动缩放步骤时长；所有受影响时长仍需用户确认。

只有 `sourceServings` 为非空正数时才能执行该公式。若用户确认原文没有提供原始份数，`sourceServings` 保持 `null`，该菜谱的 `plannedGrams` 不生成，并且不能参与完整热量或目标差值结论；排程仍可使用已经确认的步骤、依赖、时长和资源字段。营养模块只汇总其他具有可靠 `plannedGrams` 的实际使用食材，并将结果标为“已知热量小计”。

修改 `targetServings` 后，系统必须立即使所有 `plannedGrams`、营养汇总和既有排程失效，并把该菜谱全部步骤字段重置为 `needs-review`。只有重新计算重量、重新确认全部步骤并通过字段门禁后，才能再次生成热量与时间线。

`omitted` 只表示用户明确决定晚餐中不使用该食材，该食材不进入计划重量和营养计算；此操作会把该菜谱全部步骤字段重置为 `needs-review`。仍会使用但无法匹配营养记录的食材不得标为 `omitted`，必须保持已使用且未解析状态。

若任何实际使用的食材缺少可靠克数或营养记录，界面只能显示“已知热量小计”和未解析清单，必须禁用“达到热量目标”的结论。P0 不提供食材替换。

### 5.5 时间线预览

生成计划后，界面以泳道展示：

- 厨师；
- 烤箱；
- 灶台一；
- 灶台二；
- 每道菜的完成窗口。

冲突和关键路径使用明确标记。每道菜必须有且只有一个 terminal task。同步完成定义为所有 terminal task 都在 `[serveAt - serveToleranceMinutes, serveAt]` 内结束，且任何任务不得早于 `availableFrom` 开始。

若目标不可行，调度器从 `availableFrom` 正向计算最早可上桌时间，并返回结构化原因码，而不是生成重叠任务或无限提前开工。所有时间使用带 UTC 偏移量的 ISO 8601 字符串。

### 5.6 实时烹饪

烹饪界面显示：

- 当前需要执行的主动步骤；
- 所有正在运行或已到时的被动任务和计时器；
- 食材和用量；
- 原菜谱做法及简化解释；
- 剩余时间；
- 观察提示；
- 下一步骤；
- 当前占用的设备；
- 开始、延迟和完成操作。

计时使用绝对时间戳。浏览器进入后台或刷新后，任务状态仍能恢复。

任务状态固定为：

```text
scheduled -> ready -> running -> due -> completed
```

- 前置任务完成、计划开始时间已到且全部所需资源当前可用后，才能进入 `ready`；
- 只有用户点击 Start 且系统再次原子验证资源可用后，才进入 `running`，记录 `actualStart` 并计算 `expectedEnd`；
- 预计结束时间到达只进入 `due`，不得自动完成，资源继续锁定；
- `running` 或 `due` 任务占用的资源不可被其他任务使用；冲突任务保持 `scheduled`，冲突 Start 请求必须拒绝；
- 用户点击 Complete 后进入 `completed` 并记录 `actualEnd`；
- 实际开始或完成偏离计划时，使用与延迟事件相同的重排逻辑更新剩余任务；
- 刷新后根据持久化事件和时间戳恢复 `ready`、`running` 或 `due`，绝不把过期任务自动标为完成。

### 5.7 延迟与重排

用户必须选中一个正在运行的任务并为其增加延迟：

1. 已完成任务保持不变；
2. 被延迟任务更新预计结束时间并延长其资源锁；
3. 其他正在运行的任务保持不变；
4. 未开始任务重新计算；
5. 系统保持依赖与资源约束；
6. 若原目标不可达，显示新的预计上桌时间；
7. 变更以差异方式呈现，避免用户重新阅读整张时间线。

P0 不支持跳过任务，避免破坏必要依赖或制造虚假完成状态。

### 5.8 完成总结

结束页展示：

- 计划与实际完成时间；
- 发生的延误和重排次数；
- 每道菜及每人的预估热量；
- 未确认或排除的营养数据；
- 下次准备建议仅列出关键路径上 `actualStart` 晚于计划开始时间的任务，不生成其他模型建议。

## 6. 功能范围

### 6.1 P0：比赛必须完成

- Hosted Demo 与 Local AI 两种运行模式及明确的数据发送确认；两种模式均为 P0，Hosted Demo 不能替代真实 Local AI 验收；
- 三份文字菜谱的 GPT-5.6 结构化解析；
- 严格 schema、证据偏移校验与整单人工确认；
- 内置可追溯的演示营养记录；
- 食材克数与热量的确定性计算；
- 已知热量小计、完整总量门禁、份数和目标差值展示；
- `availableFrom`、五分钟同步窗口以及 terminal task；
- 一名厨师、一个完全互斥烤箱、两个灶台的资源约束排程；
- 依赖环、资源冲突和不可行计划检测；
- 移动优先的准备页、时间线与烹饪模式；
- 多计时器、延迟和动态重排；
- 本地持久化；
- 内置样例、回放模式和加速时钟；
- 英文 UI 与英文演示内容；
- 安装、测试与 Codex/GPT-5.6 使用说明。

### 6.2 P1：有余量再做

- 蛋白质、碳水和脂肪展示；
- 浏览器语音朗读当前步骤；
- DinnerSync Codex Skill 包装；
- 导出和导入计划 JSON；
- 简易离线 PWA 支持。

### 6.3 P2：比赛后

- 图片识别；
- 购物清单与库存；
- 剩菜规划；
- 家庭成员档案；
- 长期饮食趋势；
- 人工策划白名单的食材替换；
- 多厨师和复杂厨房；
- 在线菜谱连接器。

## 7. 系统架构

### 7.1 总体结构

```text
Hosted Demo ----------------> pre-generated confirmed fixture
                                      |
Local AI recipe text                  |
   |                                  |
   v                                  |
Consent gate                          |
   |                                  |
   v                                  |
Local Next.js Node route              |
   |                                  |
   v                                  |
Codex importer (GPT-5.6, isolated read-only process)
   |
   v
Strict recipe schema + validated source evidence
   |
   v
Review UI --> confirmed meal input <--+
                  |
                  +--> Nutrition engine
                  +--> Scheduling engine
                  +--> Live session state machine
                               |
                               v
                       Timeline / Cook / Summary UI
```

### 7.2 建议目录边界

```text
src/
  app/                    # Next.js 路由与页面组装
  modules/
    recipe-import/        # Codex 适配器、schema 与核对流程
    nutrition/            # 营养记录、单位换算和热量计算
    scheduling/           # DAG、资源约束、初始排程与重排
    cooking-session/      # 运行时状态机、计时和持久化
    demo/                 # 内置菜谱、演示结果和加速时钟
  components/             # 可复用展示组件
  shared/                 # 共享类型、错误与基础工具
skills/
  dinner-sync/            # P1 Codex Skill
docs/
  superpowers/specs/      # 设计规格
  plans/                  # 实施计划
```

每个模块通过 `index.ts` 暴露公共接口。UI 只能调用公共接口，不得直接访问调度或营养模块内部文件。

### 7.3 Codex 导入器

`Local AI` 模式由本地 Next.js Node 路由调用非交互式 Codex。`Hosted Demo` 不暴露此路由，也不进行模型调用。

本地适配器必须：

- 使用 GPT-5.6；
- 运行于空临时目录；
- `--ephemeral`，不保存会话；
- 只读沙箱；
- 严格输出 JSON Schema；
- 设置超时、取消和最大输入长度；
- 不允许模型访问用户项目或执行写操作；
- 输出再次经过运行时 schema 校验。

模型必须返回值、置信度、来源类型和原文证据偏移。适配器验证 `EvidenceSpan` 的 `start`、`end` 和 `text` 与输入完全一致；任何一项失败则整批拒绝，不接受部分 AI 结果。

模型只输出候选食材名称、状态和单位解释，不得输出或覆盖营养数值。营养记录由本地模块匹配并经用户确认。解析失败时不进入调度流程，用户可改用内置演示。

精确的模型标识和命令参数必须在实施前通过本机 Codex 文档与 CLI 实测确认，不在设计阶段凭记忆硬编码。

### 7.4 营养模块

营养模块采用纯函数，输入为已确认的标准化食材和营养记录。

核心公式：

```text
ingredient_kcal = plannedGrams / 100 * kcal_per_100g
recipe_kcal = sum(resolved ingredient_kcal)
meal_kcal_per_person = sum(recipe_kcal) / diners
```

每条营养记录至少包含：

- 稳定 ID；
- 标准名称；
- 生/熟或其他状态；
- 每 100 克热量；
- 可选三大营养素；
- 数据来源与版本；
- 适用单位换算。

P0 仅支持克、千克、毫升、升以及演示数据集中明确配置的量杯/量匙换算。`个`、`少许`、品牌包装等无法可靠换算时，用户必须填写克数，否则该食材保持未解析。

`sourceServings` 必须存在且大于零，否则营养模块拒绝份量换算和完整热量计算，并让该菜谱全部 `plannedGrams` 保持 `null`。未知食材或不可靠换算不得计入完整总量。只要一个实际使用食材未解析，界面就只显示已知热量小计、已解析食材数量和未解析清单，不显示可能误导的“热量覆盖率”百分比，也不得声称已达到目标。

比赛演示使用经过人工核验的小型本地数据集。正式接入外部营养数据前必须确认许可、字段和版本策略。

### 7.5 排程模块

排程器不读取 `sourceServings` 或任何营养汇总字段；它只接收已确认的步骤、依赖、时长、资源、terminal 标记、`availableFrom` 和 `serveAt`。因此已由用户确认“原文未提供原始份数”的菜谱仍可进入排程。

任务必须是原子动作。复合描述如“放入烤箱烘烤后取出”要拆为放入、烘烤和取出三个任务。任务模型包含：

- 唯一 ID 与所属菜品；
- 持续时间；
- 主动或被动类型；
- 前置任务；
- 所需资源；
- 可选烤箱温度；
- 目标完成窗口；
- 原始步骤证据。

主动任务全程锁定 `cook:1`；被动任务不锁定厨师，但在整个持续时间内继续锁定所需设备。P0 中烤箱完全互斥，即使温度相同也不允许两道菜共享；预热和换温必须作为显式任务，不隐式推断过渡时间。

排程步骤：

1. 校验任务引用和依赖环；
2. 验证每道菜只有一个 terminal task；
3. 计算关键路径和最早可能完成时间；
4. 在不早于 `availableFrom` 的前提下，从 `serveAt` 向前安排任务；
5. 主动任务锁定 `cook:1`；
6. 设备任务锁定对应资源；
7. 检测烤箱温度与占用冲突；
8. 验证所有 terminal task 位于同步窗口；
9. 无法满足目标时从 `availableFrom` 正向计算最早可上桌时间，并返回 `WINDOW_INFEASIBLE`、`RESOURCE_CONFLICT`、`DEPENDENCY_CYCLE`、`MISSING_TERMINAL` 等稳定原因码；
10. 对小规模任务使用确定性启发式排序，保持毫秒级响应。

不引入通用商用厨房求解器。三道菜、少量步骤的范围足以使用可解释的列表调度与回溯修正。

### 7.6 动态重排

重排输入包括当前时间、被延迟的运行任务 ID、已完成任务、所有正在执行任务、实际延迟和剩余任务。

已完成任务被冻结；只延长指定任务及其资源锁；其他运行任务保持不变；剩余 DAG 重新排程。结果返回：

- 新时间线；
- 发生变化的任务；
- 新的预计上桌时间；
- 造成变化的关键冲突；
- 是否仍在用户允许的完成窗口内。

### 7.7 实时会话状态机

会话通过事件驱动：

- `TASK_STARTED`：仅允许 `ready` 任务触发；处理事件时必须再次原子验证资源空闲，随后记录 `actualStart`，并用实际开始时间加持续时长计算 `expectedEnd`；
- `TASK_DELAYED`：仅允许选择 `running` 或 `due` 任务，更新 `expectedEnd` 并延长其资源锁；
- `TASK_DUE`：当当前时间达到 `expectedEnd` 时，把 `running` 任务转为 `due`，不释放资源；
- `TASK_COMPLETED`：由用户触发，记录 `actualEnd`、释放资源并重排剩余任务；
- `SESSION_RESTORED`：从事件与时间戳重建状态，不自动补写完成事件。

`running` 和 `due` 任务始终占用其资源。资源冲突的任务保持 `scheduled`，不得进入 `ready`；任何冲突的 Start 请求必须返回结构化拒绝结果。Complete 释放资源后，状态机重新评估等待任务并重排。

任务到时不等于完成。总结页的实际数据只来自 `actualStart`、`actualEnd` 和显式事件。Hosted Demo 的加速回放只自动注入同样的 Start、Due、Delay 和 Complete 事件，不使用第二套状态逻辑。

### 7.8 本地持久化

比赛版不需要账号或数据库服务器。计划、用户确认和烹饪会话保存在浏览器本地，且支持一键清除。浏览器持久化不可用或写入失败时降级为内存模式并显示持续警告，不阻塞当前演示。

持久化对象必须带 schema 版本。读取旧数据失败时提供安全重置，不让损坏状态阻塞内置演示。

## 8. 核心数据契约

### 8.1 导入核对契约

```ts
type EvidenceSpan = {
  start: number;
  end: number;
  text: string;
};

type Provenance = "source" | "inferred";

type ReviewValue<T> = {
  value: T | null;
  provenance: Provenance;
  evidence: EvidenceSpan | null;
  inferenceReason: string | null;
  confidence: number;
  status: "needs-review" | "confirmed";
};

type RecipeDraft = {
  id: string;
  sourceText: string;
  name: ReviewValue<string>;
  sourceServings: ReviewValue<number | null>;
  ingredients: IngredientDraft[];
  steps: CookingStepDraft[];
};

type IngredientDraft = {
  id: string;
  sourceText: string;
  name: ReviewValue<string>;
  quantity: ReviewValue<number>;
  unit: ReviewValue<string>;
};

type CookingStepDraft = {
  id: string;
  sourceText: string;
  instruction: ReviewValue<string>;
  durationMinutes: ReviewValue<number>;
  mode: ReviewValue<"active" | "passive">;
  dependsOn: ReviewValue<string[]>;
  resources: ReviewValue<ResourceRequirement[]>;
  isTerminal: ReviewValue<boolean>;
};
```

`ReviewValue` 是 AI 导入阶段的字段级包装，菜名、原份数、食材名称/数量/单位，以及步骤说明/时长/模式/依赖/资源/terminal 标记都必须独立核对。

`EvidenceSpan` 使用 JavaScript UTF-16 code unit 偏移和左闭右开区间 `[start, end)`。当 `provenance === "source"` 时 `evidence` 必须非空且可由对应记录的 `sourceText.slice(start, end)` 精确复算；当 `provenance === "inferred"` 时 `evidence` 必须为 `null`，`inferenceReason` 必须非空。

`RecipeDraft` 是编辑与复核的真源。只有所有排程必需的 `ReviewValue` 均为 `confirmed` 后，转换器才生成不含 AI 元数据的纯领域对象。用户可把原文未提供的 `sourceServings` 作为 `null` 显式确认；它不是排程门禁字段，转换器必须保留该空值。修改份量或省略食材会丢弃已生成的领域对象，并把该菜谱全部步骤字段重新设为 `needs-review`。

### 8.2 已确认 Recipe

```ts
type Recipe = {
  id: string;
  name: string;
  sourceText: string;
  sourceServings: number | null;
  targetServings: number;
  ingredients: Ingredient[];
  steps: CookingStep[];
};
```

### 8.3 已确认 Ingredient

```ts
type Ingredient = {
  id: string;
  sourceText: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  sourceGrams: number | null;
  plannedGrams: number | null;
  nutritionRefId: string | null;
  status: "used" | "omitted";
};
```

### 8.4 已确认 CookingStep

```ts
type CookingStep = {
  id: string;
  recipeId: string;
  sourceText: string;
  instruction: string;
  durationMinutes: number;
  mode: "active" | "passive";
  dependsOn: string[];
  resources: ResourceRequirement[];
  isTerminal: boolean;
};
```

### 8.5 MealPlan

```ts
type MealPlan = {
  id: string;
  diners: number;
  availableFrom: string;
  serveAt: string;
  serveToleranceMinutes: 5;
  targetCaloriesPerPerson: number | null;
  kitchen: KitchenResources;
  recipes: Recipe[];
  nutritionSummary: NutritionSummary;
  schedule: ScheduleResult;
  schemaVersion: number;
};
```

### 8.6 TaskRuntimeState

```ts
type TaskRuntimeState = {
  taskId: string;
  status: "scheduled" | "ready" | "running" | "due" | "completed";
  plannedStart: string;
  plannedEnd: string;
  expectedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
};
```

具体类型会在实施计划中拆分到各领域模块，以上仅表示跨模块契约。

## 9. 错误处理

### 9.1 字段门禁

| 情况 | 是否允许排程 | 是否允许完整热量结论 | 处理方式 |
|---|---:|---:|---|
| 步骤时长缺失 | 否 | 视营养字段而定 | 用户补充并确认 |
| 依赖或资源缺失 | 否 | 视营养字段而定 | 用户补充并确认 |
| terminal task 缺失或重复 | 否 | 视营养字段而定 | 修正菜谱任务图 |
| `source` 字段证据缺失或不匹配 | 否 | 否 | 整批拒绝 AI 输出 |
| `inferred` 字段尚未确认 | 否 | 视营养字段而定 | 展示推断理由并由用户确认 |
| 食材克数或营养记录缺失 | 是 | 否 | 显示已知热量小计和缺失清单 |
| `sourceServings` 缺失或不大于零 | 是 | 否 | 禁止份量换算，要求用户补充并确认 |
| `targetServings` 已改变但派生数据未重新确认 | 否 | 否 | 失效重量、营养和排程并重新核对 |
| AI 输出 schema 或证据校验失败 | 否 | 否 | 整批拒绝并保留原始输入 |
| 本地持久化失败 | 是 | 是 | 降级到内存模式并持续警告 |

必要步骤不得被排除。营养缺失不阻止时间排程，但不得生成“达到热量目标”的结论。

### 9.2 必须覆盖的错误

必须覆盖：

- Codex 未安装、未登录、超时或额度不足；
- 模型输出无法通过 schema；
- 菜谱超过长度限制；
- 食材数量、单位或生熟状态不明确；
- 营养记录缺失；
- 步骤时长缺失；
- 依赖任务不存在或形成环；
- 厨师或设备资源不足；
- 烤箱温度冲突；
- 延迟后无法保持原上桌时间；
- 浏览器刷新、后台计时或本地数据损坏；
- Local AI 模式的数据发送确认被拒绝。

错误信息必须说明影响和恢复动作，例如：“2 项食材未匹配；当前仅显示已知热量小计，无法判断是否达到目标。”

## 10. 安全、隐私与健康边界

- Hosted Demo 只使用内置数据，不进行模型调用；
- Local AI 会将用户确认的菜谱文本通过 Codex 发送给 OpenAI，界面必须在发送前明确说明；
- Codex 解析在空临时目录和只读沙箱运行；
- 不读取邮箱、浏览历史、个人文件或其他项目；
- 不收集身高、体重、疾病或医疗目标；
- 热量始终标记为估算值；
- P0 过敏原只作为用户备注展示，不自动检测、过滤或做安全保证；
- 不生成医学、减重或疾病饮食建议；
- 不自行生成食品安全温度或熟度结论；
- 比赛版不提供食材替换；
- “观察提示”和步骤解释只能摘录或忠实改写原菜谱；原文缺失时显示“原菜谱未提供”，不得补写温度、熟度或安全建议；
- 内置演示数据使用虚构或明确可再分发的内容。

## 11. 测试策略

### 11.1 单元测试

营养模块：

- 克数与每 100 克热量计算；
- 份数缩放；
- 未解析食材存在时只生成已知热量小计；
- 所有食材解析后才允许完整总量与目标差值结论；
- 小数舍入与无效输入。

排程模块：

- 依赖顺序；
- terminal task 唯一性；
- `availableFrom` 下界；
- 五分钟同步完成窗口；
- 一名厨师的主动任务互斥；
- 烤箱和灶台互斥；
- 被动任务并行；
- 被动任务持续占用设备；
- P0 烤箱禁止共享；
- 依赖环；
- 不可行计划；
- 延迟传播与重排稳定性；
- 延迟只改变指定运行任务及其资源锁；
- 不可行时正向计算最早完成时间和原因码；
- 相同输入产生相同结果。

会话模块：

- 时间戳恢复；
- `scheduled -> ready -> running -> due -> completed` 状态转换；
- 到时不自动完成且继续占用资源；
- `due` 任务阻止相同资源的后续任务进入 `ready`；
- 资源冲突的 Start 请求被拒绝；
- Start 和 Delay 正确设置或更新 `expectedEnd`；
- Start、Delay 和 Complete 的事件合法性；
- 实际开始/结束偏差触发统一重排；
- 页面刷新后的状态恢复；
- 加速回放与真实时钟使用同一事件和状态机。

### 11.2 契约测试

- Codex 输出 schema；
- 内置样例 JSON；
- 持久化 schema 版本；
- 缺少 `sourceServings` 的已确认 Draft 可转换为 `Recipe` 并正常排程，但营养模块只显示已知热量小计；
- 模型失败后的回退路径。

### 11.3 端到端测试

- Local AI：确认数据发送、调用真实 GPT-5.6、校验 schema 并完成整单确认；
- Hosted Demo：无登录加载内置晚餐并完成完整回放；
- 载入演示晚餐；
- 设置人数、时间和热量目标；
- 核对菜谱；
- 生成时间线；
- 开始加速烹饪；
- 注入八分钟延迟；
- 验证时间线重排；
- 完成并查看总结。

### 11.4 人工验证

- 手机宽度下单手操作；
- 大号文字和高对比度；
- 厨房距离下关键信息可读；
- 英文文案清晰；
- 三分钟演示可完整走通。

## 12. UI 信息架构

### 12.1 页面

以下是产品视图，不要求拆成七个独立路由；P0 可使用一个页面内的分步流程降低实现成本：

1. Home：价值主张、内置演示和新建计划；
2. Setup：人数、时间、热量和厨房资源；
3. Import：菜谱输入与 AI 解析进度；
4. Review：字段、来源和置信度核对；
5. Plan：热量预算、冲突和资源泳道；
6. Cook：当前主动步骤、所有运行/到时计时器、下一步骤和延迟；
7. Summary：实际结果与改进建议。

### 12.2 视觉重点

- 温暖的餐饮色彩与清晰的工程时间线结合；
- 不以聊天窗口作为主界面；
- 关键操作使用大触控区域；
- 红色只用于不可行或需要立即处理的问题；
- 热量使用已知小计、完整总量门禁和未解析清单，不制造虚假精确感；
- 时间线同时支持列表视图，保证移动端可用。

## 13. 比赛与演示方案

### 13.1 三分钟脚本

- 0:00–0:20：问题——三份菜谱不能告诉你如何同时完成；
- 0:20–0:45：导入菜谱，展示 GPT-5.6 的结构化解析与原文证据；
- 0:45–1:10：发现每人热量高于目标以及烤箱资源冲突；
- 1:10–1:35：确认份量并生成资源时间线；
- 1:35–2:05：进入加速烹饪模式；
- 2:05–2:30：注入八分钟延迟并自动重排；
- 2:30–2:50：展示完成总结和新的预计上桌时间；
- 2:50–3:00：说明 Codex、GPT-5.6 与确定性引擎的分工。

### 13.2 评委测试路径

- 在线或本地打开静态演示；
- 点击 “Try the 650 kcal demo”；
- 无需登录即可完成加速流程；
- 本地安装、登录 Codex 并确认数据发送后可启用真实 GPT-5.6 菜谱导入；
- README 明确安装、支持平台、样例数据和验证命令；
- 仓库记录 Codex 使用、关键决策和 `/feedback` Session ID。

### 13.3 三天硬性实施顺序

#### Day 1：技术生死线与领域核心

- 实测本机 GPT-5.6 模型标识、登录方式、结构化输出、只读沙箱和超时行为；
- 若首选 Codex CLI 方式无法稳定运行，在限定时间内改用已核验的 Codex SDK 适配；若当天仍不能完成真实 GPT-5.6 解析，则项目未达到 P0，必须暂停并重新裁决方案，不能以 Hosted Demo 宣称完成；
- 锁定严格 schema、三份演示菜谱和小型营养数据；
- 以测试驱动完成营养计算、任务图校验和初始排程核心。

#### Day 2：完整用户闭环

- 完成 Setup、Review、Plan 与 Cook 主流程；
- 完成时间戳计时、延迟重排和内存/本地持久化；
- 接入 Hosted Demo、加速时钟与英文界面。

#### Day 3：只做验收与提交

- 完成端到端、移动端和错误路径验证；
- 修复阻塞问题，不增加新功能；
- 完成 README、演示视频、截图、Devpost 文案和最终提交。

### 13.4 Devpost 提交清单

- 英文项目名称和描述；
- Apps for Your Life 赛道；
- 可访问的 Hosted Demo 或明确本地测试路径；
- 公开代码仓库 URL 与合适的许可证；若使用私有仓库，授权 `testing@devpost.com` 和 `build-week-event@openai.com`；
- 英文 README：安装、样例数据、运行、测试、限制、Codex/GPT-5.6 用法；
- 公开 YouTube 演示视频，少于三分钟且包含音频；
- 视频中明确展示产品、Codex 和 GPT-5.6 的使用；
- 主构建任务的 `/feedback` Session ID；
- 提交前复核当日官方规则与截止时间。

## 14. 验收标准

以下条件全部满足才算比赛版完成：

- 内置三道菜能够稳定生成无重叠计划；
- Local AI 必须完成真实 GPT-5.6 解析、严格 schema 校验和整单确认；Hosted Demo 仅作为无登录评委的体验路径；
- 所有 AI 提取结果必须整单确认，证据偏移可验证；
- 营养计算结果有来源、可复算；有缺失时只显示已知小计；
- 未确认字段不能静默通过；
- 所有 terminal task 在五分钟同步窗口内完成，且任务不早于 `availableFrom`；
- 注入延迟后依赖和资源约束仍成立；
- 不可行计划返回明确原因；
- 加速模式与真实计时使用同一状态机；
- 无 Codex 登录时内置演示仍可运行；
- 英文 UI、README、公开演示和测试说明完整；
- 单元、契约和端到端测试通过；
- 视频在三分钟内展示完整闭环并说明 GPT-5.6/Codex 用法。

## 15. 参考借鉴摘要

本地工作区未发现可直接复用的餐饮、营养或排程项目，DinnerSync 将从零原创实现。

计划借鉴但不复制的稳定设计思想：

- Schema.org `Recipe` 的标准菜谱字段思想，用于减少自定义命名；
- 权威营养数据按 100 克记录并保留来源/状态的模式；
- Job-shop scheduling 的依赖和资源互斥建模；
- Codex 非交互模式的只读沙箱、临时会话和结构化输出；
- 时间戳驱动的前端计时与可恢复状态机。

本轮在线参考页面因网络连接故障未能完成读取。实施前必须再次核验精确字段、数据许可和 Codex 命令参数；在此之前不锁定外部 API 或复制任何第三方实现。

## 16. 已决定的取舍

- 选择本地优先，牺牲云端随开随用，换取无额外 API 费用和更清楚的隐私边界；
- 选择小范围确定性排程，牺牲通用性，换取三天内可验证的稳定产品；
- 选择份量控制作为 P0，比赛版不实现食材替换，降低营养和过敏原风险；
- 选择文字菜谱，推迟图片识别，保证解析与演示稳定；
- 选择显式人工核对，牺牲一步完成，换取来源透明与错误可控；
- 选择英文比赛 UI，内部文档和协作仍使用中文。
