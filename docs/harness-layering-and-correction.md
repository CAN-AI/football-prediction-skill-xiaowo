# 工程框架分层、修正与自动复核

这个项目的核心价值不是一个公式，而是一个可循环的工程框架。非技术理解：它像一条生产线，每一层只做自己的事，出了问题能追到是哪一层的问题。

![工程框架分层与自动复核机制](./assets/harness-layered-correction.png)

## 分层设计

| 层级 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| 资料层 | 收集赛程、排名、状态、伤停、赛果 | 不直接给胜率 |
| 快照层 | 把资料整理成统一数据快照 | 不判断比赛结果 |
| 审计层 | 检查版本、来源、完整性、修正规则 | 不修数据、不猜概率 |
| 模型层 | 计算预期进球、比分矩阵、胜平负概率 | 不写营销文案 |
| 报告层 | 把模型输出解释给人看 | 不手写或篡改概率 |
| 复盘层 | 记录赛后命中、偏差、概率校准分 | 不改旧预测 |
| 修正层 | 形成下一版结构化修正 | 不用一句“AI 觉得”覆盖数据 |

## 自动化闭环

```bash
worldcup-xiaowo audit --data snapshot.json
worldcup-xiaowo predict --data snapshot.json --match MATCH_ID --out prediction.json
worldcup-xiaowo scenario --prediction prediction.json --min-goals 3 --out scenario.json
worldcup-xiaowo record --prediction prediction.json --actual-home 3 --actual-away 0 --out record.json
worldcup-xiaowo report --data snapshot.json --prediction prediction.json --record record.json --out report.md
```

这五步的意义：

1. `audit`: 确认数据能不能用。
2. `predict`: 用同一套公式生成概率。
3. `scenario`: 从比分矩阵筛出内容脚本，不改原胜率。
4. `record`: 赛后记录命中和偏差。
5. `report`: 把全过程写成可复核报告。

## 修正怎么发生

修正必须经过三道门：

1. 有事实来源：比如首发、伤停、赛果、赛程、天气或人工复盘结论。
2. 有结构化表达：写成 `formScoreDelta`、`attackMultiplier`、`defenseMultiplier`、`ratingDelta` 等字段。
3. 有审计记录：`derivation` 必须是 `manual_review`、`source_update` 或带 `ruleVersion` 的 `deterministic_rule`。

示例：

```json
{
  "id": "review-arg-pressing-v2",
  "scope": "team",
  "teamId": "ARG",
  "derivation": "manual_review",
  "humanReviewed": true,
  "impact": {
    "formScoreDelta": 1,
    "attackMultiplier": 1.02
  }
}
```

## 为什么不让 AI 直接改胜率

如果 AI 可以直接把“我觉得强队更稳”改成“胜率 +5%”，后续就无法回答三个问题：

- 这 5% 根据什么？
- 谁复核过？
- 下一次为什么又变了？

所以本项目只允许 AI 帮忙做解释、总结、提出修正建议；真正影响模型的东西必须写进快照并重新计算。

## 复盘如何防止事后诸葛

- 赛前 `prediction.json` 保留不动。
- 赛后新增 `record.json`。
- 下一版修正另开新快照。
- 报告里同时写“预测方向、实际方向、比分排名、Brier score”。

这样即使预测错了，也能看出是数据问题、模型问题、临场问题，还是足球本身的小概率波动。

## 对国内 agent 的意义

国内很多 agent 工作流容易停在“我给你一个判断”。这个 harness 的做法是把判断拆成文件、命令和版本：

- agent 能安装 skill。
- 用户能替换快照。
- 脚本能重复运行。
- 报告能解释给非技术人员。
- 赛后能留下可追溯修正。

这比一次性生成文案更适合长期维护和开源协作。
