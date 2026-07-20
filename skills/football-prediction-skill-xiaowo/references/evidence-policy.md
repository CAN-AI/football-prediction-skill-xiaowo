# V3 证据审计策略

本策略用于赛前及赛后结构化证据账本，不提供竞猜、投注或投资建议。账本中的事实必须可回溯到公开、可访问的来源；无网络、付费墙、来源冲突或无法确认时，审计结果必须列出缺失字段并降级，不能补写或猜测事实。

## 来源权威性

| 主题 | 可接受来源等级 |
| --- | --- |
| `schedule`、`regulation` | `official`、`competition_official`、`governing_body` |
| `lineup` | `official`、`competition_official`、`governing_body`、`club_official` |
| `injury` | `official`、`club_official`、`medical_official` |
| `statistics` | `official`、`competition_official`、`data_provider` |
| `xg` | `data_provider` |
| `weather` | `weather_provider`、`official` |
| `market` | `market_exchange`、`market_provider`、`data_provider` |
| `result` | `official`、`competition_official`、`governing_body`、`organizer`、`federation`、`data_provider` |
| `event` | `official`、`competition_official`、`governing_body`、`organizer`、`federation`、`data_provider` |

`social`、`self_media` 和 `unknown` 永不进入模型。所有入模证据必须具有 `reviewStatus: "accepted"`、`affectsModel: true`、`sourceUrl`、`publishedAt` 与 `observedAt`；发布时间或观察时间晚于 `cutoffAt` 的证据也不得入模。

赛后报告对 `result`、`event` 和 `statistics` 另有严格绑定：claim ID、topic、比赛身份以及规范化 `value` 指纹必须同时匹配报告准备展示的事实；仅通过本层来源权威审计并不自动授权任意报告值。

## 首发、冲突与降级

`lineup` 主题只有 `lineupStatus: "confirmed"` 或 `"official_confirmed"` 才能入模。候选首发、传闻首发和未确认名单一律留在拒绝记录中。

同一 `topic` 与 `subject` 内，只要 `metricDefinitionVersion` 或 `eventFeedId` 不同（包括一个缺失、另一个已声明），所有相关值都必须隔离到 `conflicts`，不得合并、平均或择一入模。冲突组先从全部结构可识别的账本条目建立，不受来源、审核或截断时间的拒绝结果影响；因此同组的所有条目都不可进入模型，但每条原有拒绝理由仍须保留。此规则不是“数值冲突时自动选择更权威来源”的替代方案；审计会保留冲突值和 claim ID 以便人工复核。只有未来在人工决议理由已被结构化记录时，才可扩展为放行单条证据；本版本不实现该扩展。

以下字段缺失会原样出现在 `missing`：`match.homeTeamId`、`match.awayTeamId`、`match.kickoffAt`、`cutoffAt`，以及每条证据的 `claimId`、`topic`、`subject`、`sourceTier`、`sourceUrl`、`publishedAt`、`observedAt`、`affectsModel`、`reviewStatus`。缺失、拒绝或冲突时返回 `degraded_low_confidence` 与低置信度；账本或截断时间无法解析时返回 `failed`。其余无异常的账本返回 `passed` 与高置信度。
