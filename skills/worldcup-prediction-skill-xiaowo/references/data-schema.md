# 数据结构说明

本项目只接受结构化 JSON 快照。非技术理解：快照就是模型开算前的一张“数据底稿”，里面写清楚用了哪些数据、数据版本、哪些球队、哪些比赛、有没有人工复核过的修正。

## 顶层字段

- `metadata`: 数据批次信息。必须包含 `modelVersion`、`dataVersion`、`sourceVersions`、`strengthSnapshotVersion`、`expectedTeamCount`、`generatedAt`。推荐增加 `snapshotContentHash`，用于发现快照内容被改动但版本号没有更新。
- `teams`: 球队强度表。每支球队至少要有 `id`、`name`、`strengthVersion`，以及 `ratingValue`、`eloRating`、`fifaRank` 三者之一。
- `matchStates`: 比赛列表。预测时推荐用 `matchId` 指定比赛。
- `contextAdjustments`: 修正项，例如伤停、轮换、赛程、赛后复盘形成的人工修正。
- `officialFacts`: 用于报告解释的事实材料，不直接改变概率。

## metadata 版本规则

`dataVersion` 由 `sourceVersions` 和 `strengthSnapshotVersion` 计算得到。这样做的目的不是炫技，而是防止“今天的排名、昨天的伤停、前天的攻防强度”混在一起。

命令：

```bash
node scripts/audit-input.mjs --data examples/snapshots/sample-worldcup-snapshot.json
```

如果版本不对，审计会直接告诉你应该写成哪个 `dataVersion`。

`snapshotContentHash` 是可选但推荐的内容哈希。它只覆盖 `teams`、`matchStates`、`contextAdjustments` 和 `officialFacts` 这些会影响预测或报告复核的数据区，不覆盖 `metadata` 自身。这样可以避免哈希字段自我循环，同时能发现“同一个 `dataVersion` 下有人改了球队强度、比赛状态或修正项”的问题。

## 修正项字段

允许的 `derivation`：

- `manual_review`: 人工复核后的修正。
- `deterministic_rule`: 固定规则，例如淘汰赛首轮节奏保守；必须写 `ruleVersion`。
- `source_update`: 明确来源更新，例如首发确认。

不允许 AI 直接写“我觉得主队更强所以概率+5%”。AI 可以提出建议，但必须转成结构化 `impact` 后重新审计和计算。
