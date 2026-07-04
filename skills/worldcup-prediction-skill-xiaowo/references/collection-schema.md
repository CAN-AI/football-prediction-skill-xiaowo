# 资料包结构

`collection.json` 是收集 Agent 的输出。它不是正式预测输入，而是进入审计 Agent 前的资料包。

## 顶层结构

```json
{
  "metadata": {
    "collectionVersion": "xiaowo-collection-v2",
    "generatedAt": "2026-07-04T12:00:00+08:00",
    "matchId": "ARG-ALG-2026-06-17"
  },
  "match": {
    "matchId": "ARG-ALG-2026-06-17",
    "homeTeamId": "ARG",
    "awayTeamId": "ALG",
    "kickoffAt": "2026-06-17T20:00:00Z"
  },
  "claims": []
}
```

## claim 字段

- `id`: 资料条目 ID。
- `topic`: `schedule`、`ranking`、`injury`、`lineup`、`weather`、`venue`、`form`、`tactical`、`rumor`、`result` 或 `other`。
- `summary`: 这条资料说了什么。
- `sourceType`: `official`、`federation`、`data_provider`、`established_media`、`local_media`、`self_media`、`social`、`user_supplied` 或 `unknown`。
- `sourceName`: 来源名称。
- `sourceUrl`: 来源链接，没有链接时也要写清来源名称。
- `observedAt`: 收集到这条资料的时间。
- `confidence`: `high`、`medium` 或 `low`。
- `affectsModel`: 是否准备影响模型。
- `humanReviewed`: 是否已经人工复核。
- `verifications`: 交叉验证列表。

## 审计规则

- 自媒体、社交平台和未知来源默认只能作为线索。
- `affectsModel=true` 必须 `humanReviewed=true`。
- `confidence=low` 不能直接影响模型。
- `topic=rumor` 不能直接影响模型。
- 赛程时间类信息必须由官方、协会、数据商或权威媒体确认。
- 被可信来源反驳的资料不能影响模型。

## 生成模板

```bash
worldcup-xiaowo collect-template --match <matchId> --home <teamId> --away <teamId> --kickoff-at <iso-time> --out collection.json
```
