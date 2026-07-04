import { round } from "./utils.mjs";

function average(values) {
  if (values.length === 0) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 4);
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

export function proposeRevision(records, meta = {}) {
  const validRecords = records.filter((record) => record && typeof record === "object");
  const hitOutcomeCount = validRecords.filter((record) => record.hitOutcome === true).length;
  const exactScoreCount = validRecords.filter((record) => record.hitExactScore === true).length;
  const brierValues = validRecords.map((record) => Number(record.brierScore)).filter(Number.isFinite);
  const missedHighConfidence = validRecords.filter((record) => record.hitOutcome === false && Number(record.brierScore) >= 0.8);
  const hints = unique(validRecords.flatMap((record) => record.correctionHints ?? []));

  const proposedAdjustments = hints.map((hint, index) => ({
    id: `revision-hint-${index + 1}`,
    status: "needs_human_approval",
    source: "post_match_record",
    summary: hint,
    suggestedAction: "人工复核后，决定是否写入下一版 contextAdjustments 或模型权重配置。"
  }));

  if (missedHighConfidence.length > 0) {
    proposedAdjustments.push({
      id: "revision-high-brier-review",
      status: "needs_human_approval",
      source: "calibration_check",
      summary: "存在高 Brier score 的未命中样本，建议集中复核是否系统性高估热门方向。",
      suggestedAction: "先扩大样本，再由人工确认是否微调 form、attack 或 defense 权重。"
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    modelVersion: meta.modelVersion,
    requiresHumanApproval: true,
    applyAutomatically: false,
    recordCount: validRecords.length,
    metrics: {
      hitOutcomeCount,
      hitOutcomeRate: validRecords.length ? round(hitOutcomeCount / validRecords.length, 4) : null,
      exactScoreCount,
      exactScoreRate: validRecords.length ? round(exactScoreCount / validRecords.length, 4) : null,
      averageBrierScore: average(brierValues),
      highBrierMissCount: missedHighConfidence.length
    },
    proposedAdjustments,
    nextSteps: [
      "人工确认每条修正建议是否来自真实赛后事实。",
      "只把确认后的事实写入下一版快照或版本化权重配置。",
      "重新运行 audit -> predict -> report，旧预测文件只保留复盘，不回头修改。"
    ]
  };
}
