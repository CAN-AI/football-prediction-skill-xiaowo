# GitHub 概述文案草稿

`worldcup-prediction-skill-xiaowo` 是一个面向国内 agent 和 AI 爱好者的世界杯预测 harness。它不把 AI 当“玄学比分生成器”，而是把足球预测拆成一条可审计、可复盘、可重跑的工程链路。

## 项目亮点

- **可审计**：预测前先检查来源版本、强度版本、球队数量和 dataVersion。
- **可解释**：胜率来自 xG、泊松比分矩阵和 Dixon-Coles 低比分修正。
- **可复盘**：赛后记录实际比分、方向命中、比分排名和 Brier score。
- **可修正**：新信息必须写入下一版结构化快照，再重新审计和计算。
- **可分工**：第二版支持收集、审计、预测、报告、修正 5 个子 agent，由总控 agent 串联。
- **可安装**：既可以作为 Codex skill 使用，也可以用 CLI 直接运行。

## 一句话解释

模型不是先猜比分，而是先估算双方预期进球，再把 0-0 到 7-7 的比分矩阵全部算出来；所有主胜比分加起来就是主胜概率，平局和客胜同理。

## 首页概述图

<p align="center">
  <img src="assets/github-overview-flow.png" alt="世界杯人工智能预测模型 GitHub 首页概述图" width="100%">
</p>

## 详细流程图

- [复杂全流程图](./assets/complex-full-workflow.png)
- [工程框架分层修正图](./assets/harness-layered-correction.png)
- [第二版多 Agent 工作流图](./assets/multi-agent-v2-workflow.png)

## 第二版多 Agent 工作流

普通用户可以这样理解：一个人只负责找资料，一个人只负责查真假，一个人只负责算概率，一个人只负责写报告，一个人只负责赛后复盘。总控 agent 负责把这些步骤串起来，并留下 `pipeline-manifest.json`，方便复查每一步用了什么文件。

## 风险声明

本项目用于 AI 模型调试、数据实验和模型边界研究，不构成竞猜、投资或下注建议。作者只是 AI 爱好者，欢迎讨论 AI、数据建模、足球预测方法和模型边界，请理性看待所有概率结果。
