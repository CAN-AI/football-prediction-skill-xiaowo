# 模型方法论

## 给非技术读者的版本

这个模型不是先猜比分。它先估算两队各自“应该进几个球”，再把所有可能比分列成一张表，比如 0-0、1-0、1-1、2-1，一直到 7-7。每个比分都有一个概率。最后把所有主队赢的比分加起来，就是主胜概率；把所有平局比分加起来，就是平局概率；把所有客队赢的比分加起来，就是客胜概率。

## 技术路径

1. `ratingValue` 或 `eloRating` 表示基础实力；没有时使用 FIFA 排名兜底。
2. `formScore` 表示近期状态，范围建议为 0-100。
3. `attackStrength` 是进攻系数，`defenseStrength` 是失球/防守压力系数；低于 1 表示更稳，高于 1 表示更容易给对手机会。
4. 模型把实力差、状态差、攻防系数和主办地因素转换为双方 xG。
5. xG 进入泊松分布，生成完整比分矩阵。
6. Dixon-Coles 修正只处理低比分相关性，主要影响 0-0、1-0、0-1、1-1。
7. 胜平负概率来自比分矩阵汇总，不是直接问 AI。

## 当前公式摘要

```text
homeXG = 1.32 * homeAttack * awayDefense
       + ratingDelta * 0.38
       + formDelta * 0.15
       + hostBoost

awayXG = 1.32 * awayAttack * homeDefense
       - ratingDelta * 0.38
       - formDelta * 0.15
       + hostBoost
```

其中 `ratingDelta = (homeRating - awayRating) / 400`，`formDelta = (homeForm - awayForm) / 100`。

## 边界

- 它不能自动知道临场伤病、突然轮换、天气、红牌和比赛中战术变化。
- 它能表达“现在这份快照下的概率”，不能保证结果。
- 大比分、小概率冷门、点球大战和晋级结果需要单独建模。
