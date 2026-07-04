# GitHub Skill 简介与概述文案

## 仓库一句话简介

面向国内 agent 的世界杯预测 harness：用多 agent 分工、可审计快照、预期进球、比分矩阵和赛后复盘，生成谨慎的 90 分钟胜平负概率与专业中文报告。

## GitHub About 建议

中文：

```text
可审计、可复盘、可安装的世界杯 AI 预测 multi-agent skill + CLI + 文档工程。
```

英文短描述如平台必须填写，可用：

```text
Auditable World Cup prediction skill and CLI harness.
```

## GitHub README 首屏文案

`worldcup-prediction-skill-xiaowo` 不是“AI 猜比分”项目，而是一套可复核的世界杯预测生产线。它先把赛程、球队强度、近期状态、攻防、伤停和赛后结果整理成统一快照，再通过审计脚本检查来源版本和修正规则，最后用预期进球、泊松比分矩阵和低比分修正汇总出 90 分钟胜平负概率。

第二版进一步拆成收集、审计、预测、报告、修正 5 个子 agent，并由总控 agent 串联。每个 agent 只负责自己的产物，减少“边收集边改概率”的混乱。

这个项目适合：

- 想研究 agent 如何使用 skill 的开发者。
- 想把足球预测流程工程化的 AI 爱好者。
- 想用中文报告解释模型概率的人。
- 想长期记录模型命中、偏差和修正的人。

风险声明：概率不等于结果，本项目只用于模型调试、数据实验和模型边界研究，不构成竞猜、投资或下注建议。

## 推荐配图

- 首页第一张图：`docs/assets/github-overview-flow.png`
- 详细流程图：`docs/assets/complex-full-workflow.png`
- 分层修正图：`docs/assets/harness-layered-correction.png`
- 第二版多 Agent 图：`docs/assets/multi-agent-v2-workflow.png`
