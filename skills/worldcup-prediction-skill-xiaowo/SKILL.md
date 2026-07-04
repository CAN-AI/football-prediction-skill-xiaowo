---
name: worldcup-prediction-skill-xiaowo
description: "Use when an agent needs a Chinese, auditable World Cup match prediction harness or multi-agent workflow: collect football match information, audit sources and snapshots, compute 90-minute win/draw/loss probabilities and scorelines, generate professional analysis reports, and record post-match corrections without betting advice."
---

# Worldcup Prediction Skill Xiaowo

## Overview

这是一个面向国内用户和 agent 的世界杯预测 harness。它把“收集数据 -> 审计快照 -> 计算比分矩阵 -> 输出胜平负概率 -> 生成分析报告 -> 赛后复盘修正”做成可重复运行的流程。第二版支持 5 个子 agent 分工：收集、审计、预测、报告、修正，并由总控 agent 串联。

## When To Use

Use this skill when the user asks for:

- 世界杯单场比分、胜平负概率、90 分钟赛果概率。
- 可审计的预测模型说明、技术审计、非技术读者也能看懂的流程解释。
- 根据结构化输入快照生成专业预测分析文章。
- 赛后记录命中、未命中、Brier score，并形成下一版修正建议。
- 把预测流程沉淀为 skill、CLI、文档和示例数据。
- 多 agent 分工执行收集、审计、预测、报告和修正。

Do not use this skill to provide betting instructions, staking plans, or guaranteed outcomes.

## Workflow

1. If the user wants an end-to-end run, read `references/multi-agent-workflow.md` and use the orchestrated pipeline:

```bash
node scripts/run-pipeline.mjs --data <snapshot.json> --match <matchId> --out-dir <output-dir>
```

2. If fresh research is needed, let the collector agent gather information into `collection.json`, then audit it:

```bash
node scripts/collect-template.mjs --match <matchId> --home <teamId> --away <teamId> --kickoff-at <iso-time> --out collection.json
node scripts/audit-collection.mjs --collection collection.json --out collection-audit.json
```

3. Build or update a snapshot JSON following `references/data-schema.md`.
4. Run audit before prediction:

```bash
node scripts/audit-input.mjs --data <snapshot.json>
```

5. Predict a match:

```bash
node scripts/predict-match.mjs --data <snapshot.json> --match <matchId> --out <prediction.json>
```

6. Optional: predict every scheduled match in a snapshot. Add `--include-live` only for explicit in-progress diagnostics:

```bash
node scripts/predict-batch.mjs --data <snapshot.json> --out-dir <output-dir>
```

7. Optional: filter score scenarios without changing the main model:

```bash
node scripts/generate-scenarios.mjs --prediction <prediction.json> --min-goals 3
```

8. Generate a professional Chinese report with source versions and fact summaries:

```bash
node scripts/generate-report.mjs --data <snapshot.json> --prediction <prediction.json> --out <report.md>
```

Formal reports must use an audit-passing snapshot. Use `--allow-failed-audit` only when deliberately diagnosing invalid input.

9. After the match, record results and generate correction hints:

```bash
node scripts/record-result.mjs --prediction <prediction.json> --actual-home 3 --actual-away 0 --out <record.json>
node scripts/propose-revision.mjs --records <record.json> --out <revision-proposal.json>
```

## Decision Rules

- Never let the LLM directly overwrite probabilities. New facts must be structured into `contextAdjustments`, audited, and recalculated.
- Keep `90minResult` separate from knockout advancement.
- Treat market odds as optional context, not as the only model input.
- If data is missing, say which fields are missing instead of inventing exact values.
- Published predictions are immutable. Post-match work creates a record and a next-version correction, not a retroactive edit.

## References

- `references/data-schema.md`: snapshot and output schema.
- `references/collection-schema.md`: collector output schema.
- `references/multi-agent-workflow.md`: orchestrator and sub-agent workflow.
- `references/model-methodology.md`: model formula and probability path.
- `references/harness-workflow.md`: lifecycle commands.
- `references/revision-policy.md`: correction and replay rules.
- `references/article-reporting.md`: professional Chinese report style.

## Risk Statement

This skill is for AI model debugging, data experiments, and model-boundary research. It is not gambling advice, investment advice, or a promise of match outcomes.
