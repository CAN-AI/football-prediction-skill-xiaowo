import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditEvidenceLedger } from "../core/evidence.mjs";

const auditCliPath = fileURLToPath(new URL("../scripts/audit-evidence.mjs", import.meta.url));
const sampleLedgerPath = fileURLToPath(new URL("../assets/sample-data/league-evidence.json", import.meta.url));

const match = {
  homeTeamId: "ARS",
  awayTeamId: "CHE",
  kickoffAt: "2026-08-01T15:00:00Z"
};

const claim = {
  claimId: "lineup-1",
  topic: "lineup",
  subject: "ARS",
  sourceTier: "social",
  sourceUrl: "https://example.invalid",
  publishedAt: "2026-08-01T09:00:00Z",
  observedAt: "2026-08-01T09:05:00Z",
  affectsModel: true,
  reviewStatus: "pending"
};

function acceptedClaim(overrides = {}) {
  return {
    ...claim,
    claimId: "schedule-1",
    topic: "schedule",
    subject: "ARS-CHE-2026-08-01",
    sourceTier: "official",
    reviewStatus: "accepted",
    value: "2026-08-01T15:00:00Z",
    ...overrides
  };
}

test("未确认候选首发不能进入模型", () => {
  const audit = auditEvidenceLedger({ ledger: [claim], match, cutoffAt: "2026-08-01T10:00:00Z" });

  assert.equal(audit.accepted.length, 0);
  assert.equal(audit.status, "degraded_low_confidence");
  assert.match(audit.rejected[0].reasons.join(" "), /来源等级|审核状态|首发确认/);
});

test("同指标不同口径必须隔离为冲突", () => {
  const input = acceptedClaim({
    topic: "xg",
    subject: "ARS",
    sourceTier: "data_provider",
    value: 1.4,
    metricDefinitionVersion: "provider-a"
  });
  const audit = auditEvidenceLedger({
    ledger: [input, { ...input, claimId: "xg-2", value: 1.9, metricDefinitionVersion: "provider-b" }],
    match,
    cutoffAt: "2026-08-01T10:00:00Z"
  });

  assert.equal(audit.conflicts.length, 1);
  assert.equal(audit.accepted.length, 0);
  assert.deepEqual(audit.conflicts[0].claimIds, ["schedule-1", "xg-2"]);
});

test("同主题同主体不同事件源必须隔离为冲突", () => {
  const input = acceptedClaim({
    topic: "statistics",
    subject: "ARS",
    sourceTier: "data_provider",
    value: 52,
    eventFeedId: "feed-a"
  });
  const audit = auditEvidenceLedger({
    ledger: [input, { ...input, claimId: "stats-2", value: 54, eventFeedId: "feed-b" }],
    match,
    cutoffAt: "2026-08-01T10:00:00Z"
  });

  assert.equal(audit.conflicts.length, 1);
  assert.equal(audit.accepted.length, 0);
  assert.deepEqual(audit.conflicts[0].eventFeedIds, ["feed-a", "feed-b"]);
});

test("截断时间后的证据不能进入模型", () => {
  const audit = auditEvidenceLedger({
    ledger: [acceptedClaim({ publishedAt: "2026-08-01T10:00:01Z" })],
    match,
    cutoffAt: "2026-08-01T10:00:00Z"
  });

  assert.equal(audit.accepted.length, 0);
  assert.match(audit.rejected[0].reasons.join(" "), /截断/);
});

test("缺失必填事实时列出精确字段名并降级", () => {
  const audit = auditEvidenceLedger({
    ledger: [acceptedClaim({ sourceUrl: undefined })],
    match: { ...match, awayTeamId: "" },
    cutoffAt: "2026-08-01T10:00:00Z"
  });

  assert.equal(audit.status, "degraded_low_confidence");
  assert.deepEqual(audit.missing, ["match.awayTeamId", "ledger.schedule-1.sourceUrl"]);
  assert.equal(audit.dataConfidence.level, "low");
});

test("缺少可追溯来源的证据不能进入模型", () => {
  const audit = auditEvidenceLedger({
    ledger: [acceptedClaim({ sourceUrl: undefined })],
    match,
    cutoffAt: "2026-08-01T10:00:00Z"
  });

  assert.equal(audit.accepted.length, 0);
  assert.match(audit.rejected[0].reasons.join(" "), /必填字段/);
});

test("已确认的官方首发可进入模型", () => {
  const audit = auditEvidenceLedger({
    ledger: [acceptedClaim({
      claimId: "lineup-confirmed",
      topic: "lineup",
      subject: "ARS",
      sourceTier: "club_official",
      lineupStatus: "confirmed"
    })],
    match,
    cutoffAt: "2026-08-01T10:00:00Z"
  });

  assert.equal(audit.status, "passed");
  assert.equal(audit.accepted.length, 1);
  assert.equal(audit.dataConfidence.level, "high");
});

test("审计 CLI 写入包含状态和数据置信度的 JSON", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "football-evidence-"));
  const outputPath = join(temporaryDirectory, "audit.json");

  try {
    const result = spawnSync(process.execPath, [auditCliPath, "--ledger", sampleLedgerPath, "--out", outputPath], {
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr);
    const audit = JSON.parse(readFileSync(outputPath, "utf8"));
    assert.equal(audit.status, "passed");
    assert.equal(audit.dataConfidence.level, "high");
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
