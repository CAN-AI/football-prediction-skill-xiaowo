const TOPIC_AUTHORITIES = Object.freeze({
  schedule: ["official", "competition_official", "governing_body"],
  regulation: ["official", "competition_official", "governing_body"],
  lineup: ["official", "competition_official", "governing_body", "club_official"],
  injury: ["official", "club_official", "medical_official"],
  statistics: ["official", "competition_official", "data_provider"],
  xg: ["data_provider"],
  weather: ["weather_provider", "official"],
  market: ["market_exchange", "market_provider", "data_provider"]
});

const FORBIDDEN_SOURCE_TIERS = new Set(["social", "self_media", "unknown"]);
const REQUIRED_CLAIM_FIELDS = [
  "claimId",
  "topic",
  "subject",
  "sourceTier",
  "sourceUrl",
  "publishedAt",
  "observedAt",
  "affectsModel",
  "reviewStatus"
];

function isPresent(value) {
  return value !== undefined && value !== null && value !== "";
}

function isValidTime(value) {
  return isPresent(value) && !Number.isNaN(Date.parse(value));
}

function claimPrefix(claim, index) {
  return `ledger.${claim?.claimId ?? index}`;
}

function collectMissingFields(ledger, match, cutoffAt) {
  const missing = [];

  for (const field of ["homeTeamId", "awayTeamId", "kickoffAt"]) {
    if (!isPresent(match?.[field])) missing.push(`match.${field}`);
  }
  if (!isPresent(cutoffAt)) missing.push("cutoffAt");

  if (!Array.isArray(ledger)) {
    missing.push("ledger");
    return missing;
  }

  ledger.forEach((claim, index) => {
    for (const field of REQUIRED_CLAIM_FIELDS) {
      if (!isPresent(claim?.[field])) missing.push(`${claimPrefix(claim, index)}.${field}`);
    }
  });

  return missing;
}

function rejectionReasons(claim, cutoffAt) {
  const reasons = [];
  const authority = TOPIC_AUTHORITIES[claim.topic];

  if (REQUIRED_CLAIM_FIELDS.some((field) => !isPresent(claim[field]))) {
    reasons.push("证据缺少必填字段");
  }

  if (!authority) reasons.push("主题不受证据策略支持");
  if (FORBIDDEN_SOURCE_TIERS.has(claim.sourceTier)) reasons.push("来源等级不可信");
  if (authority && !authority.includes(claim.sourceTier)) reasons.push("来源等级不具备该主题权威性");
  if (claim.reviewStatus !== "accepted") reasons.push("审核状态未接受");
  if (claim.affectsModel !== true) reasons.push("证据未标记为影响模型");

  if (claim.topic === "lineup" && !["confirmed", "official_confirmed"].includes(claim.lineupStatus)) {
    reasons.push("首发确认状态不足");
  }

  const cutoffTime = Date.parse(cutoffAt);
  const publishedTime = Date.parse(claim.publishedAt);
  const observedTime = Date.parse(claim.observedAt);
  if (!isValidTime(claim.publishedAt) || !isValidTime(claim.observedAt)) {
    reasons.push("发布时间或观察时间无效");
  } else if (publishedTime > cutoffTime || observedTime > cutoffTime) {
    reasons.push("证据晚于数据截断时间");
  }

  return reasons;
}

function isStructurallyRecognizable(claim) {
  return claim !== null
    && typeof claim === "object"
    && isPresent(claim.topic)
    && isPresent(claim.subject);
}

function buildConflicts(ledgerClaims) {
  const groups = new Map();
  for (const claim of ledgerClaims) {
    const key = `${claim.topic}\u0000${claim.subject}`;
    const group = groups.get(key) ?? [];
    group.push(claim);
    groups.set(key, group);
  }

  const conflicts = [];
  const conflictClaims = new Set();
  for (const claims of groups.values()) {
    const metricDefinitionVersions = [...new Set(claims.map((claim) => claim.metricDefinitionVersion ?? null))];
    const eventFeedIds = [...new Set(claims.map((claim) => claim.eventFeedId ?? null))];
    const hasMetricConflict = metricDefinitionVersions.length > 1;
    const hasFeedConflict = eventFeedIds.length > 1;
    if (!hasMetricConflict && !hasFeedConflict) continue;

    for (const claim of claims) conflictClaims.add(claim);
    conflicts.push({
      topic: claims[0].topic,
      subject: claims[0].subject,
      claimIds: claims.map((claim) => claim.claimId),
      metricDefinitionVersions,
      eventFeedIds,
      values: claims.map((claim) => ({
        claimId: claim.claimId,
        value: claim.value,
        metricDefinitionVersion: claim.metricDefinitionVersion ?? null,
        eventFeedId: claim.eventFeedId ?? null
      }))
    });
  }

  return { conflicts, conflictClaims };
}

function confidenceFor({ status, accepted, rejected, missing, conflicts }) {
  const level = status === "passed" ? "high" : status === "failed" ? "unavailable" : "low";
  const reasons = [];
  if (missing.length) reasons.push("存在缺失必填字段");
  if (rejected.length) reasons.push("存在未进入模型的证据");
  if (conflicts.length) reasons.push("存在隔离的口径或事件源冲突");

  return {
    level,
    acceptedClaimCount: accepted.length,
    rejectedClaimCount: rejected.length,
    missingFields: [...missing],
    conflictCount: conflicts.length,
    reasons
  };
}

export function auditEvidenceLedger({ ledger, match, cutoffAt } = {}) {
  const missing = collectMissingFields(ledger, match, cutoffAt);
  const invalidStructure = !Array.isArray(ledger) || !isValidTime(cutoffAt);
  if (invalidStructure) {
    const status = "failed";
    const accepted = [];
    const rejected = [];
    const conflicts = [];
    return { status, accepted, rejected, missing, conflicts, dataConfidence: confidenceFor({ status, accepted, rejected, missing, conflicts }) };
  }

  const assessments = ledger.map((claim) => ({ claim, reasons: rejectionReasons(claim ?? {}, cutoffAt) }));
  const { conflicts, conflictClaims } = buildConflicts(ledger.filter(isStructurallyRecognizable));
  for (const assessment of assessments) {
    if (conflictClaims.has(assessment.claim)) {
      assessment.reasons.push("与同主题同主体的口径或事件源冲突，已隔离");
    }
  }
  const accepted = assessments.filter(({ reasons }) => reasons.length === 0).map(({ claim }) => claim);
  const rejected = assessments
    .filter(({ reasons }) => reasons.length > 0)
    .map(({ claim, reasons }) => ({ claim, reasons }));

  const status = missing.length || rejected.length || conflicts.length ? "degraded_low_confidence" : "passed";
  return { status, accepted, rejected, missing, conflicts, dataConfidence: confidenceFor({ status, accepted, rejected, missing, conflicts }) };
}

export { TOPIC_AUTHORITIES };
