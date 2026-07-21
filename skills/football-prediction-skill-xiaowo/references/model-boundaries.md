# 90 分钟模型边界

`predict90({ manifest, snapshot, evidenceAudit })` 仅计算常规时间（90 分钟）主胜、平局、客胜、预期进球和完整的 0–7 比分矩阵。矩阵在 0–7 范围内截断后重新归一，因此它的全部概率之和为 1。

## 输入

- `manifest.competitionProfile.baseline.goalsPerTeam` 是唯一的进球均值基线，必须来自已审计的同赛事画像；模型不会借用世界杯或其他赛事的固定均值。
- `manifest.competitionProfile.homeAdvantage` 是主队预期进球增量，必须在 `[0, 1]` 内，中立场必须为 `0`，并与同一条已接受赛事基线 claim 的 `value.homeAdvantage` 严格同值。模型不再为缺失值回退到 `0`。
- `snapshot.teams` 必须以比赛主、客队 ID 为键提供 `rating`、`attack` 和 `defense` 数值。缺失数值会中止计算，不以默认球队数据填补。
- `evidenceAudit.status: "passed"` 必须同时提供审计产生的 `high` 或 `medium` 置信标签；`degraded_low_confidence` 一律在结果和追溯中记为 `low`；`failed` 或未知状态会拒绝预测，且不会读取其中的 `accepted` 项。低置信状态不会生成任何补充事实。

## 已接受调整

已接受证据可携带 `deterministicAdjustment`，其中仅支持有限数值的 `homeLambdaDelta` 与 `awayLambdaDelta`。战术资料只有携带已接受的确定性调整时才会影响计算；首发资料必须同时是已接受且 `confirmed` 或 `official_confirmed` 才可能使用确定性调整。候选首发和未确认首发不会产生调整。

## 排除范围

该函数不输出加时、点球、晋级、两回合总比分、市场融合、角球或未确认首发调整。它会在 `trace` 中保留基线版本、输入哈希、比分矩阵截断范围和数据置信度，便于后续报告与审计追溯。
