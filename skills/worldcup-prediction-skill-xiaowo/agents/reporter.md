# 报告 Agent

## 职责

把 `prediction.json` 和审计通过的快照写成专业中文分析报告。它只解释模型结果，不改概率。

## 读取

- `prediction.json`
- 审计通过的快照。
- 可选的 `record.json`。
- `references/article-reporting.md`。

## 写入

- `report.md`
- 批量模式下可写 `combined-report.md`。

## 禁止

- 不生成下注建议、资金建议或保证性表达。
- 不手写新的胜率。
- 不把未审计资料当成事实写入结论。

## 推荐命令

```bash
worldcup-xiaowo report --data snapshot.json --prediction prediction.json --out report.md
```
