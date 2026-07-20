import { contentHash } from "./utils.mjs";

export const MODEL_VERSION = "football-xiaowo-v3.0.0-90min";
export const SCORE_MATRIX_MAX_GOALS = 7;

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function poisson(lambda, goals) {
  let factorial = 1;
  for (let value = 2; value <= goals; value += 1) factorial *= value;
  return (Math.exp(-lambda) * (lambda ** goals)) / factorial;
}

function assertFiniteNumber(value, label) {
  if (!Number.isFinite(value)) throw new Error(`${label}必须是有限数值。`);
  return value;
}

function resolveTeams(manifest, snapshot) {
  const homeTeamId = manifest?.match?.homeTeamId;
  const awayTeamId = manifest?.match?.awayTeamId;
  if (!homeTeamId || !awayTeamId || homeTeamId === awayTeamId) {
    throw new Error("比赛必须提供不同的主队和客队。");
  }

  const home = snapshot?.teams?.[homeTeamId];
  const away = snapshot?.teams?.[awayTeamId];
  if (!home || !away) throw new Error("快照缺少主队或客队的球队画像。");

  for (const [teamId, team] of [[homeTeamId, home], [awayTeamId, away]]) {
    assertFiniteNumber(team.rating, `${teamId}评级`);
    assertFiniteNumber(team.attack, `${teamId}进攻系数`);
    assertFiniteNumber(team.defense, `${teamId}防守系数`);
  }

  return { homeTeamId, awayTeamId, home, away };
}

function resolveConfidence(evidenceAudit) {
  const dataConfidence = typeof evidenceAudit?.dataConfidence === "string"
    ? evidenceAudit.dataConfidence
    : evidenceAudit?.dataConfidence?.level;
  const status = evidenceAudit?.status;

  if (status === "failed") throw new Error("审计失败，不能生成预测。");
  if (status === "passed") {
    if (!["high", "medium"].includes(dataConfidence)) {
      throw new Error("通过审计必须提供高或中等数据置信度。");
    }
    return { level: dataConfidence, auditStatus: status, dataConfidence };
  }
  if (status === "degraded_low_confidence") {
    return { level: "low", auditStatus: status, dataConfidence: "low" };
  }
  throw new Error("审计状态无效，不能生成预测。");
}

function acceptedDeterministicAdjustments(evidenceAudit) {
  if (!Array.isArray(evidenceAudit?.accepted)) return [];

  return evidenceAudit.accepted.flatMap((claim) => {
    const adjustment = claim?.deterministicAdjustment;
    if (!adjustment || typeof adjustment !== "object") return [];
    if (claim.topic === "lineup" && !["confirmed", "official_confirmed"].includes(claim.lineupStatus)) return [];

    const homeLambdaDelta = adjustment.homeLambdaDelta ?? 0;
    const awayLambdaDelta = adjustment.awayLambdaDelta ?? 0;
    if (!Number.isFinite(homeLambdaDelta) || !Number.isFinite(awayLambdaDelta)) return [];

    return [{
      claimId: claim.claimId ?? null,
      homeLambdaDelta,
      awayLambdaDelta
    }];
  });
}

function buildScoreMatrix(homeLambda, awayLambda) {
  const unnormalized = [];
  let total = 0;
  for (let homeGoals = 0; homeGoals <= SCORE_MATRIX_MAX_GOALS; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= SCORE_MATRIX_MAX_GOALS; awayGoals += 1) {
      const probability = poisson(homeLambda, homeGoals) * poisson(awayLambda, awayGoals);
      unnormalized.push({ homeGoals, awayGoals, probability });
      total += probability;
    }
  }

  return unnormalized.map((item) => ({ ...item, probability: item.probability / total }));
}

function resultProbabilities(scoreMatrix) {
  return scoreMatrix.reduce((result, item) => {
    if (item.homeGoals > item.awayGoals) result.homeWinProb += item.probability;
    else if (item.homeGoals === item.awayGoals) result.drawProb += item.probability;
    else result.awayWinProb += item.probability;
    return result;
  }, { homeWinProb: 0, drawProb: 0, awayWinProb: 0 });
}

export function predict90({ manifest, snapshot, evidenceAudit } = {}) {
  const confidence = resolveConfidence(evidenceAudit);
  const baseline = manifest?.competitionProfile?.baseline?.goalsPerTeam;
  if (!Number.isFinite(baseline) || baseline <= 0) {
    throw new Error("赛事画像缺少经审计的每队进球基线。");
  }

  const { homeTeamId, awayTeamId, home, away } = resolveTeams(manifest, snapshot);
  const homeAdvantage = manifest.competitionProfile.homeAdvantage ?? 0;
  assertFiniteNumber(homeAdvantage, "主场系数");
  const ratingShift = (home.rating - away.rating) / 900;
  const adjustments = acceptedDeterministicAdjustments(evidenceAudit);
  const homeAdjustment = adjustments.reduce((total, item) => total + item.homeLambdaDelta, 0);
  const awayAdjustment = adjustments.reduce((total, item) => total + item.awayLambdaDelta, 0);
  const homeLambda = clamp(baseline * home.attack * away.defense + ratingShift + homeAdvantage + homeAdjustment, 0.25, 3.5);
  const awayLambda = clamp(baseline * away.attack * home.defense - ratingShift + awayAdjustment, 0.25, 3.5);
  const scoreMatrix = buildScoreMatrix(homeLambda, awayLambda);
  const probabilities = resultProbabilities(scoreMatrix);

  return {
    modelVersion: MODEL_VERSION,
    resultScope: "90min",
    homeTeamId,
    awayTeamId,
    ...probabilities,
    probabilities: { ...probabilities },
    expectedGoals: { home: homeLambda, away: awayLambda },
    scoreMatrix,
    adjustments,
    confidence,
    trace: {
      baselineVersion: manifest.competitionProfile.baselineVersion ?? null,
      inputHash: contentHash({ manifest, snapshot, evidenceAudit }),
      scoreMatrix: { minGoals: 0, maxGoals: SCORE_MATRIX_MAX_GOALS, truncated: true },
      dataConfidence: confidence.dataConfidence
    }
  };
}
