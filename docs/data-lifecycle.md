# 数据生命周期

## 1. 收集信息

推荐收集：

- 官方赛程、开球时间、场地和阶段。
- FIFA 排名、Elo 或自建综合评分。
- 近期战绩、进失球、对手强度。
- 球队进攻强度和防守强度。
- 首发、伤停、停赛、轮换、天气和赛程密度。
- 已完赛结果，用于复盘和下一版快照。

## 2. 整理为快照

把信息写进 `snapshot.json`。所有球队必须使用同一个 `strengthSnapshotVersion`，所有来源必须写入 `sourceVersions`。

## 3. 审计

```bash
worldcup-xiaowo audit --data ./examples/snapshots/sample-worldcup-snapshot.json
```

审计通过后再预测。审计不通过时，先修数据，不要让 AI 绕过审计。

## 4. 预测

```bash
worldcup-xiaowo predict --data ./examples/snapshots/sample-worldcup-snapshot.json --match ARG-ALG-2026-06-17 --out ./reports/arg-alg.json
```

## 5. 报告

```bash
worldcup-xiaowo report --data ./examples/snapshots/sample-worldcup-snapshot.json --prediction ./reports/arg-alg.json --out ./reports/arg-alg.md
```

## 6. 赛后复盘

```bash
worldcup-xiaowo record --prediction ./reports/arg-alg.json --actual-home 3 --actual-away 0 --out ./examples/records/arg-alg.record.json
```

复盘只新增记录，不覆盖预测。下一次预测时，把复盘形成的可靠修正写进下一版快照。
