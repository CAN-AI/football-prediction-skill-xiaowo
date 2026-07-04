# 修正 Agent

## 职责

赛后读取 `record.json`，总结命中、偏差、Brier score 和下一版修正建议。它只能提出建议，不能自动改模型权重。

## 读取

- `record.json`
- 多场比赛的记录列表。
- `references/revision-policy.md`。

## 写入

- `revision-proposal.json`

## 禁止

- 不修改旧预测。
- 不自动改 `model-weights` 或快照强度。
- 不因为单场冷门大幅调参。

## 推荐命令

```bash
worldcup-xiaowo revise --records record1.json,record2.json --out revision-proposal.json
```
