import { boundClaim } from "./facts.mjs";

const OUTCOMES = Object.freeze(["home", "draw", "away"]);

function cloneAndFreeze(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map(cloneAndFreeze));
  return Object.freeze(Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, cloneAndFreeze(item)])
  ));
}

function timestamp(value, label) {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} 必须是有效时间。`);
  return milliseconds;
}

function isoTimestamp(value, label) {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error(`${label} 必须是非空 ISO 时间。`);
  }
  return timestamp(value, label);
}

function predictionProbabilities(prediction) {
  const source = prediction?.probabilities ?? prediction ?? {};
  const probabilities = {
    home: source.home ?? source.homeWinProb,
    draw: source.draw ?? source.drawProb,
    away: source.away ?? source.awayWinProb
  };
  if (!OUTCOMES.every((outcome) => Number.isFinite(probabilities[outcome])
    && probabilities[outcome] >= 0
    && probabilities[outcome] <= 1)) {
    throw new Error("prediction 必须包含有效的主胜、平局和客胜概率。");
  }
  const total = OUTCOMES.reduce((sum, outcome) => sum + probabilities[outcome], 0);
  if (Math.abs(total - 1) > 1e-9) throw new Error("prediction 的结果概率之和必须为 1。");
  return probabilities;
}

function validProbabilities(probabilities) {
  if (!OUTCOMES.every((outcome) => Number.isFinite(probabilities?.[outcome])
    && probabilities[outcome] >= 0
    && probabilities[outcome] <= 1)) return false;
  const total = OUTCOMES.reduce((sum, outcome) => sum + probabilities[outcome], 0);
  return Math.abs(total - 1) <= 1e-6;
}

export function recordPostmatch({ manifest, prediction, facts } = {}) {
  const predictionRunId = manifest?.runId;
  const predictionSha256 = manifest?.artifacts?.prediction?.sha256;
  if (typeof predictionRunId !== "string" || !predictionRunId) {
    throw new Error("manifest.runId 不能为空。");
  }
  if (typeof predictionSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(predictionSha256)) {
    throw new Error("manifest 的 prediction SHA-256 无效。");
  }
  const finalizedAt = isoTimestamp(manifest?.finalizedAt, "manifest.finalizedAt");

  if (typeof facts?.predictionRunId !== "string" || !facts.predictionRunId) {
    throw new Error("facts.predictionRunId 不能为空。");
  }
  if (facts.predictionRunId !== predictionRunId) {
    throw new Error("predictionRunId 与 manifest.runId 不匹配。");
  }
  if (typeof facts?.predictionSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(facts.predictionSha256)) {
    throw new Error("facts.predictionSha256 必须是 64 位 SHA-256。");
  }
  if (facts.predictionSha256 !== predictionSha256) {
    throw new Error("预测 SHA-256 与 manifest 不匹配。");
  }

  const result = facts?.actualResult ?? facts?.result ?? facts;
  if (!result || typeof result !== "object") throw new Error("facts 必须包含实际赛果。");
  const { homeGoals, awayGoals, decidedIn, observedAt } = result;
  if (![homeGoals, awayGoals].every((goals) => Number.isInteger(goals) && goals >= 0)) {
    throw new Error("实际赛果必须包含非负整数比分。");
  }
  const kickoffAt = manifest?.match?.kickoffAt;
  if (timestamp(observedAt, "actualResult.observedAt") < timestamp(kickoffAt, "manifest.match.kickoffAt")) {
    throw new Error("actualResult.observedAt 不得早于 manifest.match.kickoffAt。");
  }
  const sourceClaimId = result.sourceClaimId ?? result.claimId;
  if (typeof sourceClaimId !== "string" || !sourceClaimId.trim()) {
    throw new Error("actualResult.sourceClaimId 不能为空。");
  }
  const acceptedClaims = facts?.acceptedClaims ?? facts?.evidenceAudit?.accepted;
  if (!Array.isArray(acceptedClaims)) {
    throw new Error("facts 必须提供 acceptedClaims 或 evidenceAudit.accepted 以绑定 sourceClaimId。");
  }
  const claims = new Map(acceptedClaims
    .filter((claim) => typeof claim?.claimId === "string" && claim.claimId)
    .map((claim) => [claim.claimId, claim]));
  if (!boundClaim(result, claims, { topic: "result", kind: "result", manifest })) {
    throw new Error("accepted claim 未严格匹配 sourceClaimId、result 主题、比赛身份和规范化赛果。");
  }

  const family = manifest?.competitionProfile?.family;
  const competitionId = manifest?.competitionProfile?.competitionId;
  if (!family || !competitionId) throw new Error("manifest 缺少赛事画像标识。");
  const publishedBeforeKickoff = finalizedAt < timestamp(kickoffAt, "manifest.match.kickoffAt");
  const actualOutcome = homeGoals > awayGoals ? "home" : homeGoals === awayGoals ? "draw" : "away";

  return cloneAndFreeze({
    predictionRunId,
    predictionSha256,
    competitionProfileKey: `${family}:${competitionId}`,
    matchId: manifest.match?.matchId ?? null,
    publishedBeforeKickoff,
    comparable: facts?.comparable !== false
      && prediction?.resultScope === "90min"
      && decidedIn === "90min",
    probabilities: predictionProbabilities(prediction),
    actualOutcome,
    actualResult: {
      homeGoals,
      awayGoals,
      decidedIn: decidedIn ?? null,
      observedAt,
      sourceClaimId
    }
  });
}

function calibrationMetrics(records) {
  if (records.length === 0) return { brierScore: null, directionHitRate: null };

  let brierTotal = 0;
  let directionHits = 0;
  for (const record of records) {
    const predictedOutcome = OUTCOMES.reduce((best, outcome) => (
      record.probabilities[outcome] > record.probabilities[best] ? outcome : best
    ), OUTCOMES[0]);
    if (predictedOutcome === record.actualOutcome) directionHits += 1;
    for (const outcome of OUTCOMES) {
      const observed = outcome === record.actualOutcome ? 1 : 0;
      brierTotal += (record.probabilities[outcome] - observed) ** 2;
    }
  }

  return {
    brierScore: brierTotal / records.length,
    directionHitRate: directionHits / records.length
  };
}

export function proposeCalibration(records) {
  if (!Array.isArray(records)) throw new Error("校准记录必须是数组。");
  const competitionProfileKey = records.find((record) => record?.competitionProfileKey)?.competitionProfileKey ?? null;
  const comparableRecords = records.filter((record) => (
    record?.competitionProfileKey === competitionProfileKey
    && record.publishedBeforeKickoff === true
    && record.comparable === true
    && OUTCOMES.includes(record.actualOutcome)
    && validProbabilities(record.probabilities)
  ));
  const comparableSampleCount = comparableRecords.length;
  const eligible = comparableSampleCount >= 30;

  return {
    requiresHumanApproval: true,
    applyAutomatically: false,
    competitionProfileKey,
    comparableSampleCount,
    eligibility: eligible ? "eligible_for_human_review" : "insufficient_sample",
    metrics: calibrationMetrics(comparableRecords),
    proposedChanges: eligible
      ? ["复核该赛事画像的概率校准；仅在独立回测与人工批准后纳入新版本。"]
      : []
  };
}
