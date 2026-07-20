---
name: football-prediction-skill-xiaowo
description: 面向联赛、国内杯赛、洲际俱乐部赛事、国家队赛事和友谊赛的可审计足球预测工作流。需要建立或执行通用足球赛前预测、核查赛事范围、保留输入证据、生成 Markdown 与 PNG 报告或进行赛后复盘时使用。
---

# 小蜗通用足球预测 v3

以赛事画像、证据台账和不可变运行清单为边界，生成可审计的 90 分钟赛前预测与赛后校准提案。该 Skill 是独立的 v3 入口；不得改写 `worldcup-prediction-skill-xiaowo`、`worldcup-xiaowo` 或既有历史报告。

## 先读引用

- 跨 Agent 能力预检与命令约定：[references/agent-portability.md](references/agent-portability.md)
- 赛事画像选择与赛制边界：[references/competition-profile.md](references/competition-profile.md)
- 缺失资料、检索失败与上传请求：[references/missing-data-playbook.md](references/missing-data-playbook.md)
- 证据来源、冲突和截断时间：[references/evidence-policy.md](references/evidence-policy.md)
- 模型输出边界：[references/model-boundaries.md](references/model-boundaries.md)
- Markdown/HTML/PNG 报告契约：[references/report-layout.md](references/report-layout.md)
- 赛后记录与人工校准：[references/postmatch-governance.md](references/postmatch-governance.md)

## 能力预检

在读取或生成正式产物前，按顺序声明能力，不得假定宿主 Agent 一定联网或一定能运行本地命令。

1. **网络能力**：只有宿主明确提供网页搜索、浏览器或联网工具时才检索。记录实际查询、访问时间、成功来源和失败来源。没有网络能力时，不得声称已经搜索。
2. **Node.js 能力**：运行 `node --version`，要求 Node.js 18 或更高版本。不能执行 Node.js 时，停止正式流水线，列出未执行步骤。
3. **PNG 渲染器能力**：按 [agent-portability.md](references/agent-portability.md) 启动并关闭 Playwright Chromium。启动失败即停止正式流水线；不得用空白图、占位图或仅有 Markdown 的结果冒充完成。
4. **文件写入能力**：确认目标目录可写且目标 `runId` 不存在。历史运行不可覆盖。

## 执行协议

### 1. 确认任务和赛事画像

- 确认模式是 `prematch` 或 `postmatch`，并固定比赛 ID、主客顺序、开球时间和数据截止时间。
- 从 `league`、`domestic_cup`、`continental_club`、`national_tournament`、`friendly` 中选择赛事族。
- 明确常规时间、加时、点球、两回合和中立场规则。默认预测只覆盖 90 分钟；晋级、加时、点球、角球或市场比较都不是默认输出。
- 使用可审计的 `baselineVersion`；缺少赛事专用基线时不得静默套用另一赛事基线。
- `homeAdvantage` 必须是 `[0, 1]` 内的有限增量，中立场必须为 `0`，并与本次接受的同赛事基线 claim 精确同值。

### 2. 收集并审计证据

- 有搜索能力时，优先访问赛事组织方、协会、俱乐部官方、医疗官方和已声明的数据提供方；仅记录可访问、带时间和来源 URL 的证据。
- 每条入模事实必须进入证据台账，具有 claim ID、topic、subject、来源等级、发布时间、观察时间、审核状态和是否影响模型。
- 截止时间之后的证据、社交媒体、自媒体、未知来源、传闻或未确认候选首发不得入模。
- 同主题、同对象但指标定义版本或事件源不同的证据必须隔离为冲突，不得平均、择优拼接或猜测。
- 无法检索时，先按 [missing-data-playbook.md](references/missing-data-playbook.md) 列出**精确缺失字段、尝试过的来源及失败原因**，声明资料缺口后才可请求用户上传。

### 3. 决定通过、降级或失败

- 证据完整且无冲突：`passed`，按审计通过的事实计算。
- 有可继续运行的缺失或冲突：`degraded_low_confidence`，必须输出低置信标签、缺失项、冲突项和重算触发器；不得虚构资料补齐字段。
- 账本、截止时间或主客身份无法解析：`failed`，停止预测和正式报告生成。

### 4. 生成 90 分钟预测

- 只把审计通过、`affectsModel: true` 的确定性输入交给模型。
- 输出主胜、平局、客胜概率、预期进球、比分矩阵截断范围、模型版本、赛事基线版本与输入哈希。
- 报告 Agent 只能解释模型结果，不得手写、改算或润色概率；市场信息未通过去水和来源门禁时，不展示市场概率。

### 5. 生成同源正式报告

- 同一次正式运行必须由同一章节数据生成非空的 `report.md`、`report-long.html`、`report-long.png` 和 `render-audit.json`。
- `report-long.png` 必须来自 `report-long.html` 的 Playwright 全页截图。检查 430px 视口、水平溢出、表格溢出、页面高度、替换字符和 PNG 字节数。
- Markdown 或 PNG 任一缺失、为空或渲染审计失败，整次正式运行失败，不得发布残缺结果。
- 报告必须显式展示数据截止时间、90 分钟口径、证据缺失/冲突、置信度、来源索引与重算触发器。

### 6. 发布不可变运行

- 按固定顺序执行：加载输入 → 校验赛事画像 → 审计证据 → 写审计快照 → 计算预测 → 生成同源报告 → 渲染审计 → 计算 SHA-256 → 写最终清单。
- `run-manifest.json` 必须绑定运行 ID、独立证据账本、独立审计、输入快照、预测、Markdown、HTML、PNG 和渲染审计的固定路径、字节数与 SHA-256。
- 发布后不得回写赛前预测、报告或哈希；新证据只能创建新快照、新运行和新的父子关系。

### 7. 赛后记录与校准

- 赛果、事件和统计必须以 claim ID、topic、比赛身份及规范化值指纹绑定本次重新审计后接受的证据；不信任调用方自报 accepted。
- 正式赛后流程从父赛前目录复验全部文件，新建带 `parentRunId` 的 `postmatch` 清单与独立目录；引用原 `predictionRunId` 和预测 SHA-256，保留当时概率，不用实际结果改写旧预测。
- 校准入口只读取父子运行目录索引，并重新验证内外层 manifest、artifact SHA、父子绑定、父运行入模证据、重算预测、赛果证据审计和重算记录；画像键必须包含实际进球基线与主场优势，不得把可编辑 `record.json` 聚合或自报质量标志直接送入 30 场门槛。
- 只有至少 **30 场**同赛事画像、赛前已发布且可比较的样本才可形成参数调整提案。
- 所有提案必须 `requiresHumanApproval: true`、`applyAutomatically: false`；单场结果或不足 30 场时不得调参。

## 常用命令

```bash
# 测试 v3
npm run test:v3

# 正式赛前流水线
node ./skills/football-prediction-skill-xiaowo/scripts/run-pipeline.mjs \
  --input ./skills/football-prediction-skill-xiaowo/assets/sample-data/club-league-snapshot.json \
  --out-dir ./.tmp-v3-pipeline

# 正式赛后流水线（<prematch-run-dir> 是上一步生成的具体 runId 目录）
node ./skills/football-prediction-skill-xiaowo/scripts/run-postmatch-pipeline.mjs \
  --prematch-run-dir <prematch-run-dir> \
  --input ./skills/football-prediction-skill-xiaowo/assets/sample-data/postmatch-input.json \
  --out-dir ./.tmp-v3-postmatch

# 从不可变赛后记录生成待人工审核的校准提案
node ./skills/football-prediction-skill-xiaowo/scripts/propose-calibration.mjs \
  --runs ./postmatch-runs.json \
  --out ./.tmp-v3-calibration.json
```

`postmatch-runs.json` 的每项必须包含 `postmatchRunDir` 与 `prematchRunDir`。`assets/sample-data/postmatch-records.json` 仅保留为核心纯函数的合成示例，不能作为公开校准 CLI 输入。

## 原创工程流程图

三张图仅表达本 Skill 的工程流程，不使用第三方品牌、版式或文案：

- 生命周期：[assets/v3-lifecycle-flow.png](assets/v3-lifecycle-flow.png)
- 冲突与降级：[assets/v3-conflict-degrade-flow.png](assets/v3-conflict-degrade-flow.png)
- 不可变血缘：[assets/v3-lineage-flow.png](assets/v3-lineage-flow.png)

可用 `node ./skills/football-prediction-skill-xiaowo/scripts/render-flowcharts.mjs` 确定性重绘三张 PNG。

## 风险声明

本 Skill 用于 AI 模型调试、数据实验和预测方法研究。所有概率都有误差，低置信结果尤其需要谨慎解释；输出不构成竞猜、投资、下注或其他财务建议。
