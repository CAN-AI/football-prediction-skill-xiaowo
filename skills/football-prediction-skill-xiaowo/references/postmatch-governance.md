# 赛后记录与校准治理

赛后流程只能新增记录和候选提案，不得修改已经发布的 `prediction.json`、`run-manifest.json` 或既有报告。这里的校准结果用于模型调试，不是竞猜、投注或投资建议。

## 记录赛果

`recordPostmatch({ manifest, prediction, facts })` 接受已发布运行清单、该运行的预测对象和赛后事实。`facts` 必须包含：

- 显式 `predictionRunId` 与 `predictionSha256`，分别严格等于 `manifest.runId` 和 `manifest.artifacts.prediction.sha256`；缺少任一字段都会拒绝，不回退到 manifest 自身；
- `actualResult`，包含非负整数 `homeGoals`、`awayGoals`，`decidedIn`、不早于 `manifest.match.kickoffAt` 的 `observedAt`，以及 `sourceClaimId`；
- `acceptedClaims` 数组，或 `evidenceAudit.accepted` 数组。

`manifest.finalizedAt` 必须是非空且有效的 ISO 时间，并且是判断 `publishedBeforeKickoff` 的唯一发布时间。接口拒绝未定稿 manifest，不会回退到 `createdAt` 或 `dataCutoffAt`。

程序会在 accepted claims 中严格查找 `sourceClaimId`。对应 claim 必须满足 `topic: "result"`，其 `matchId`、`match.matchId` 或 `subject` 必须匹配清单中的比赛身份，且 `claim.value` 与 `actualResult` 的规范化事实必须完全相同。若 claim 自带 `factFingerprint`，它也必须等于共享规范化函数重新计算的 SHA-256 指纹。仅提供一个裸 `sourceClaimId` 不构成来源确认。

预测产物 SHA 是文件字节哈希。解析后的 JSON 对象不保留空白与结尾换行等字节信息，因此核心接口验证清单中的可信 SHA 与显式赛后绑定一致，不声称从解析对象重新计算文件字节哈希。`record-result.mjs` 会读取同一份原始 `prediction.json` 字节，在解析预测前计算 SHA-256，并同时与 manifest 和 facts 比较；任一不匹配都会拒绝。

只有 `actualResult.decidedIn` 显式为 `90min`，且预测自身的 `resultScope` 为 `90min` 时，输出记录才可能标记为 `comparable: true`。缺失口径、`extra_time`、`penalties` 或其他口径不会被默认补成 90 分钟：事实仍可在严格来源绑定后记录，但 `comparable` 固定为 `false`，不会进入 90 分钟校准。

命令行用法：

```bash
node scripts/record-result.mjs \
  --manifest <run-manifest.json> \
  --prediction <prediction.json> \
  --facts <facts.json> \
  --out <record.json>
```

输出使用独占创建；目标已存在时命令失败，从而避免覆盖既有记录。

## 可比较样本

`proposeCalibration(records)` 以输入中第一个非空 `competitionProfileKey` 为目标画像，只统计同时满足以下条件的记录：

1. `competitionProfileKey` 与目标完全相同；
2. `publishedBeforeKickoff === true`；
3. `comparable === true`；
4. `actualOutcome` 是 `home`、`draw` 或 `away`；
5. 三项概率均在 `[0, 1]` 内，且总和在 `1e-6` 误差内等于 1。

调用方应按单一赛事画像分别生成提案；其他赛事画像不会合并进样本数。

## 指标与门槛

多分类 Brier score 按每场三个方向的平方误差之和取样本均值：

```text
Brier = mean(sum((预测概率 - 实际 one-hot)²))
```

方向命中率是最大概率方向与实际方向相同的记录比例。无有效记录时，两项指标均为 `null`。

- 少于 30 场：`eligibility` 为 `insufficient_sample`，`proposedChanges` 必须为空，只能继续积累样本。
- 达到 30 场：`eligibility` 为 `eligible_for_human_review`，可以给出文本复核建议。
- 任意样本数：`requiresHumanApproval` 恒为 `true`，`applyAutomatically` 恒为 `false`。

校准提案不得自动改变当前模型或任何历史预测。人工批准、独立回测和新版本发布是后续独立步骤。

命令行用法：

```bash
node scripts/propose-calibration.mjs \
  --records assets/sample-data/postmatch-records.json \
  --out <calibration-proposal.json>
```

输入可为记录数组，也可为 `{ "records": [...] }`。输出同样使用独占创建，避免静默覆盖提案。
