import { boundClaim } from "./facts.mjs";
import { auditEvidenceLedger } from "./evidence.mjs";
import { contentHash } from "./utils.mjs";

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

function ninetyMinuteResult(result = {}) {
  if (result.decidedIn === "90min") {
    return { homeGoals: result.homeGoals, awayGoals: result.awayGoals };
  }
  const explicit = result.ninetyMinuteResult ?? result.result90min ?? result.regulationResult;
  if (!explicit || !Number.isInteger(explicit.homeGoals) || explicit.homeGoals < 0
    || !Number.isInteger(explicit.awayGoals) || explicit.awayGoals < 0) return null;
  return { homeGoals: explicit.homeGoals, awayGoals: explicit.awayGoals };
}

function outcomeFromScore(result) {
  if (!result) return null;
  return result.homeGoals > result.awayGoals ? "home" : result.homeGoals === result.awayGoals ? "draw" : "away";
}

export function competitionProfileKey(profile = {}) {
  const relevant = {
    family: profile.family ?? null,
    competitionId: profile.competitionId ?? null,
    season: profile.season ?? null,
    level: profile.level ?? null,
    stage: profile.stage ?? null,
    baselineVersion: profile.baselineVersion ?? null,
    goalsPerTeam: profile.baseline?.goalsPerTeam ?? null,
    sampleWindow: profile.baseline?.sampleWindow ?? null,
    homeAdvantage: profile.homeAdvantage ?? null,
    regulation: {
      twoLegged: profile.regulation?.twoLegged ?? null,
      extraTime: profile.regulation?.extraTime ?? null,
      penalties: profile.regulation?.penalties ?? null,
      neutralVenue: profile.regulation?.neutralVenue ?? null
    }
  };
  return `profile-v2:${contentHash(relevant)}`;
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
  if (manifest?.mode && manifest.mode !== "prematch") throw new Error("赛后记录只能绑定已发布 prematch 运行。");

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
  if (!Array.isArray(facts?.evidenceLedger)) {
    throw new Error("facts.evidenceLedger 必须提供原始赛后证据并重新审计；不能信任调用方自报的 acceptedClaims。");
  }
  if (!Number.isFinite(Date.parse(facts?.dataCutoffAt))) {
    throw new Error("facts.dataCutoffAt 必须是有效赛后证据截止时间。");
  }
  const evidenceAudit = auditEvidenceLedger({
    ledger: facts.evidenceLedger,
    match: manifest.match,
    cutoffAt: facts.dataCutoffAt
  });
  if (evidenceAudit.status === "failed") throw new Error("赛后证据重新审计失败。");
  const claims = new Map(evidenceAudit.accepted
    .filter((claim) => typeof claim?.claimId === "string" && claim.claimId)
    .map((claim) => [claim.claimId, claim]));
  if (!boundClaim(result, claims, { topic: "result", kind: "result", manifest })) {
    throw new Error("重新审计后的 accepted claim 未严格匹配 sourceClaimId、result 主题、比赛身份和规范化赛果。");
  }

  const family = manifest?.competitionProfile?.family;
  const competitionId = manifest?.competitionProfile?.competitionId;
  if (!family || !competitionId) throw new Error("manifest 缺少赛事画像标识。");
  const publishedBeforeKickoff = finalizedAt < timestamp(kickoffAt, "manifest.match.kickoffAt");
  const resultClaim = claims.get(sourceClaimId);
  const actual90 = ninetyMinuteResult(result);
  const actualOutcome = outcomeFromScore(actual90);

  return cloneAndFreeze({
    predictionRunId,
    predictionSha256,
    competitionProfileKey: competitionProfileKey(manifest.competitionProfile),
    competitionProfile: manifest.competitionProfile,
    matchId: manifest.match?.matchId ?? null,
    publishedBeforeKickoff,
    comparable: facts?.comparable !== false
      && prediction?.resultScope === "90min"
      && actual90 !== null,
    resultScope: "90min",
    probabilities: predictionProbabilities(prediction),
    actualOutcome,
    actualResult: {
      homeGoals,
      awayGoals,
      decidedIn: decidedIn ?? null,
      observedAt,
      sourceClaimId,
      ninetyMinuteResult: actual90
    },
    resultEvidence: {
      claimId: resultClaim.claimId,
      sourceTier: resultClaim.sourceTier,
      sourceUrl: resultClaim.sourceUrl,
      publishedAt: resultClaim.publishedAt,
      observedAt: resultClaim.observedAt,
      reviewStatus: resultClaim.reviewStatus
    },
    evidenceAudit: {
      status: evidenceAudit.status,
      acceptedClaimIds: evidenceAudit.accepted.map((claim) => claim.claimId),
      rejectedClaimIds: evidenceAudit.rejected.map(({ claim }) => claim?.claimId).filter(Boolean)
    },
    dataQuality: {
      predictionLineageVerified: true,
      resultEvidenceAccepted: true,
      uncontaminated: evidenceAudit.conflicts.length === 0
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
  const targetProfileKey = records.find((record) => record?.competitionProfileKey)?.competitionProfileKey ?? null;
  const comparableRecords = [];
  const dataQualityExclusions = [];
  const seenRunIds = new Set();
  const seenMatchIds = new Set();
  records.forEach((record, index) => {
    const reasons = [];
    if (record?.competitionProfileKey !== targetProfileKey) reasons.push("赛事画像键不同");
    if (!record?.competitionProfile
      || competitionProfileKey(record.competitionProfile) !== record.competitionProfileKey) {
      reasons.push("赛事画像键无法由完整画像复算");
    }
    if (typeof record?.predictionRunId !== "string" || !record.predictionRunId) reasons.push("predictionRunId 缺失");
    if (!/^[a-f0-9]{64}$/i.test(record?.predictionSha256 ?? "")) reasons.push("predictionSha256 无效");
    if (typeof record?.matchId !== "string" || !record.matchId) reasons.push("matchId 缺失");
    if (record?.publishedBeforeKickoff !== true) reasons.push("不是赛前发布");
    if (record?.comparable !== true || record?.resultScope !== "90min") reasons.push("90分钟可比较标志无效");
    if (!OUTCOMES.includes(record?.actualOutcome)) reasons.push("actualOutcome 无效");
    if (!validProbabilities(record?.probabilities)) reasons.push("概率无效");
    const score90 = ninetyMinuteResult(record?.actualResult);
    if (!score90 || outcomeFromScore(score90) !== record?.actualOutcome) reasons.push("90分钟赛果口径或方向不一致");
    if (record?.dataQuality?.predictionLineageVerified !== true) reasons.push("预测谱系未验证");
    if (record?.dataQuality?.resultEvidenceAccepted !== true) reasons.push("赛果证据未审计接受");
    if (record?.dataQuality?.uncontaminated !== true) reasons.push("数据质量受污染");
    if (reasons.length === 0 && (seenRunIds.has(record.predictionRunId) || seenMatchIds.has(record.matchId))) {
      reasons.push("重复 predictionRunId 或 matchId");
    }
    if (reasons.length) {
      dataQualityExclusions.push({
        index,
        predictionRunId: record?.predictionRunId ?? null,
        matchId: record?.matchId ?? null,
        reason: reasons.join("；")
      });
      return;
    }
    seenRunIds.add(record.predictionRunId);
    seenMatchIds.add(record.matchId);
    comparableRecords.push(record);
  });
  const comparableSampleCount = comparableRecords.length;
  const eligible = comparableSampleCount >= 30;

  return {
    requiresHumanApproval: true,
    applyAutomatically: false,
    competitionProfileKey: targetProfileKey,
    comparableSampleCount,
    eligibility: eligible ? "eligible_for_human_review" : "insufficient_sample",
    metrics: calibrationMetrics(comparableRecords),
    excludedSampleCount: dataQualityExclusions.length,
    dataQualityExclusions,
    proposedChanges: eligible
      ? ["复核该赛事画像的概率校准；仅在独立回测与人工批准后纳入新版本。"]
      : []
  };
}
