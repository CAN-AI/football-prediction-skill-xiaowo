import { auditSnapshot } from "./audit.mjs";
import { formatPercent, outcomeLabel } from "./utils.mjs";

function tableRows(prediction) {
  return [
    `| 主胜 | ${formatPercent(prediction.homeWin90Prob)} |`,
    `| 平局 | ${formatPercent(prediction.draw90Prob)} |`,
    `| 客胜 | ${formatPercent(prediction.awayWin90Prob)} |`
  ].join("\n");
}

function levelLabel(level) {
  return {
    high: "高",
    medium: "中",
    low: "低"
  }[level] ?? level;
}

function scoreRows(prediction) {
  return prediction.topScorelines.map((item, index) => {
    return `| ${index + 1} | ${item.scoreline.home}-${item.scoreline.away} | ${formatPercent(item.probability)} |`;
  }).join("\n");
}

function adjustmentText(prediction) {
  const home = prediction.inputsUsed.home.adjustments;
  const away = prediction.inputsUsed.away.adjustments;
  if (home.length === 0 && away.length === 0) return "本场没有启用额外修正，只使用基础强度、状态、攻防与赛地参数。";
  return [
    home.length ? `主队修正：${home.join("、")}` : "主队无额外修正",
    away.length ? `客队修正：${away.join("、")}` : "客队无额外修正"
  ].join("\n\n");
}

function sourceFactSection(snapshot) {
  if (!snapshot) return "";
  const sourceVersions = snapshot.metadata?.sourceVersions ?? {};
  const sourceLines = Object.entries(sourceVersions).map(([source, version]) => `- ${source}: \`${version}\``);
  if (snapshot.metadata?.strengthSnapshotVersion) {
    sourceLines.push(`- strengthSnapshotVersion: \`${snapshot.metadata.strengthSnapshotVersion}\``);
  }

  const factLines = (snapshot.officialFacts ?? [])
    .filter((fact) => fact?.summary)
    .map((fact) => `- ${fact.id ? `\`${fact.id}\`：` : ""}${fact.summary}`);

  if (sourceLines.length === 0 && factLines.length === 0) return "";

  return `\n## 来源与事实摘要\n\n${sourceLines.length ? `### 来源版本\n\n${sourceLines.join("\n")}\n` : ""}${factLines.length ? `\n### 事实摘要\n\n${factLines.join("\n")}\n` : ""}`;
}

function recordSection(record) {
  if (!record) return "";
  return `\n## 赛后复盘\n\n- 实际 90 分钟比分：${record.actualScore90min.home}-${record.actualScore90min.away}\n- 预测方向：${record.predictedOutcomeLabel}；实际方向：${record.actualOutcomeLabel}\n- 方向是否命中：${record.hitOutcome ? "是" : "否"}\n- 精确比分是否命中：${record.hitExactScore ? "是" : "否"}\n- Brier score：${record.brierScore}\n- 实际比分在矩阵中的排名：${record.actualScoreRank ?? "未覆盖"}\n\n### 修正建议\n\n${record.correctionHints.map((item) => `- ${item}`).join("\n")}\n`;
}

export function generateReport({ snapshot, prediction, record, allowFailedAudit = false }) {
  const audit = snapshot ? auditSnapshot(snapshot) : null;
  if (audit && !audit.ok && !allowFailedAudit) {
    throw new Error(`输入快照审计未通过，拒绝生成正式报告：\n${audit.errors.map((item) => `- ${item}`).join("\n")}`);
  }
  const auditLines = audit ? [
    `- 审计结果：${audit.ok ? "通过" : "未通过"}`,
    `- 球队数量：${audit.summary.teamCount}`,
    `- 比赛数量：${audit.summary.matchCount}`,
    `- 修正数量：${audit.summary.adjustmentCount}`,
    `- 数据版本：${prediction.dataVersion}`
  ].join("\n") : `- 数据版本：${prediction.dataVersion}`;

  return `# ${prediction.homeTeamName} vs ${prediction.awayTeamName} 预测分析报告\n\n> 本报告用于模型调试、数据实验和预测边界研究，不构成竞猜、投资或任何下注建议。\n\n## 一句话结论\n\n模型倾向：${prediction.favoriteLabel}，置信度${levelLabel(prediction.confidenceLevel)}，冷门风险${levelLabel(prediction.upsetRisk)}。本场 90 分钟预期进球约为 ${prediction.expectedGoalsHome}-${prediction.expectedGoalsAway}。\n\n## 数据审计\n\n${auditLines}${sourceFactSection(snapshot)}\n\n## 胜平负概率\n\n| 结果 | 概率 |\n| --- | ---: |\n${tableRows(prediction)}\n\n## 比分矩阵前列\n\n| 排名 | 比分 | 概率 |\n| ---: | --- | ---: |\n${scoreRows(prediction)}\n\n## 这组概率从哪里来\n\n1. 先把球队身价/评分、FIFA 排名或 Elo、近期状态、进攻强度、防守强度放进同一个输入快照。\n2. 审计脚本检查版本号、来源、球队数量、强度版本和修正来源，避免不同批次数据混用。\n3. 模型把双方强弱差、状态差、攻防系数和赛地因素换算为预期进球。\n4. 预期进球进入泊松比分矩阵，并用 Dixon-Coles 对低比分相关性做轻量修正。\n5. 最后把所有主胜、平局、客胜比分格子分别相加，得到 90 分钟胜平负概率。\n\n## 本场修正说明\n\n${adjustmentText(prediction)}\n\n## 解释边界\n\n- 概率不是赛果，只表示在当前快照和参数下，各类比分格子的权重。\n- AI 不能直接把“感觉”写成最终胜率；伤停、首发、天气、临场变化必须结构化写入快照，再重新审计和计算。\n- 已发布预测不应被赛后改写；赛后只新增复盘记录和下一版修正。\n${recordSection(record)}\n## 风险声明\n\n我只是一个 AI 爱好者。这个项目的目标是记录一个模型如何收集信息、审计数据、计算概率、接受复盘并持续修正；不是为了竞猜，也不是为了带任何人下注。欢迎讨论 AI、数据建模、足球预测方法和模型边界，但请理性看待所有预测结果。\n`;
}
