import { assertAudit } from "./audit.mjs";
import { asNumber, clamp, outcomeFromScore, outcomeLabel, poisson, round } from "./utils.mjs";

export const MODEL_VERSION = "xiaowo-worldcup-harness-v0.1.0";
export const DEFAULT_MAX_GOALS = 7;
const TOURNAMENT_AVG_GOALS = 1.32;

export function teamRating(team) {
  const ratingValue = asNumber(team.ratingValue);
  if (ratingValue !== undefined) return ratingValue;
  const eloRating = asNumber(team.eloRating);
  if (eloRating !== undefined) return eloRating;
  const fifaRank = asNumber(team.fifaRank);
  if (fifaRank !== undefined) return clamp(2050 - (fifaRank - 1) * 8, 1300, 2050);
  return 1700;
}

function teamAttack(team) {
  const goalsPerMatch = asNumber(team.goalsPerMatch);
  if (goalsPerMatch !== undefined && goalsPerMatch > 0) return clamp(goalsPerMatch / TOURNAMENT_AVG_GOALS, 0.45, 2.2);
  return clamp(asNumber(team.attackStrength, 1), 0.45, 2.2);
}

function teamDefense(team) {
  const goalsAgainstPerMatch = asNumber(team.goalsAgainstPerMatch);
  if (goalsAgainstPerMatch !== undefined && goalsAgainstPerMatch > 0) return clamp(goalsAgainstPerMatch / TOURNAMENT_AVG_GOALS, 0.45, 2.2);
  return clamp(asNumber(team.defenseStrength, 1), 0.45, 2.2);
}

function formScore(team) {
  return clamp(asNumber(team.formScore, 50), 0, 100);
}

function activeOn(adjustment, generatedAt) {
  const now = generatedAt ? Date.parse(generatedAt) : NaN;
  if (adjustment.startsAt && Number.isFinite(now) && now < Date.parse(adjustment.startsAt)) return false;
  if (adjustment.expiresAt && Number.isFinite(now) && now > Date.parse(adjustment.expiresAt)) return false;
  return true;
}

function adjustmentMatchesTeam(team, adjustment) {
  return !adjustment.teamId && !adjustment.teamCode ||
    adjustment.teamId === team.id ||
    adjustment.teamCode === team.code;
}

function adjustmentMatchesRole(adjustment, role) {
  return !adjustment.target || adjustment.target === "both" || adjustment.target === role;
}

function relevantAdjustments(snapshot, match, team, role) {
  return (snapshot.contextAdjustments ?? []).filter((adjustment) => {
    if (!activeOn(adjustment, snapshot.metadata?.generatedAt)) return false;
    if (adjustment.matchId && adjustment.matchId !== match.matchId) return false;
    if (!adjustmentMatchesRole(adjustment, role)) return false;
    if (adjustment.scope === "match" && !adjustment.teamId && !adjustment.teamCode) return true;
    return adjustmentMatchesTeam(team, adjustment);
  });
}

function applyImpact(team, adjustment) {
  const impact = adjustment.impact ?? {};
  return {
    ...team,
    ratingValue: teamRating(team) + asNumber(impact.ratingDelta, 0),
    formScore: formScore(team) + asNumber(impact.formScoreDelta, 0),
    attackStrength: teamAttack(team) * asNumber(impact.attackMultiplier, 1),
    defenseStrength: teamDefense(team) * asNumber(impact.defenseMultiplier, 1)
  };
}

function applyAdjustments(snapshot, match, rawHome, rawAway) {
  const homeAdjustments = relevantAdjustments(snapshot, match, rawHome, "home");
  const awayAdjustments = relevantAdjustments(snapshot, match, rawAway, "away");
  const home = homeAdjustments.reduce((team, adjustment) => applyImpact(team, adjustment), rawHome);
  const away = awayAdjustments.reduce((team, adjustment) => applyImpact(team, adjustment), rawAway);
  return { home, away, homeAdjustments, awayAdjustments };
}

export function expectedGoals(homeTeam, awayTeam, match) {
  const homeRating = teamRating(homeTeam);
  const awayRating = teamRating(awayTeam);
  const ratingDelta = (homeRating - awayRating) / 400;
  const formDelta = (formScore(homeTeam) - formScore(awayTeam)) / 100;
  const homeHostBoost = homeTeam.countryCode && homeTeam.countryCode === match.venueCountryCode ? 0.16 : 0;
  const awayHostBoost = awayTeam.countryCode && awayTeam.countryCode === match.venueCountryCode ? 0.16 : 0;

  return {
    home: clamp(TOURNAMENT_AVG_GOALS * teamAttack(homeTeam) * teamDefense(awayTeam) + ratingDelta * 0.38 + formDelta * 0.15 + homeHostBoost, 0.35, 3.25),
    away: clamp(TOURNAMENT_AVG_GOALS * teamAttack(awayTeam) * teamDefense(homeTeam) - ratingDelta * 0.38 - formDelta * 0.15 + awayHostBoost, 0.3, 3.1)
  };
}

function dixonColesRho(lambdaHome, lambdaAway) {
  return clamp(-0.08 + (lambdaHome + lambdaAway - 2.64) * 0.015, -0.16, -0.02);
}

function dixonColesFactor(homeGoals, awayGoals, lambdaHome, lambdaAway) {
  const rho = dixonColesRho(lambdaHome, lambdaAway);
  if (homeGoals === 0 && awayGoals === 0) return clamp(1 - lambdaHome * lambdaAway * rho, 0.2, 2);
  if (homeGoals === 0 && awayGoals === 1) return clamp(1 + lambdaHome * rho, 0.2, 2);
  if (homeGoals === 1 && awayGoals === 0) return clamp(1 + lambdaAway * rho, 0.2, 2);
  if (homeGoals === 1 && awayGoals === 1) return clamp(1 - rho, 0.2, 2);
  return 1;
}

export function scoreDistribution(homeTeam, awayTeam, match, maxGoals = DEFAULT_MAX_GOALS) {
  const expected = expectedGoals(homeTeam, awayTeam, match);
  const matrix = [];
  let total = 0;
  for (let home = 0; home <= maxGoals; home += 1) {
    for (let away = 0; away <= maxGoals; away += 1) {
      const base = poisson(expected.home, home) * poisson(expected.away, away);
      const probability = base * dixonColesFactor(home, away, expected.home, expected.away);
      matrix.push({ home, away, probability });
      total += probability;
    }
  }
  return {
    expected,
    matrix: matrix.map((item) => ({ ...item, probability: item.probability / total }))
  };
}

export function aggregateResultProbabilities(matrix) {
  const result = { home: 0, draw: 0, away: 0 };
  for (const item of matrix) {
    result[outcomeFromScore(item)] += item.probability;
  }
  return {
    homeWin90Prob: result.home,
    draw90Prob: result.draw,
    awayWin90Prob: result.away
  };
}

function confidenceLevel(strongestProb) {
  if (strongestProb >= 0.54) return "high";
  if (strongestProb >= 0.45) return "medium";
  return "low";
}

function upsetRisk(strongestProb) {
  if (strongestProb < 0.42) return "high";
  if (strongestProb < 0.52) return "medium";
  return "low";
}

function topScorelines(matrix, limit = 5) {
  return [...matrix]
    .sort((a, b) => b.probability - a.probability)
    .slice(0, limit)
    .map((item) => ({
      scoreline: { home: item.home, away: item.away },
      probability: round(item.probability, 4)
    }));
}

function maxOutcome(probabilities) {
  const entries = [
    ["home", probabilities.homeWin90Prob],
    ["draw", probabilities.draw90Prob],
    ["away", probabilities.awayWin90Prob]
  ];
  return entries.sort((a, b) => b[1] - a[1])[0];
}

function findTeam(snapshot, teamId) {
  const team = snapshot.teams.find((item) => item.id === teamId || item.code === teamId);
  if (!team) throw new Error(`找不到球队：${teamId}`);
  return team;
}

function resolveMatch(snapshot, options) {
  if (options.matchId) {
    const match = snapshot.matchStates?.find((item) => item.matchId === options.matchId);
    if (!match) throw new Error(`找不到 matchId：${options.matchId}`);
    return match;
  }
  if (!options.homeTeamId || !options.awayTeamId) {
    throw new Error("必须提供 matchId，或同时提供 homeTeamId 与 awayTeamId。");
  }
  return {
    matchId: options.syntheticMatchId ?? `${options.homeTeamId}-${options.awayTeamId}-manual`,
    stage: options.stage ?? "other",
    homeTeamId: options.homeTeamId,
    awayTeamId: options.awayTeamId,
    venueCountryCode: options.venueCountryCode,
    status: "scheduled"
  };
}

export function predictMatch(snapshot, options = {}) {
  const audit = assertAudit(snapshot);
  const match = resolveMatch(snapshot, options);
  const rawHome = findTeam(snapshot, match.homeTeamId);
  const rawAway = findTeam(snapshot, match.awayTeamId);
  const adjusted = applyAdjustments(snapshot, match, rawHome, rawAway);
  const distribution = scoreDistribution(adjusted.home, adjusted.away, match, options.maxGoals ?? DEFAULT_MAX_GOALS);
  const probabilities = aggregateResultProbabilities(distribution.matrix);
  const [favoriteOutcome, strongestProb] = maxOutcome(probabilities);
  const scoreMatrix = distribution.matrix.map((item) => ({
    home: item.home,
    away: item.away,
    probability: round(item.probability, 6)
  }));

  return {
    matchId: match.matchId,
    modelVersion: MODEL_VERSION,
    sourceModelVersion: snapshot.metadata.modelVersion,
    dataVersion: snapshot.metadata.dataVersion,
    generatedAt: new Date().toISOString(),
    snapshotGeneratedAt: snapshot.metadata.generatedAt,
    resultScope: "90minResult",
    stage: match.stage,
    homeTeamId: rawHome.id,
    awayTeamId: rawAway.id,
    homeTeamName: rawHome.name,
    awayTeamName: rawAway.name,
    venueCountryCode: match.venueCountryCode,
    homeWin90Prob: round(probabilities.homeWin90Prob, 4),
    draw90Prob: round(probabilities.draw90Prob, 4),
    awayWin90Prob: round(probabilities.awayWin90Prob, 4),
    expectedGoalsHome: round(distribution.expected.home, 2),
    expectedGoalsAway: round(distribution.expected.away, 2),
    favoriteOutcome,
    favoriteLabel: outcomeLabel(favoriteOutcome),
    confidenceLevel: confidenceLevel(strongestProb),
    upsetRisk: upsetRisk(strongestProb),
    topScorelines: topScorelines(distribution.matrix, options.top ?? 5),
    scoreMatrix,
    inputsUsed: {
      home: {
        rating: round(teamRating(adjusted.home), 1),
        formScore: round(formScore(adjusted.home), 1),
        attackStrength: round(teamAttack(adjusted.home), 3),
        defenseStrength: round(teamDefense(adjusted.home), 3),
        adjustments: adjusted.homeAdjustments.map((item) => item.id)
      },
      away: {
        rating: round(teamRating(adjusted.away), 1),
        formScore: round(formScore(adjusted.away), 1),
        attackStrength: round(teamAttack(adjusted.away), 3),
        defenseStrength: round(teamDefense(adjusted.away), 3),
        adjustments: adjusted.awayAdjustments.map((item) => item.id)
      }
    },
    auditSummary: audit.summary,
    explanation: [
      "本预测先审计输入快照，再把球队强度、近期状态、攻防系数和赛地因素转换为双方预期进球。",
      `本场预期进球约为 ${round(distribution.expected.home, 2)}-${round(distribution.expected.away, 2)}，再由泊松比分矩阵汇总胜平负概率。`,
      "Dixon-Coles 修正只用于 0-0、1-0、0-1、1-1 等低比分相关性，不直接让 AI 改答案。"
    ],
    disclaimer: "概率不等于结果，仅用于模型调试、数据实验和边界研究，不构成竞猜或投资建议。"
  };
}

export function buildScenario(prediction, options = {}) {
  const minGoals = options.minGoals === undefined ? undefined : Number(options.minGoals);
  const maxGoals = options.maxGoals === undefined ? undefined : Number(options.maxGoals);
  const candidates = prediction.scoreMatrix.filter((item) => {
    const total = item.home + item.away;
    if (minGoals !== undefined && total < minGoals) return false;
    if (maxGoals !== undefined && total > maxGoals) return false;
    return true;
  });
  const probability = candidates.reduce((sum, item) => sum + item.probability, 0);
  const topScorelines = candidates
    .sort((a, b) => b.probability - a.probability)
    .slice(0, options.top ?? 5)
    .map((item) => ({
      scoreline: { home: item.home, away: item.away },
      probability: round(item.probability, 4),
      conditionalProbability: probability > 0 ? round(item.probability / probability, 4) : 0
    }));
  return {
    matchId: prediction.matchId,
    scenario: {
      minGoals,
      maxGoals,
      label: minGoals !== undefined ? `总进球 >= ${minGoals}` : maxGoals !== undefined ? `总进球 <= ${maxGoals}` : "全部比分"
    },
    probability: round(probability, 4),
    topScorelines,
    note: "场景筛选只是在完整比分矩阵里过滤脚本，不会反向修改主模型胜平负概率。"
  };
}
