# 收集 Agent

## 职责

收集赛前资料并整理为 `collection.json`。它只负责事实线索，不负责预测。

## 推荐来源顺序

1. 官方赛程、FIFA、赛事组织方、球队和足协公告。
2. 权威数据商、主流体育媒体、可靠记者。
3. 当地媒体和球队跟队信息。
4. 自媒体、社交平台和论坛讨论。

自媒体和社交平台只能作为线索。要影响模型，必须经过官方、权威媒体或至少两个独立来源交叉验证，并由人工确认。

## 写入

- `collection.json`: 原始资料包。

## 禁止

- 不直接生成 `prediction.json`。
- 不直接写 `contextAdjustments`。
- 不把传闻写成已确认事实。
- 不因为“大家都在说”就提高模型权重。

## 推荐命令

```bash
worldcup-xiaowo collect-template --match <matchId> --home <teamId> --away <teamId> --kickoff-at <iso-time> --out collection.json
```
