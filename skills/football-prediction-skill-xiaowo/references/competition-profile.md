# 赛事画像选择指南

赛事画像用于锁定基线、赛制和可比较样本范围。它不是自由文本标签，也不能在预测完成后为了贴合结果而修改。

## 支持的赛事族

| `family` | 适用范围 | 必须核验 |
| --- | --- | --- |
| `league` | 职业俱乐部联赛 | 赛季、主客规则、积分口径 |
| `domestic_cup` | 国内杯赛 | 单场/两回合、重赛、加时、点球 |
| `continental_club` | 洲际俱乐部赛事 | 阶段、两回合、中立场、客场规则 |
| `national_tournament` | 成年男足国家队赛事 | 小组/淘汰阶段、中立场、加时、点球 |
| `friendly` | 俱乐部或成年国家队友谊赛 | 换人规则、比赛时长、是否存在非常规赛制 |

## 最小字段

```json
{
  "family": "league",
  "competitionId": "ENG-PL",
  "season": "2026-27",
  "level": "senior_professional",
  "baselineVersion": "eng-pl-2026-27-r1",
  "baseline": {
    "goalsPerTeam": 1.55,
    "sampleWindow": { "from": "2025-08-01", "to": "2026-05-31", "matchCount": 380 },
    "evidenceClaimIds": ["eng-pl-baseline-2026-27"]
  },
  "regulation": {
    "extraTime": false,
    "penalties": false,
    "twoLegged": false,
    "neutralVenue": false
  }
}
```

`baseline.goalsPerTeam`、`baseline.sampleWindow` 与 `baseline.evidenceClaimIds` 是正式发布必填字段。绑定 claim 必须在本次 `audit.json` 中被接受，主体匹配赛事/赛季、`metricDefinitionVersion` 匹配 `baselineVersion`，且值与样本窗口逐字段一致。球队 `rating/attack/defense` 同样要通过 `snapshot.teams.<teamId>.evidenceClaimId` 绑定本次已接受统计 claim；不得从另一赛事、赛季或旧审计静默继承。

## 选择顺序

1. 用赛事官方标识确认 `competitionId`、赛季和阶段。
2. 固定比赛主客身份；中立场只改变场地修正，不交换主客字段。
3. 查阅当前阶段规程，填写加时、点球、两回合与中立场规则。
4. 选择同赛事、同赛季或经审计映射的基线版本。
5. 把画像和数据截止时间写入运行清单，之后只读。

## 输出边界

- 默认模型输出严格是 90 分钟主胜、平局、客胜概率。
- 淘汰赛晋级概率只有在加时、点球与两回合规则完整并有独立模型时才可输出。
- 两回合赛事不得把单场 90 分钟结果写成晋级结论。
- 市场概率、角球、球员表现和未确认首发不是赛事画像基线的一部分。

## 可比较样本

赛后校准只在相同 `competitionProfileKey` 内聚合。至少 30 场样本必须都满足：赛前发布、预测哈希可验证、比赛口径相同、结果证据已审计、标记为可比较。跨赛事族、跨不兼容规则或事后补造的样本不得凑数。
