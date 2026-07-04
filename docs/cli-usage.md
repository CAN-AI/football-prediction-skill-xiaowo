# CLI 使用说明

## 多 Agent 总控流水线

单场预测：

```bash
worldcup-xiaowo pipeline --data <snapshot.json> --match <matchId> --out-dir <output-dir>
```

批量预测：

```bash
worldcup-xiaowo pipeline --data <snapshot.json> --batch --out-dir <output-dir>
```

如果已经有收集 Agent 生成的资料包：

```bash
worldcup-xiaowo pipeline --collection <collection.json> --data <snapshot.json> --match <matchId> --out-dir <output-dir>
```

总控会输出 `pipeline-manifest.json`，记录收集、审计、预测、报告各阶段产物。

## 资料收集包

```bash
worldcup-xiaowo collect-template --match <matchId> --home <teamId> --away <teamId> --kickoff-at <iso-time> --out collection.json
worldcup-xiaowo audit-collection --collection collection.json --out collection-audit.json
```

`collection.json` 是联网收集后的资料包，不是正式预测输入。自媒体和社交平台只能作为线索，只有被可信来源支持或多来源交叉验证后，才允许影响模型。

## 审计输入

```bash
worldcup-xiaowo audit --data <snapshot.json>
```

输出 `ok/errors/warnings/expectedDataVersion/summary`。
如果快照写了 `metadata.snapshotContentHash`，审计还会重新计算内容哈希，防止数据内容被改动但版本号没有更新。

## 预测比赛

```bash
worldcup-xiaowo predict --data <snapshot.json> --match <matchId> --out <prediction.json>
```

也可以临时指定双方：

```bash
worldcup-xiaowo predict --data <snapshot.json> --home ARG --away ALG --stage group --venue-country USA
```

## 批量预测

```bash
worldcup-xiaowo predict-batch --data <snapshot.json> --out-dir <output-dir>
```

默认只预测快照中 `scheduled` 状态的比赛，并输出每场 `*.prediction.json` 以及 `batch-summary.json`。如果确实要把进行中比赛也纳入诊断，显式增加 `--include-live`：

```bash
worldcup-xiaowo predict-batch --data <snapshot.json> --include-live --out-dir <output-dir>
```

## 生成场景

```bash
worldcup-xiaowo scenario --prediction <prediction.json> --min-goals 3 --out <scenario.json>
```

场景筛选只过滤比分矩阵，不改变主模型胜平负概率。

## 记录赛果

```bash
worldcup-xiaowo record --prediction <prediction.json> --actual-home 3 --actual-away 0 --out <record.json>
```

## 生成报告

```bash
worldcup-xiaowo report --data <snapshot.json> --prediction <prediction.json> --record <record.json> --out <report.md>
```

报告会自动带出快照里的 `sourceVersions`、`strengthSnapshotVersion` 和 `officialFacts` 摘要，方便复核预测用了哪一批资料。默认情况下，快照审计失败会阻断正式报告生成；如果只是为了检查坏数据，可以显式增加 `--allow-failed-audit`。

## 生成修正建议

```bash
worldcup-xiaowo revise --records <record1.json,record2.json> --out revision-proposal.json
```

修正建议只用于人工复核，不会自动修改权重或旧预测。
