# 本地模型与历史流程审计报告

本报告根据本地工作区文件、已安装的世界杯预测 skill、相关 Codex 历史对话和参考 harness 项目整理。为便于公开开源，报告不写入个人绝对路径和无关私有文件名。

## 结论摘要

旧流程不是单纯让 AI 猜比分，而是三层结构：

1. 数据层：`model-input` 快照记录球队强度、赛程、来源版本和上下文修正。
2. 模型层：预测脚本把强度转换为 xG，再生成比分矩阵和胜平负概率。
3. 内容层：把预测 JSON 转成 Markdown 报告或专业分析文章。

这次开源项目保留前两层，并加强第三层中的专业报告能力；非报告类内容生成不放入核心项目。

## 胜率根据什么

胜率来自比分矩阵汇总：

- 先根据球队评分、排名、状态、攻防强度、赛地和人工复核修正计算双方预期进球。
- 再用泊松分布生成 0-0 到 7-7 的比分概率。
- 用 Dixon-Coles 对低比分相关性做修正。
- 主胜格子相加为主胜概率，平局格子相加为平局概率，客胜格子相加为客胜概率。

非技术理解：不是先猜“比分是多少”，而是把每个可能比分都称一遍重量，再把同类结果加总。

## 原流程中的审核

旧 skill 的审计重点包括：

- `metadata.sourceVersions` 必须记录来源版本。
- `metadata.strengthSnapshotVersion` 必须和每支球队的 `strengthVersion` 一致。
- `metadata.expectedTeamCount` 必须等于 `teams.length`。
- `metadata.dataVersion` 由来源版本和强度版本计算，防止混用。
- 上下文修正必须来自人工复核或确定性规则，不能让 AI 直接改答案。

新项目沿用这些原则，并增加了更清晰的中文错误说明、赛后复盘记录和报告生成。
同时新增 `snapshotContentHash` 可选校验、严格报告生成闸门和批量输出文件名防护，进一步降低版本漂移和误发布风险。

## Skill 如何调用

旧流程通常由 agent 读取 skill 指令后运行脚本：

```bash
node scripts/audit-input.mjs --data <snapshot.json>
node scripts/predict-match.mjs --data <snapshot.json> --match <matchId>
```

新项目保留同样的低门槛脚本，同时增加统一 CLI：

```bash
worldcup-xiaowo audit --data <snapshot.json>
worldcup-xiaowo predict --data <snapshot.json> --match <matchId>
worldcup-xiaowo report --prediction <prediction.json>
```

## 钩子怎么运行

本地 Codex 配置中只发现一个 Stop hook，用于尝试保存对话 transcript。它不参与预测、不修改比分、不修正概率。也就是说，预测可信度不来自 hook，而来自审计、版本号、可重复脚本和赛后记录。

## 参考 harness 的启发

参考的视频演示项目把内容拆成文章、outline、脚本、演示工程和校验输出。新项目借鉴的是这种“材料分层、每层可复核”的工程思想：

- 输入快照对应原始材料。
- 预测 JSON 对应可执行中间结果。
- 报告 Markdown 对应最终解释层。
- 复盘记录对应下一轮迭代入口。

## 需要继续改进

- 真实赛事应接入可靠来源，不应长期手工填数。
- 阵容、伤停和天气最好写成单独的结构化来源。
- 大比分、加时、点球和晋级概率需要独立模型。
- 累积足够样本后应增加校准曲线，而不是只看单场命中。
