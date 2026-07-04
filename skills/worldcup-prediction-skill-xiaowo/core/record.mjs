import { outcomeFromScore, outcomeLabel, round } from "./utils.mjs";

function probabilityVector(prediction) {
  return {
    home: prediction.homeWin90Prob,
    draw: prediction.draw90Prob,
    away: prediction.awayWin90Prob
  };
}

function brierScore(probabilities, actualOutcome) {
  return round(
    Object.entries(probabilities).reduce((sum, [outcome, probability]) => {
      const actual = outcome === actualOutcome ? 1 : 0;
      return sum + (probability - actual) ** 2;
    }, 0),
    4
  );
}

function rankActualScore(prediction, actualScore) {
  const sorted = [...prediction.scoreMatrix].sort((a, b) => b.probability - a.probability);
  const index = sorted.findIndex((item) => item.home === actualScore.home && item.away === actualScore.away);
  return index === -1 ? null : index + 1;
}

function correctionHints(prediction, actualScore, actualOutcome, predictedOutcome) {
  const hints = [];
  const expectedTotal = prediction.expectedGoalsHome + prediction.expectedGoalsAway;
  const actualTotal = actualScore.home + actualScore.away;

  if (actualOutcome !== predictedOutcome) {
    hints.push("赛果方向未命中：优先回看首发、伤停、赛程强度、临场状态是否在赛前快照中缺失。");
  }
  if (actualTotal >= expectedTotal + 1.5) {
    hints.push("实际进球明显高于预期：检查双方防守系数、转换进攻、定位球和比赛节奏是否低估。");
  }
  if (actualTotal <= expectedTotal - 1.5) {
    hints.push("实际进球明显低于预期：检查淘汰赛保守策略、天气、轮换、体能和进攻效率是否高估。");
  }
  if (actualScore.home - actualScore.away > prediction.expectedGoalsHome - prediction.expectedGoalsAway + 1.5) {
    hints.push("主队优势被低估：可考虑在下一版快照中结构化调整主队 formScore 或 attackMultiplier。");
  }
  if (actualScore.away - actualScore.home > prediction.expectedGoalsAway - prediction.expectedGoalsHome + 1.5) {
    hints.push("客队优势被低估：可考虑在下一版快照中结构化调整客队 formScore 或 attackMultiplier。");
  }
  if (hints.length === 0) {
    hints.push("赛果方向与总进球偏差可接受：保留记录，继续累积样本后再判断是否需要改参数。");
  }
  return hints;
}

export function recordResult(prediction, actualScore, meta = {}) {
  const actualOutcome = outcomeFromScore(actualScore);
  const predictedOutcome = prediction.favoriteOutcome;
  const actualScoreRank = rankActualScore(prediction, actualScore);
  const probabilities = probabilityVector(prediction);

  return {
    matchId: prediction.matchId,
    recordedAt: new Date().toISOString(),
    resultScope: prediction.resultScope ?? "90minResult",
    actualScore90min: actualScore,
    actualOutcome,
    actualOutcomeLabel: outcomeLabel(actualOutcome),
    predictedOutcome,
    predictedOutcomeLabel: outcomeLabel(predictedOutcome),
    hitOutcome: actualOutcome === predictedOutcome,
    hitExactScore: prediction.topScorelines?.[0]?.scoreline?.home === actualScore.home &&
      prediction.topScorelines?.[0]?.scoreline?.away === actualScore.away,
    actualScoreRank,
    brierScore: brierScore(probabilities, actualOutcome),
    predictionSummary: {
      homeWin90Prob: prediction.homeWin90Prob,
      draw90Prob: prediction.draw90Prob,
      awayWin90Prob: prediction.awayWin90Prob,
      expectedGoalsHome: prediction.expectedGoalsHome,
      expectedGoalsAway: prediction.expectedGoalsAway,
      topScorelines: prediction.topScorelines
    },
    correctionHints: correctionHints(prediction, actualScore, actualOutcome, predictedOutcome),
    revisionTemplate: {
      scope: "match_or_team",
      derivation: "manual_review",
      humanReviewed: true,
      reason: meta.reason ?? "赛后复盘后再填写具体原因。",
      impact: {
        formScoreDelta: 0,
        attackMultiplier: 1,
        defenseMultiplier: 1
      }
    },
    disclaimer: "复盘用于改进模型，不用于追涨杀跌或事后改写已发布预测。"
  };
}
