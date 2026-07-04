import { asNumber, dataVersionFromSources, snapshotContentHash } from "./utils.mjs";

const VALID_STAGES = new Set(["group", "round_of_32", "round_of_16", "quarter_final", "semi_final", "third_place", "final", "friendly", "other"]);
const VALID_STATUSES = new Set(["scheduled", "in_progress", "final", "postponed", "cancelled"]);
const VALID_DERIVATIONS = new Set(["manual_review", "deterministic_rule", "source_update"]);
const SAFE_ID_RE = /^[A-Za-z0-9._-]+$/;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function looksEncodingDamaged(value) {
  return typeof value === "string" && (value.includes("\uFFFD") || /\?{2,}/.test(value));
}

function requireText(errors, value, field) {
  if (!hasText(value)) errors.push(`${field} 必须是非空字符串。`);
}

function warnIfEncodingDamaged(warnings, value, field) {
  if (looksEncodingDamaged(value)) warnings.push(`${field} 看起来存在编码损坏或问号占位，请使用 UTF-8 重新写入。`);
}

function errorIfEncodingDamaged(errors, value, field) {
  if (looksEncodingDamaged(value)) errors.push(`${field} 看起来存在编码损坏或问号占位，请使用 UTF-8 重新写入。`);
}

function checkScore(errors, score, field) {
  if (!isObject(score) || !Number.isInteger(score.home) || !Number.isInteger(score.away) || score.home < 0 || score.away < 0) {
    errors.push(`${field} 必须包含非负整数 home/away。`);
  }
}

function teamHasRating(team) {
  return Number.isFinite(asNumber(team.ratingValue)) ||
    Number.isFinite(asNumber(team.eloRating)) ||
    Number.isFinite(asNumber(team.fifaRank));
}

export function auditSnapshot(snapshot) {
  const errors = [];
  const warnings = [];

  if (!isObject(snapshot)) {
    return { ok: false, errors: ["快照必须是 JSON 对象。"], warnings };
  }

  const metadata = snapshot.metadata;
  if (!isObject(metadata)) {
    errors.push("metadata 必须存在。");
  } else {
    requireText(errors, metadata.modelVersion, "metadata.modelVersion");
    requireText(errors, metadata.dataVersion, "metadata.dataVersion");
    requireText(errors, metadata.generatedAt, "metadata.generatedAt");
    requireText(errors, metadata.strengthSnapshotVersion, "metadata.strengthSnapshotVersion");
    warnIfEncodingDamaged(warnings, metadata.name, "metadata.name");
    warnIfEncodingDamaged(warnings, metadata.sampleScope, "metadata.sampleScope");
    if (!isObject(metadata.sourceVersions) || Object.keys(metadata.sourceVersions).length === 0) {
      errors.push("metadata.sourceVersions 必须记录每类输入来源的版本。");
    } else {
      for (const [source, version] of Object.entries(metadata.sourceVersions)) {
        if (!hasText(version)) errors.push(`metadata.sourceVersions.${source} 必须是非空版本号。`);
      }
      if ("strength" in metadata.sourceVersions) {
        errors.push("metadata.sourceVersions 不能写 strength，请使用 metadata.strengthSnapshotVersion。");
      }
    }
  }

  const teams = Array.isArray(snapshot.teams) ? snapshot.teams : [];
  if (teams.length === 0) errors.push("teams 至少需要一支球队。");
  if (isObject(metadata) && Number.isInteger(metadata.expectedTeamCount) && metadata.expectedTeamCount !== teams.length) {
    errors.push(`metadata.expectedTeamCount=${metadata.expectedTeamCount} 与 teams.length=${teams.length} 不一致。`);
  }

  const teamIds = new Set();
  const teamCodes = new Set();
  for (const team of teams) {
    if (!isObject(team)) {
      errors.push("teams 中每一项都必须是对象。");
      continue;
    }
    requireText(errors, team.id, "team.id");
    requireText(errors, team.name, `team(${team.id ?? "unknown"}).name`);
    errorIfEncodingDamaged(errors, team.name, `team(${team.id ?? "unknown"}).name`);
    if (team.id) {
      if (teamIds.has(team.id)) errors.push(`重复球队 id: ${team.id}`);
      teamIds.add(team.id);
    }
    if (team.code) teamCodes.add(team.code);
    if (isObject(metadata) && team.strengthVersion !== metadata.strengthSnapshotVersion) {
      errors.push(`球队 ${team.id ?? "unknown"} 的 strengthVersion 没有使用 ${metadata.strengthSnapshotVersion}。`);
    }
    if (!teamHasRating(team)) {
      errors.push(`球队 ${team.id ?? "unknown"} 缺少 ratingValue、eloRating 或 fifaRank。`);
    }
    const fifaRank = asNumber(team.fifaRank);
    if (fifaRank !== undefined && (!Number.isInteger(fifaRank) || fifaRank <= 0)) warnings.push(`球队 ${team.id} 的 fifaRank 异常。`);
    const formScore = asNumber(team.formScore);
    if (formScore !== undefined && (formScore < 0 || formScore > 100)) warnings.push(`球队 ${team.id} 的 formScore 应在 0-100。`);
    for (const key of ["attackStrength", "defenseStrength"]) {
      const value = asNumber(team[key]);
      if (value !== undefined && (value <= 0 || value > 3)) warnings.push(`球队 ${team.id} 的 ${key} 超出常见范围。`);
    }
  }

  const matchStates = Array.isArray(snapshot.matchStates) ? snapshot.matchStates : [];
  if (matchStates.length === 0) warnings.push("matchStates 为空，CLI 仍可用 --home/--away 临时预测，但不利于复盘。");
  const matchIds = new Set();
  for (const match of matchStates) {
    if (!isObject(match)) {
      errors.push("matchStates 中每一项都必须是对象。");
      continue;
    }
    requireText(errors, match.matchId, "match.matchId");
    if (match.matchId) {
      if (!SAFE_ID_RE.test(match.matchId)) {
        errors.push(`matchId ${match.matchId} 只能包含字母、数字、点、下划线和连字符，避免生成不安全文件名。`);
      }
      if (matchIds.has(match.matchId)) errors.push(`重复 matchId: ${match.matchId}`);
      matchIds.add(match.matchId);
    }
    if (!VALID_STAGES.has(match.stage)) errors.push(`比赛 ${match.matchId} 的 stage 无效: ${match.stage}`);
    if (!VALID_STATUSES.has(match.status)) errors.push(`比赛 ${match.matchId} 的 status 无效: ${match.status}`);
    if (!teamIds.has(match.homeTeamId)) errors.push(`比赛 ${match.matchId} 的 homeTeamId 不在 teams 中。`);
    if (!teamIds.has(match.awayTeamId)) errors.push(`比赛 ${match.matchId} 的 awayTeamId 不在 teams 中。`);
    if (match.status === "final") {
      checkScore(errors, match.actualScore90min, `match(${match.matchId}).actualScore90min`);
      if (match.stage !== "group" && match.stage !== "friendly" && match.stage !== "other" && !teamIds.has(match.advanceTeamId)) {
        warnings.push(`淘汰赛 ${match.matchId} 最好记录 advanceTeamId，避免把 90 分钟结果和晋级结果混在一起。`);
      }
    }
  }

  const contextAdjustments = Array.isArray(snapshot.contextAdjustments) ? snapshot.contextAdjustments : [];
  for (const adjustment of contextAdjustments) {
    if (!isObject(adjustment)) {
      errors.push("contextAdjustments 中每一项都必须是对象。");
      continue;
    }
    requireText(errors, adjustment.id, "adjustment.id");
    errorIfEncodingDamaged(errors, adjustment.title, `adjustment(${adjustment.id ?? "unknown"}).title`);
    if (!VALID_DERIVATIONS.has(adjustment.derivation)) {
      errors.push(`修正 ${adjustment.id ?? "unknown"} 的 derivation=${adjustment.derivation} 不允许。允许值：manual_review、deterministic_rule、source_update。`);
    }
    if (adjustment.derivation === "deterministic_rule" && !hasText(adjustment.ruleVersion)) {
      errors.push(`deterministic_rule 修正 ${adjustment.id} 必须写 ruleVersion。`);
    }
    if ((adjustment.derivation === "manual_review" || adjustment.derivation === "source_update") && adjustment.humanReviewed !== true) {
      warnings.push(`修正 ${adjustment.id} 建议显式写 humanReviewed: true，表示不是 AI 直接改数。`);
    }
    if (adjustment.derivation?.startsWith("llm")) {
      errors.push(`修正 ${adjustment.id} 不能直接使用 LLM 生成值，必须结构化写入并人工复核。`);
    }
    if (!isObject(adjustment.impact)) warnings.push(`修正 ${adjustment.id} 没有 impact，可能只适合作为说明。`);
    if (adjustment.matchId && !matchIds.has(adjustment.matchId)) warnings.push(`修正 ${adjustment.id} 指向的 matchId 不在 matchStates 中。`);
    if (adjustment.teamId && !teamIds.has(adjustment.teamId)) warnings.push(`修正 ${adjustment.id} 指向的 teamId 不在 teams 中。`);
    if (adjustment.teamCode && !teamCodes.has(adjustment.teamCode)) warnings.push(`修正 ${adjustment.id} 指向的 teamCode 不在 teams 中。`);
  }

  const officialFacts = Array.isArray(snapshot.officialFacts) ? snapshot.officialFacts : [];
  for (const fact of officialFacts) {
    if (!isObject(fact)) continue;
    errorIfEncodingDamaged(errors, fact.summary, `officialFact(${fact.id ?? "unknown"}).summary`);
  }

  let expectedDataVersion;
  let expectedSnapshotContentHash;
  if (isObject(metadata) && isObject(metadata.sourceVersions) && hasText(metadata.strengthSnapshotVersion)) {
    expectedDataVersion = dataVersionFromSources(metadata.sourceVersions, metadata.strengthSnapshotVersion);
    if (metadata.dataVersion !== expectedDataVersion) {
      errors.push(`metadata.dataVersion 应为 ${expectedDataVersion}，当前为 ${metadata.dataVersion}。`);
    }
  }
  if (isObject(metadata) && hasText(metadata.snapshotContentHash)) {
    expectedSnapshotContentHash = snapshotContentHash(snapshot);
    if (metadata.snapshotContentHash !== expectedSnapshotContentHash) {
      errors.push(`metadata.snapshotContentHash 内容哈希不匹配，应为 ${expectedSnapshotContentHash}，当前为 ${metadata.snapshotContentHash}。`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    expectedDataVersion,
    expectedSnapshotContentHash,
    summary: {
      teamCount: teams.length,
      matchCount: matchStates.length,
      adjustmentCount: contextAdjustments.length,
      sourceCount: metadata?.sourceVersions ? Object.keys(metadata.sourceVersions).length : 0
    }
  };
}

export function assertAudit(snapshot) {
  const audit = auditSnapshot(snapshot);
  if (!audit.ok) {
    throw new Error(`输入审计未通过：\n${audit.errors.map((item) => `- ${item}`).join("\n")}`);
  }
  return audit;
}
