import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { auditEvidenceLedger } from "../core/evidence.mjs";
import { runPrematchPipeline, validatePublishedRun } from "../core/pipeline.mjs";
import { validateCompetitionProfile } from "../core/schema.mjs";

const match = {
  matchId: "ARS-CHE-2026-08-01",
  homeTeamId: "ARS",
  awayTeamId: "CHE",
  kickoffAt: "2026-08-01T15:00:00Z"
};

function acceptedClaim(overrides = {}) {
  return {
    claimId: "claim-1",
    topic: "statistics",
    subject: "ENG-PL:2026-27",
    sourceTier: "competition_official",
    sourceUrl: "https://official.test/data",
    publishedAt: "2026-07-31T12:00:00Z",
    observedAt: "2026-08-01T09:00:00Z",
    validUntil: "2026-08-01T15:00:00Z",
    metricDefinitionVersion: "eng-pl-2026-27-r1",
    eventFeedId: "eng-pl-official-2026-27",
    affectsModel: true,
    reviewStatus: "accepted",
    value: { goalsPerTeam: 1.55 },
    ...overrides
  };
}

test("赛事画像必须包含赛季、级别、样本窗口、中立规则和基线证据绑定", () => {
  const incomplete = validateCompetitionProfile({
    family: "friendly",
    competitionId: "X",
    baselineVersion: "X"
  });

  assert.equal(incomplete.ok, false);
  assert.match(incomplete.errors.join(" "), /赛季|season/);
  assert.match(incomplete.errors.join(" "), /级别|level/);
  assert.match(incomplete.errors.join(" "), /进球基线|goalsPerTeam/);
  assert.match(incomplete.errors.join(" "), /样本窗口|sampleWindow/);
  assert.match(incomplete.errors.join(" "), /中立|neutralVenue/);
  assert.match(incomplete.errors.join(" "), /证据|evidenceClaimIds/);
});

test("赛事画像拒绝不合理的 homeAdvantage", () => {
  const result = validateCompetitionProfile({
    family: "league",
    competitionId: "ENG-PL",
    season: "2026-27",
    level: "senior_professional",
    baselineVersion: "eng-pl-2026-27-r1",
    baseline: {
      goalsPerTeam: 1.55,
      sampleWindow: { from: "2025-08-01", to: "2026-05-31", matchCount: 380 },
      evidenceClaimIds: ["baseline-1"]
    },
    homeAdvantage: 999,
    regulation: { twoLegged: false, extraTime: false, penalties: false, neutralVenue: false }
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /homeAdvantage|主场/);
});

test("中立场的 homeAdvantage 必须为零", () => {
  const result = validateCompetitionProfile({
    family: "national_tournament",
    competitionId: "FIFA-WC",
    season: "2026",
    level: "senior_professional",
    baselineVersion: "fifa-wc-2026-r1",
    baseline: {
      goalsPerTeam: 1.4,
      sampleWindow: { from: "2022-11-20", to: "2022-12-18", matchCount: 64 },
      evidenceClaimIds: ["baseline-neutral"]
    },
    homeAdvantage: 0.12,
    regulation: { twoLegged: false, extraTime: true, penalties: true, neutralVenue: true }
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /中立场.*homeAdvantage|homeAdvantage.*零/);
});

test("homeAdvantage 必须与本次已接受的基线 claim 精确绑定", async () => {
  const input = JSON.parse(await readFile(
    new URL("../assets/sample-data/club-league-snapshot.json", import.meta.url),
    "utf8"
  ));
  input.manifest.competitionProfile.homeAdvantage = 0.13;
  input.evidenceLedger[0].value.homeAdvantage = 0.12;

  await assert.rejects(
    runPrematchPipeline({ input, outDir: "" }),
    /homeAdvantage|主场优势/
  );
});

test("空证据账本不能得到 passed 或 high", () => {
  const audit = auditEvidenceLedger({ ledger: [], match, cutoffAt: "2026-08-01T10:00:00Z" });

  assert.notEqual(audit.status, "passed");
  assert.notEqual(audit.dataConfidence.level, "high");
  assert.ok(audit.missing.includes("ledger.acceptedEvidence"));
});

test("validUntil 早于数据截止时间的证据必须拒绝", () => {
  const audit = auditEvidenceLedger({
    ledger: [acceptedClaim({ validUntil: "2026-08-01T09:59:59Z" })],
    match,
    cutoffAt: "2026-08-01T10:00:00Z"
  });

  assert.equal(audit.accepted.length, 0);
  assert.match(audit.rejected[0].reasons.join(" "), /过期|validUntil/);
});

test("同一指标定义和事件源出现不同值时必须隔离为冲突", () => {
  const first = acceptedClaim({ claimId: "baseline-1", value: { goalsPerTeam: 1.55 } });
  const second = acceptedClaim({ claimId: "baseline-2", value: { goalsPerTeam: 1.61 } });
  const audit = auditEvidenceLedger({ ledger: [first, second], match, cutoffAt: "2026-08-01T10:00:00Z" });

  assert.equal(audit.accepted.length, 0);
  assert.equal(audit.conflicts.length, 1);
  assert.deepEqual(audit.conflicts[0].claimIds, ["baseline-1", "baseline-2"]);
});

test("只有候选首发被拒绝时必须生成正式首发缺失字段", () => {
  const candidate = acceptedClaim({
    claimId: "candidate-lineup",
    topic: "lineup",
    subject: "ARS",
    sourceTier: "club_official",
    lineupStatus: "candidate",
    value: ["ARS-1", "ARS-2"]
  });
  const audit = auditEvidenceLedger({ ledger: [candidate], match, cutoffAt: "2026-08-01T10:00:00Z" });

  assert.equal(audit.status, "degraded_low_confidence");
  assert.ok(audit.missing.includes("lineup.ARS.confirmed"));
});

test("发布验证必须要求独立证据账本、审计及逐文件字节数", () => {
  const sha256 = "a".repeat(64);
  const artifact = (path) => ({ path, sha256, byteLength: 1 });
  const sixArtifactManifest = {
    artifacts: {
      inputSnapshot: artifact("input-snapshot.json"),
      prediction: artifact("prediction.json"),
      reportMarkdown: artifact("report.md"),
      reportHtml: artifact("report-long.html"),
      reportPng: artifact("report-long.png"),
      renderAudit: {
        ...artifact("render-audit.json"),
        metadata: {
          passed: true,
          errors: [],
          horizontalOverflow: false,
          tableOverflow: [],
          replacementCharacterDetected: false,
          pageHeightValid: true
        }
      }
    }
  };

  assert.equal(validatePublishedRun(sixArtifactManifest).ok, false);
  assert.match(validatePublishedRun(sixArtifactManifest).errors.join(" "), /evidence-ledger\.json/);
  assert.match(validatePublishedRun(sixArtifactManifest).errors.join(" "), /audit\.json/);

  const noSize = structuredClone(sixArtifactManifest);
  noSize.artifacts.evidenceLedger = { path: "evidence-ledger.json", sha256 };
  noSize.artifacts.audit = { path: "audit.json", sha256 };
  assert.match(validatePublishedRun(noSize).errors.join(" "), /byteLength|字节/);
});
