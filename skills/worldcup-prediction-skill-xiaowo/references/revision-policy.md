# 修正与复盘规则

## 原则

预测发布后不能改原文件。赛后只新增 `record.json` 和下一版快照。

第二版新增 `revision-proposal.json`：它只记录修正建议，不自动改权重。所有权重或快照强度变化都必须人工确认。

## 可以修正什么

- 新确认的首发、伤停、停赛。
- 赛后确认的战术变化和强度偏差。
- 长期样本显示某一类球队被系统性高估或低估。
- 规则性场景，例如淘汰赛首轮更保守。

## 不可以怎么修正

- 不允许赛后把原预测改成命中。
- 不允许把 AI 的自然语言判断直接写成概率。
- 不允许只因为一场冷门就大幅调参。
- 不允许修正 Agent 自动写入权重配置。

## 推荐复盘指标

- `hitOutcome`: 胜平负方向是否命中。
- `hitExactScore`: 头号比分是否命中。
- `actualScoreRank`: 实际比分在矩阵中的排名。
- `brierScore`: 胜平负概率校准误差。

复盘的目标是让模型下一次更稳，不是证明某一场一定应该猜中。

## 推荐命令

```bash
worldcup-xiaowo revise --records record1.json,record2.json --out revision-proposal.json
```
