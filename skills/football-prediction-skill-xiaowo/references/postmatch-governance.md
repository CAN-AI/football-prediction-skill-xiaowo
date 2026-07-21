# 赛后记录与校准治理

赛后流程只能新增记录和候选提案，不得修改已经发布的 `prediction.json`、`run-manifest.json` 或既有报告。这里的校准结果用于模型调试，不是竞猜、投注或投资建议。

## 记录赛果

`recordPostmatch({ manifest, prediction, facts })` 接受已发布运行清单、该运行的预测对象和赛后事实。`facts` 必须包含：

- 显式 `predictionRunId` 与 `predictionSha256`，分别严格等于 `manifest.runId` 和 `manifest.artifacts.prediction.sha256`；缺少任一字段都会拒绝，不回退到 manifest 自身；
- `actualResult`，包含非负整数 `homeGoals`、`awayGoals`，`decidedIn`、不早于 `manifest.match.kickoffAt` 的 `observedAt`，以及 `sourceClaimId`；
- 显式 `dataCutoffAt` 与原始 `evidenceLedger` 数组。`recordPostmatch` 会在本次调用中重新执行来源、时间、审核状态、冲突和有效期审计；调用方自报的 `acceptedClaims` 或旧 `evidenceAudit.accepted` 不受信任。

`manifest.finalizedAt` 必须是非空且有效的 ISO 时间，并且是判断 `publishedBeforeKickoff` 的唯一发布时间。接口拒绝未定稿 manifest，不会回退到 `createdAt` 或 `dataCutoffAt`。

程序会在本次重新审计后的 accepted claims 中严格查找 `sourceClaimId`。对应 claim 必须满足 `topic: "result"`，其 `matchId`、`match.matchId` 或 `subject` 必须匹配清单中的比赛身份，且 `claim.value` 与 `actualResult` 的规范化事实必须完全相同。若 claim 自带 `factFingerprint`，它也必须等于共享规范化函数重新计算的 SHA-256 指纹。仅提供一个裸 `sourceClaimId` 或调用方声明“已接受”不构成来源确认。

预测产物 SHA 是文件字节哈希。解析后的 JSON 对象不保留空白与结尾换行等字节信息，因此核心接口验证清单中的可信 SHA 与显式赛后绑定一致，不声称从解析对象重新计算文件字节哈希。`record-result.mjs` 会读取同一份原始 `prediction.json` 字节，在解析预测前计算 SHA-256，并同时与 manifest 和 facts 比较；任一不匹配都会拒绝。

只有来源显式给出 90 分钟结果，且预测自身的 `resultScope` 为 `90min` 时，输出记录才可能标记为 `comparable: true`。`decidedIn: "90min"` 可直接使用终场比分；加时或点球赛果必须另带 `ninetyMinuteResult`。缺失该字段时不会把加时/点球后的终场比分补成 90 分钟赛果，报告显示“未提供”，记录不进入 90 分钟校准。

命令行用法：

```bash
node scripts/record-result.mjs \
  --manifest <run-manifest.json> \
  --prediction <prediction.json> \
  --facts <facts.json> \
  --out <record.json>
```

输出使用独占创建；目标已存在时命令失败，从而避免覆盖既有记录。

正式赛后发布必须使用不可变赛后流水线。它从父赛前运行目录读取并逐文件复验 manifest 中的路径、字节数和 SHA-256，新建 `mode: "postmatch"`、带 `parentRunId` 的子运行，写入 `evidence-ledger.json`、`audit.json`、`input-snapshot.json`、父预测原始字节副本、`record.json`、同源报告、PNG 和渲染审计，再统一哈希定稿：

```bash
node scripts/run-postmatch-pipeline.mjs \
  --prematch-run-dir <赛前运行目录> \
  --input assets/sample-data/postmatch-input.json \
  --out-dir <赛后运行根目录>
```

公开 `football-xiaowo report` 不接受可编辑 postmatch fixture。复验既有赛后报告时必须同时提供子赛后目录与父赛前目录；命令逐项检查父子清单、九项赛后 artifact、证据重审计和重新计算的记录，重建 Markdown/HTML 并在临时目录重渲染 PNG 做字节比较，只报告验证结果，不生成或覆盖正式文件：

```bash
football-xiaowo report \
  --run-dir <赛后运行目录> \
  --prematch-run-dir <父赛前运行目录>
```

PNG 复验是重新渲染后的逐字节比较，必须固定 Playwright/Chromium、字体和运行时版本。跨环境差异可能导致保守拒绝，因此正式复验应在发布环境中执行。

## 可比较样本

`competitionProfileKey` v2 是对赛事族、赛事、赛季、级别、阶段、基线版本、`baseline.goalsPerTeam`、基线样本窗口、`homeAdvantage`、中立/两回合/加时/点球规则的规范化哈希。核心计算函数 `proposeCalibration(records)` 只接受已经由可信运行加载器重新构造的记录；公开 CLI 不接受 records 文件。它以输入中第一个非空画像键为目标，并从记录携带的完整 `competitionProfile` 复算该键，只统计同时满足以下条件的记录：

1. `competitionProfileKey` 与目标完全相同；
2. `publishedBeforeKickoff === true`；
3. `comparable === true`；
4. `actualOutcome` 是 `home`、`draw` 或 `away`；
5. 三项概率均在 `[0, 1]` 内，且总和在 `1e-6` 误差内等于 1；
6. `predictionRunId`、`matchId` 非空且在本组唯一，`predictionSha256` 是 64 位 SHA-256；
7. `resultScope` 与事实均为 90 分钟，方向和比分一致；
8. 预测谱系、赛果证据接受状态与未污染标志全部通过。

重复运行/比赛、跨画像、坏哈希、未审计赛果、受污染数据和概率错误都会进入 `dataQualityExclusions`，不会凑入 30 场门槛。

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
  --runs <postmatch-runs.json> \
  --out <calibration-proposal.json>
```

`postmatch-runs.json` 可为数组，也可为 `{ "runs": [...] }`；每项只提供 `postmatchRunDir` 和 `prematchRunDir`。相对目录按索引文件所在目录解析。CLI 会逐项复验定稿状态、全部 artifact SHA/字节数、内外层 snapshot manifest、父子绑定、父运行入模证据与重算预测、父预测原始字节、原始 evidence ledger、重算 audit 与重算 record，再把重构记录交给核心计算。索引中的任何记录字段或质量标志均被忽略。输出使用独占创建，避免静默覆盖提案。
