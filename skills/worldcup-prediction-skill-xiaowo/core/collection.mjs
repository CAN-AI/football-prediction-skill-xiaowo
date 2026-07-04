const SOURCE_TYPES = new Set([
  "official",
  "federation",
  "data_provider",
  "established_media",
  "local_media",
  "self_media",
  "social",
  "user_supplied",
  "unknown"
]);

const TRUSTED_SOURCE_TYPES = new Set(["official", "federation", "data_provider", "established_media"]);
const LOW_TRUST_SOURCE_TYPES = new Set(["self_media", "social", "unknown"]);
const TOPICS = new Set(["schedule", "ranking", "injury", "lineup", "weather", "venue", "form", "tactical", "rumor", "result", "other"]);
const CONFIDENCE_LEVELS = new Set(["high", "medium", "low"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function lower(value, fallback = "") {
  return hasText(value) ? value.trim().toLowerCase() : fallback;
}

function requireText(errors, value, field) {
  if (!hasText(value)) errors.push(`${field} 必须是非空字符串。`);
}

function parseTime(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function trustedSupports(claim) {
  return (claim.verifications ?? []).filter((item) => {
    return lower(item.verdict) === "supports" && TRUSTED_SOURCE_TYPES.has(lower(item.sourceType, "unknown"));
  });
}

function trustedContradictions(claim) {
  return (claim.verifications ?? []).filter((item) => {
    return lower(item.verdict) === "contradicts" && TRUSTED_SOURCE_TYPES.has(lower(item.sourceType, "unknown"));
  });
}

function independentSupports(claim) {
  const sources = new Set();
  for (const item of claim.verifications ?? []) {
    if (lower(item.verdict) !== "supports") continue;
    const sourceName = hasText(item.sourceName) ? item.sourceName.trim() : lower(item.sourceType, "unknown");
    sources.add(sourceName);
  }
  return sources.size;
}

export function createCollectionTemplate({ matchId, homeTeamId, awayTeamId, kickoffAt } = {}) {
  const now = new Date().toISOString();
  return {
    metadata: {
      collectionVersion: "xiaowo-collection-v2",
      generatedAt: now,
      matchId: matchId ?? ""
    },
    match: {
      matchId: matchId ?? "",
      homeTeamId: homeTeamId ?? "",
      awayTeamId: awayTeamId ?? "",
      kickoffAt: kickoffAt ?? ""
    },
    sourcePolicy: {
      officialFirst: true,
      selfMediaAsLeadOnly: true,
      modelImpactRequiresHumanReview: true
    },
    claims: [
      {
        id: "claim-1",
        topic: "injury",
        targetType: "team",
        targetId: "",
        summary: "",
        sourceType: "official",
        sourceName: "",
        sourceUrl: "",
        observedAt: now,
        eventTime: "",
        confidence: "medium",
        affectsModel: false,
        humanReviewed: false,
        verifications: []
      }
    ]
  };
}

export function normalizeCollection(collection) {
  return {
    ...collection,
    claims: (collection.claims ?? []).map((claim) => ({
      ...claim,
      id: hasText(claim.id) ? claim.id.trim() : claim.id,
      topic: lower(claim.topic, "other"),
      sourceType: lower(claim.sourceType, "unknown"),
      confidence: lower(claim.confidence, "low"),
      verifications: (claim.verifications ?? []).map((item) => ({
        ...item,
        sourceType: lower(item.sourceType, "unknown"),
        verdict: lower(item.verdict, "unclear")
      }))
    }))
  };
}

export function auditCollection(rawCollection) {
  const errors = [];
  const warnings = [];

  if (!isObject(rawCollection)) {
    return { ok: false, errors: ["collection 必须是 JSON 对象。"], warnings };
  }

  const collection = normalizeCollection(rawCollection);
  const metadata = collection.metadata;
  const match = collection.match;

  if (!isObject(metadata)) {
    errors.push("metadata 必须存在。");
  } else {
    requireText(errors, metadata.collectionVersion, "metadata.collectionVersion");
    requireText(errors, metadata.generatedAt, "metadata.generatedAt");
    requireText(errors, metadata.matchId, "metadata.matchId");
  }

  if (!isObject(match)) {
    errors.push("match 必须存在。");
  } else {
    requireText(errors, match.matchId, "match.matchId");
    requireText(errors, match.homeTeamId, "match.homeTeamId");
    requireText(errors, match.awayTeamId, "match.awayTeamId");
    requireText(errors, match.kickoffAt, "match.kickoffAt");
  }

  const claims = Array.isArray(collection.claims) ? collection.claims : [];
  if (claims.length === 0) warnings.push("claims 为空：收集 Agent 没有留下任何可复核资料。");

  let modelAffectingClaimCount = 0;
  let selfMediaClaimCount = 0;
  let trustedSupportCount = 0;

  for (const claim of claims) {
    if (!isObject(claim)) {
      errors.push("claims 中每一项都必须是对象。");
      continue;
    }

    requireText(errors, claim.id, "claim.id");
    requireText(errors, claim.summary, `claim(${claim.id ?? "unknown"}).summary`);
    requireText(errors, claim.sourceName, `claim(${claim.id ?? "unknown"}).sourceName`);
    requireText(errors, claim.observedAt, `claim(${claim.id ?? "unknown"}).observedAt`);

    if (!TOPICS.has(claim.topic)) {
      errors.push(`claim(${claim.id ?? "unknown"}).topic=${claim.topic} 不在允许范围内。`);
    }
    if (!SOURCE_TYPES.has(claim.sourceType)) {
      errors.push(`claim(${claim.id ?? "unknown"}).sourceType=${claim.sourceType} 不在允许范围内。`);
    }
    if (!CONFIDENCE_LEVELS.has(claim.confidence)) {
      errors.push(`claim(${claim.id ?? "unknown"}).confidence=${claim.confidence} 不在允许范围内。`);
    }

    if (!parseTime(claim.observedAt)) {
      errors.push(`claim(${claim.id ?? "unknown"}).observedAt 不是有效时间。`);
    }

    const supports = trustedSupports(claim);
    trustedSupportCount += supports.length;
    if (LOW_TRUST_SOURCE_TYPES.has(claim.sourceType)) selfMediaClaimCount += 1;
    if (claim.affectsModel === true) modelAffectingClaimCount += 1;

    const contradictions = trustedContradictions(claim);
    if (claim.affectsModel === true && contradictions.length > 0) {
      errors.push(`claim(${claim.id}) 被可信来源反驳，不能影响模型。`);
    }

    if (claim.affectsModel === true && claim.humanReviewed !== true) {
      errors.push(`claim(${claim.id}) affectsModel=true 时必须 humanReviewed=true。`);
    }

    if (claim.affectsModel === true && claim.confidence === "low") {
      errors.push(`claim(${claim.id}) 置信度为 low，不能直接影响模型。`);
    }

    if (claim.affectsModel === true && LOW_TRUST_SOURCE_TYPES.has(claim.sourceType) && supports.length === 0 && independentSupports(claim) < 2) {
      errors.push(`claim(${claim.id}) 来自自媒体/社交/未知来源，affectsModel=true 前必须有可信来源支持或至少两个独立来源交叉验证。`);
    }

    if (claim.affectsModel === true && claim.topic === "schedule" && !TRUSTED_SOURCE_TYPES.has(claim.sourceType) && supports.length === 0) {
      errors.push(`claim(${claim.id}) 是赛程时间类信息，必须由官方、协会、数据商或权威媒体确认。`);
    }

    if (claim.topic === "schedule" && hasText(claim.kickoffAt) && hasText(match?.kickoffAt)) {
      const claimKickoff = parseTime(claim.kickoffAt);
      const matchKickoff = parseTime(match.kickoffAt);
      if (claimKickoff && matchKickoff && claimKickoff !== matchKickoff) {
        errors.push(`claim(${claim.id}) 的开赛时间与 match.kickoffAt 不一致，需要核对后再使用。`);
      }
    }

    if (claim.topic === "rumor" && claim.affectsModel === true) {
      errors.push(`claim(${claim.id}) topic=rumor，不能直接影响模型。`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    normalizedCollection: collection,
    summary: {
      claimCount: claims.length,
      modelAffectingClaimCount,
      selfMediaClaimCount,
      trustedSupportCount
    }
  };
}
