# Task 7 RED/GREEN 报告

基线：`3acc3e8 fix: reject malformed explicit evidence ledgers`

## 实现范围

- 新增 `recordPostmatch({ manifest, prediction, facts })`，将赛后记录绑定到已发布运行的 `runId` 与 `manifest.artifacts.prediction.sha256`。
- 新增共享 `core/facts.mjs`，从 Task5 抽取规范化事实、稳定 JSON SHA-256 指纹与 claim 绑定规则；`report.mjs` 与赛后记录使用同一实现。
- 赛果必须绑定 `acceptedClaims` 或 `evidenceAudit.accepted` 中的 `result` claim；严格校验 `sourceClaimId`、比赛身份、规范化事实和可选 `factFingerprint`。
- 赛果 `observedAt` 早于 `kickoffAt` 时拒绝记录；比分必须为非负整数。
- 记录对象深冻结，只复制预测概率和清单绑定，不修改或回写传入的预测对象。
- 新增 `proposeCalibration(records)`，只统计同一 `competitionProfileKey`、赛前已发布、可比较、结果与概率合法的样本。
- 计算多分类 Brier score 与方向命中率；少于 30 场只返回 `insufficient_sample` 和空提案，达到门槛后只返回文本复核建议。
- 所有提案恒为 `requiresHumanApproval: true`、`applyAutomatically: false`。
- 新增两个独占写入 CLI、示例记录和治理文档。

## 绑定口径

Task6 清单保存的是 `prediction.json` 文件字节 SHA-256。解析后的 JSON 对象不保留空白、缩进和结尾换行，因此 `recordPostmatch` 只验证清单中的可信 SHA 与调用方显式 `predictionSha256` 绑定一致，不声称从解析对象复算文件字节哈希。治理文档明确说明：若要复验文件，应在 JSON 解析前对原始字节计算 SHA-256。

赛果来源不能只凭裸 `sourceClaimId`。接口必须获得 accepted claim，且该 claim 同时满足：

1. `claimId` 等于 `actualResult.sourceClaimId`；
2. `topic` 严格为 `result`；
3. `matchId`、`match.matchId` 或 `subject` 匹配清单比赛身份；
4. `claim.value` 与待记录赛果经共享字段规范化后的 SHA-256 指纹完全一致；
5. claim 自带 `factFingerprint` 时，它也必须与重新计算值一致。

## RED 记录

按以下顺序观察到预期失败后，才编写对应生产代码：

1. 首个门槛测试因 `core/postmatch.mjs` 不存在，以 `ERR_MODULE_NOT_FOUND` 失败。
2. 新增记录绑定测试后，模块因缺少 `recordPostmatch` 导出失败。
3. 30 条记录中含 1 条非法概率时，旧过滤错误返回 `comparableSampleCount: 30`，期望为 29。
4. `record-result.mjs` 不存在时，真实子进程以 `MODULE_NOT_FOUND` 失败。
5. `propose-calibration.mjs` 不存在时，真实子进程以 `MODULE_NOT_FOUND` 失败。
6. 来源审查收紧后，裸 `sourceClaimId` 和 topic/比赛身份/事实不匹配 claim 均出现 `Missing expected exception`，证明旧实现确实会错误接受。

## GREEN 记录

Task7 专项测试：

```text
node --test skills/football-prediction-skill-xiaowo/tests/postmatch.test.mjs
tests 12, pass 12, fail 0
```

Task5 共享事实规则回归：

```text
node --test skills/football-prediction-skill-xiaowo/tests/report.test.mjs
tests 16, pass 16, fail 0
```

示例校准 CLI：

```text
node skills/football-prediction-skill-xiaowo/scripts/propose-calibration.mjs \
  --records skills/football-prediction-skill-xiaowo/assets/sample-data/postmatch-records.json \
  --out .tmp-v3-calibration.json

comparableSampleCount: 3
eligibility: insufficient_sample
requiresHumanApproval: true
applyAutomatically: false
proposedChanges: []
```

## 完成前验证

完整 v3 回归：

```text
npm run test:v3
tests 74, pass 74, fail 0
```

旧版完整回归：

```text
npm test
unit tests 12, pass 12, fail 0；全部样例链路退出码 0
```

附加检查：

```text
node --check core/facts.mjs                         PASS
node --check core/postmatch.mjs                     PASS
node --check scripts/record-result.mjs              PASS
node --check scripts/propose-calibration.mjs        PASS
git diff --check                                    PASS
```
