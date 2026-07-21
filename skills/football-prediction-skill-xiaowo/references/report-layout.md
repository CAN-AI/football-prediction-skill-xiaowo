# 报告布局与渲染契约

## 同源产物

每次成功生成必须同时存在以下四个非空文件：

- `report.md`
- `report-long.html`
- `report-long.png`
- `render-audit.json`

Markdown 与 HTML 由 `core/report.mjs` 中同一个章节文档生成。PNG 只能由同一份 HTML 经 Playwright Chromium 全页截图生成，不能使用静态占位图。Chromium 无法启动时，生成脚本必须在写入报告前明确失败。

## 赛前章节顺序

1. 赛制与口径
2. 执行结论
3. 证据审计
4. 实力与状态
5. 人员可用性
6. 战术对位
7. 环境因素
8. 方法说明
9. 90分钟胜平负概率
10. 比分候选
11. 市场比较
12. 淘汰赛分支
13. 不确定性与重算触发器
14. 结论
15. 来源索引

市场概率只有同时满足以下条件时才可展示：

- `audited` 严格等于 `true`；
- `scope` / `resultScope` 明确为 90 分钟，且 `probabilityType` / `method` 明确为 `de_vig`（也接受等价的显式去水标记）；
- `observedAt` 是非空有效时间；
- `source` 或 `sourceUrl` 非空；
- 主胜、平局、客胜概率均在 `[0, 1]`，且三者之和在 `0.001` 容差内等于 1。

任一条件不满足时，不得输出市场概率和差值；市场章节只显示门禁失败说明，证据审计的缺失信息列出失败原因。来源索引只列 `evidenceAudit.accepted` 中的证据，未接受证据只计数，不展示为事实。

## 赛后章节顺序

1. 赛前运行绑定
2. 赛果事实与事件时间线
3. 过程统计与来源口径
4. 预测命中审计
5. 校准指标
6. 禁止事后回写
7. 修正提案
8. 人工批准项
9. 来源索引

赛后报告保留原预测概率，不以实际结果改写赛前预测，也不凭单场结果自动调整模型权重。

## 结构化赛后输入

推荐在输入根对象使用 `postmatch`：

```json
{
  "postmatch": {
    "prematchBinding": { "runId": "...", "predictionHash": "..." },
    "actualResult": {
      "homeGoals": 2,
      "awayGoals": 1,
      "decidedIn": "90min",
      "observedAt": "2026-08-01T17:00:00Z",
      "sourceClaimId": "result-claim-id"
    },
    "eventTimeline": [
      { "minute": 18, "event": "主队进球", "teamId": "HOME", "sourceClaimId": "event-claim-id" }
    ],
    "processStatistics": [
      { "metric": "射门", "home": 14, "away": 8, "definition": "官方全场射门口径", "sourceClaimId": "stats-claim-id" }
    ],
    "calibrationMetrics": { "brierScore": 0.31, "logLoss": 0.8, "sampleSize": 1 },
    "noPosthocRewrite": { "enforced": true, "predictionHashUnchanged": true },
    "revisionProposal": { "proposalId": "...", "status": "pending_human_review", "summary": "..." },
    "humanApprovals": [
      { "itemId": "...", "status": "pending", "approver": null, "decidedAt": null }
    ]
  }
}
```

`actualResult`、`eventTimeline` 和 `processStatistics` 的每一项都必须通过四重门禁：

1. `sourceClaimId`（或同名 `claimId`）精确指向 `evidenceAudit.accepted` 中的 claim；
2. topic 分别严格为 `result`、`event`、`statistics`，不接受 `injury`、`lineup` 等相邻主题替代；
3. claim 的 `matchId` / `match.matchId` / `subject` 必须精确匹配报告比赛；有 `manifest.match.matchId` 时只接受该 ID，没有时才接受固定的主客 ID 或主客名称组合；
4. claim 的结构化 `value` 与准备展示的事实分别规范化为固定键对象并计算 SHA-256 指纹，指纹必须完全相同；claim 若自带 `factFingerprint`，它也必须等于由其 `value` 重新计算的指纹。

规范化赛果值包含 `homeGoals`、`awayGoals`、`decidedIn`、`observedAt`；事件值包含 `minute`、`occurredAt`、`event`、`teamId`、`teamName`；过程统计值包含 `metric`、`home`、`away`、`definition`。绑定缺失、主题错误、比赛身份不符或任一规范化字段不同时，对应事实全部显示“未提供”，不得泄露原始数值。运行绑定、校准、回写治理、修正提案和人工批准字段缺失时同样明确显示“未提供”。

## 视觉系统

- 固定浏览器视口宽度：430px；全页截图；设备缩放倍率为 1。
- 深蓝：封面、表头和信息骨架。
- 浅蓝：常规数据卡片。
- 绿色：执行结论、复盘摘要和最终结论。
- 红色：缺失、低置信、风险和校准提醒。
- 金色：无数据说明、赛制分支与环境提示。
- 深色：方法、公式和概率评估。
- 字体回退：Noto Sans CJK SC、微软雅黑、苹方、思源黑体及通用无衬线字体。

表格必须 `width: 100%`、固定布局并允许单元格断词，禁止把水平滚动作为移动端默认展示方式。

## 渲染审计

`render-audit.json` 至少记录：

- Chromium 名称和版本；
- 430px 视口；
- 文档宽度与高度；
- 页面高度是否合法；
- 是否存在水平溢出；
- 发生溢出的表格明细；
- 是否出现 Unicode 替换字符 `U+FFFD`；
- PNG 路径、字节数和存在状态。

PNG 缺失或为空、水平溢出、表格溢出、替换字符或页面高度无效时，生成脚本必须非零退出。
