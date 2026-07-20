import { contentHash } from "./utils.mjs";

function matchIdentities(manifest = {}) {
  const match = manifest.match ?? {};
  if (typeof match.matchId === "string" && match.matchId) return new Set([match.matchId]);
  return new Set([
    match.homeTeamId && match.awayTeamId ? `${match.homeTeamId}-${match.awayTeamId}` : null,
    match.homeTeamId && match.awayTeamId ? `${match.homeTeamId} vs ${match.awayTeamId}` : null,
    match.homeTeamName && match.awayTeamName ? `${match.homeTeamName}-${match.awayTeamName}` : null,
    match.homeTeamName && match.awayTeamName ? `${match.homeTeamName} vs ${match.awayTeamName}` : null
  ].filter(Boolean));
}

function claimMatchesReportMatch(claim, manifest) {
  const identity = claim?.matchId ?? claim?.match?.matchId ?? claim?.subject;
  return typeof identity === "string" && matchIdentities(manifest).has(identity);
}

export function canonicalFact(kind, value = {}) {
  if (!value || typeof value !== "object") return null;
  if (kind === "result") {
    if (!Number.isInteger(value.homeGoals) || value.homeGoals < 0
      || !Number.isInteger(value.awayGoals) || value.awayGoals < 0) return null;
    return {
      homeGoals: value.homeGoals,
      awayGoals: value.awayGoals,
      decidedIn: value.decidedIn ?? null,
      observedAt: value.observedAt ?? null
    };
  }
  if (kind === "event") {
    if (typeof (value.event ?? value.description) !== "string"
      || !(value.event ?? value.description).trim()) return null;
    return {
      minute: Number.isFinite(value.minute) ? value.minute : null,
      occurredAt: value.occurredAt ?? null,
      event: value.event ?? value.description,
      teamId: value.teamId ?? null,
      teamName: value.teamName ?? null
    };
  }
  if (kind === "statistics") {
    if (typeof value.metric !== "string" || !value.metric.trim()) return null;
    return {
      metric: value.metric,
      home: value.home ?? null,
      away: value.away ?? null,
      definition: value.definition ?? value.metricDefinition ?? null
    };
  }
  return null;
}

export function factFingerprint(kind, value) {
  const canonical = canonicalFact(kind, value);
  return canonical ? contentHash({ kind, value: canonical }) : null;
}

export function boundClaim(item, claims, { topic, kind, manifest }) {
  const claimId = item?.sourceClaimId ?? item?.claimId;
  if (typeof claimId !== "string" || !claimId) return null;
  const claim = claims.get(claimId);
  if (!claim || claim.topic !== topic || !claimMatchesReportMatch(claim, manifest)) return null;
  const displayedFingerprint = factFingerprint(kind, item);
  const acceptedFingerprint = factFingerprint(kind, claim.value);
  if (!displayedFingerprint || !acceptedFingerprint || displayedFingerprint !== acceptedFingerprint) return null;
  if (claim.factFingerprint && claim.factFingerprint !== acceptedFingerprint) return null;
  return claim;
}
