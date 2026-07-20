import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { auditEvidenceLedger } from "../core/evidence.mjs";
import * as pipeline from "../core/pipeline.mjs";
import * as postmatch from "../core/postmatch.mjs";
import { buildPostmatchReport } from "../core/report.mjs";

const execFileAsync = promisify(execFile);

const match = {
  matchId: "ARS-CHE-2026-08-01",
  homeTeamId: "ARS",
  awayTeamId: "CHE",
  kickoffAt: "2026-08-01T15:00:00Z"
};

const profile = {
  family: "league",
  competitionId: "ENG-PL",
  season: "2026-27",
  level: "senior_professional",
  stage: "regular_season",
  baselineVersion: "eng-pl-2026-27-r1",
  baseline: {
    goalsPerTeam: 1.55,
    sampleWindow: { from: "2025-08-01", to: "2026-05-31", matchCount: 380 },
    evidenceClaimIds: ["baseline-1"]
  },
  homeAdvantage: 0.12,
  regulation: { twoLegged: false, extraTime: false, penalties: false, neutralVenue: false }
};

function publishedManifest() {
  return {
    runId: "prematch-run-1",
    mode: "prematch",
    finalizedAt: "2026-08-01T10:05:00Z",
    match,
    competitionProfile: profile,
    artifacts: { prediction: { path: "prediction.json", sha256: "a".repeat(64), byteLength: 1 } }
  };
}

function prediction() {
  return {
    resultScope: "90min",
    probabilities: { homeWinProb: 0.5, drawProb: 0.3, awayWinProb: 0.2 }
  };
}

function resultValue(overrides = {}) {
  return {
    homeGoals: 2,
    awayGoals: 1,
    decidedIn: "90min",
    observedAt: "2026-08-01T17:00:00Z",
    ...overrides
  };
}

test("赛后记录不能信任调用方自报的 acceptedClaims", () => {
  const actualResult = { ...resultValue(), sourceClaimId: "result-1" };
  assert.throws(() => postmatch.recordPostmatch({
    manifest: publishedManifest(),
    prediction: prediction(),
    facts: {
      predictionRunId: "prematch-run-1",
      predictionSha256: "a".repeat(64),
      actualResult,
      acceptedClaims: [{
        claimId: "result-1",
        topic: "result",
        subject: match.matchId,
        value: resultValue()
      }]
    }
  }), /evidenceLedger|重新审计|fresh/i);
});

test("核心必须提供不可变 postmatch 流水线", () => {
  assert.equal(typeof pipeline.runPostmatchPipeline, "function");
});

test("postmatch 流水线新建子运行、重新审计赛果并哈希全部产物", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "football-postmatch-pipeline-"));
  const prematchInput = JSON.parse(await readFile(new URL("../assets/sample-data/club-league-snapshot.json", import.meta.url), "utf8"));
  prematchInput.manifest.runId = "prematch-parent-p1";
  const actualResult = { ...resultValue(), sourceClaimId: "result-p1" };
  const postmatchInput = {
    manifest: { runId: "postmatch-child-p1", dataCutoffAt: "2026-08-01T18:00:00Z" },
    evidenceLedger: [{
      claimId: "result-p1",
      topic: "result",
      subject: match.matchId,
      sourceTier: "competition_official",
      sourceUrl: "https://official.test/result-p1",
      publishedAt: "2026-08-01T17:00:00Z",
      observedAt: "2026-08-01T17:00:00Z",
      affectsModel: true,
      reviewStatus: "accepted",
      value: resultValue()
    }],
    postmatch: { actualResult }
  };

  try {
    const prematchRun = await pipeline.runPrematchPipeline({ input: prematchInput, outDir: outputRoot });
    const parentPredictionBefore = await readFile(prematchRun.paths.prediction);
    {
      const parentManifestBytes = await readFile(prematchRun.paths.manifest);
      const invalidParentManifest = JSON.parse(parentManifestBytes.toString("utf8"));
      invalidParentManifest.competitionProfile.homeAdvantage = 999;
      await writeFile(prematchRun.paths.manifest, `${JSON.stringify(invalidParentManifest, null, 2)}\n`, "utf8");
      await assert.rejects(
        pipeline.loadPublishedRun(prematchRun.runDirectory, { expectedMode: "prematch" }),
        /homeAdvantage|主场/
      );
      await writeFile(prematchRun.paths.manifest, parentManifestBytes);
    }
    const result = await pipeline.runPostmatchPipeline({
      prematchRunDir: prematchRun.runDirectory,
      input: postmatchInput,
      outDir: outputRoot
    });
    const manifest = JSON.parse(await readFile(result.paths.manifest, "utf8"));
    const audit = JSON.parse(await readFile(result.paths.audit, "utf8"));
    const required = ["evidenceLedger", "audit", "inputSnapshot", "prediction", "record", "reportMarkdown", "reportHtml", "reportPng", "renderAudit"];

    assert.equal(manifest.mode, "postmatch");
    assert.equal(manifest.parentRunId, "prematch-parent-p1");
    assert.deepEqual(audit.accepted.map((claim) => claim.claimId), ["result-p1"]);
    assert.equal(result.record.resultEvidence.claimId, "result-p1");
    for (const name of required) {
      const bytes = await readFile(join(result.runDirectory, manifest.artifacts[name].path));
      assert.equal(bytes.byteLength, manifest.artifacts[name].byteLength);
      assert.match(manifest.artifacts[name].sha256, /^[a-f0-9]{64}$/);
    }
    assert.equal(manifest.artifacts.prediction.sha256, prematchRun.manifest.artifacts.prediction.sha256);
    assert.deepEqual(await readFile(prematchRun.paths.prediction), parentPredictionBefore);
    assert.deepEqual(pipeline.validatePublishedRun(manifest), { ok: true, errors: [] });
    const reportBeforeVerification = await readFile(result.paths.reportMarkdown);
    const rootCli = fileURLToPath(new URL("../../../bin/football-xiaowo.mjs", import.meta.url));
    const verification = await execFileAsync(process.execPath, [
      rootCli,
      "report",
      "--run-dir",
      result.runDirectory,
      "--prematch-run-dir",
      prematchRun.runDirectory
    ]);
    assert.match(verification.stdout, /赛后报告.*复验通过/);
    assert.deepEqual(await readFile(result.paths.reportMarkdown), reportBeforeVerification);
    {
      const originalInputSnapshotBytes = await readFile(result.paths.inputSnapshot);
      const originalManifestBytes = await readFile(result.paths.manifest);
      const tamperedInputSnapshot = JSON.parse(originalInputSnapshotBytes.toString("utf8"));
      tamperedInputSnapshot.manifest.runId = "invented-child";
      const tamperedInputSnapshotBytes = Buffer.from(`${JSON.stringify(tamperedInputSnapshot, null, 2)}\n`, "utf8");
      const rehashedManifest = JSON.parse(originalManifestBytes.toString("utf8"));
      rehashedManifest.artifacts.inputSnapshot.sha256 = createHash("sha256").update(tamperedInputSnapshotBytes).digest("hex");
      rehashedManifest.artifacts.inputSnapshot.byteLength = tamperedInputSnapshotBytes.byteLength;
      await writeFile(result.paths.inputSnapshot, tamperedInputSnapshotBytes);
      await writeFile(result.paths.manifest, `${JSON.stringify(rehashedManifest, null, 2)}\n`, "utf8");
      await assert.rejects(
        execFileAsync(process.execPath, [
          rootCli,
          "report",
          "--run-dir",
          result.runDirectory,
          "--prematch-run-dir",
          prematchRun.runDirectory
        ]),
        /input-snapshot\.json.*manifest\.runId/
      );
      await writeFile(result.paths.inputSnapshot, originalInputSnapshotBytes);
      await writeFile(result.paths.manifest, originalManifestBytes);
    }
    {
      const originalManifestBytes = await readFile(result.paths.manifest);
      const tamperedReportBytes = Buffer.from("# 伪造赛后报告\n", "utf8");
      const rehashedManifest = JSON.parse(originalManifestBytes.toString("utf8"));
      rehashedManifest.artifacts.reportMarkdown.sha256 = createHash("sha256").update(tamperedReportBytes).digest("hex");
      rehashedManifest.artifacts.reportMarkdown.byteLength = tamperedReportBytes.byteLength;
      await writeFile(result.paths.reportMarkdown, tamperedReportBytes);
      await writeFile(result.paths.manifest, `${JSON.stringify(rehashedManifest, null, 2)}\n`, "utf8");
      await assert.rejects(
        execFileAsync(process.execPath, [
          rootCli,
          "report",
          "--run-dir",
          result.runDirectory,
          "--prematch-run-dir",
          prematchRun.runDirectory
        ]),
        /report\.md.*同源/
      );
      await writeFile(result.paths.reportMarkdown, reportBeforeVerification);
      await writeFile(result.paths.manifest, originalManifestBytes);
    }
    {
      const originalManifestBytes = await readFile(result.paths.manifest);
      const originalPngBytes = await readFile(result.paths.reportPng);
      const tamperedPngBytes = Buffer.from("not-a-real-png", "utf8");
      const rehashedManifest = JSON.parse(originalManifestBytes.toString("utf8"));
      rehashedManifest.artifacts.reportPng.sha256 = createHash("sha256").update(tamperedPngBytes).digest("hex");
      rehashedManifest.artifacts.reportPng.byteLength = tamperedPngBytes.byteLength;
      await writeFile(result.paths.reportPng, tamperedPngBytes);
      await writeFile(result.paths.manifest, `${JSON.stringify(rehashedManifest, null, 2)}\n`, "utf8");
      await assert.rejects(
        execFileAsync(process.execPath, [
          rootCli,
          "report",
          "--run-dir",
          result.runDirectory,
          "--prematch-run-dir",
          prematchRun.runDirectory
        ]),
        /report-long\.png.*同源/
      );
      await writeFile(result.paths.reportPng, originalPngBytes);
      await writeFile(result.paths.manifest, originalManifestBytes);
    }
    const runsIndexPath = join(outputRoot, "calibration-runs.json");
    const proposalPath = join(outputRoot, "calibration-proposal.json");
    await writeFile(runsIndexPath, JSON.stringify({ runs: [{
      postmatchRunDir: result.runDirectory,
      prematchRunDir: prematchRun.runDirectory
    }] }), "utf8");
    const calibrationScript = fileURLToPath(new URL("../scripts/propose-calibration.mjs", import.meta.url));
    await execFileAsync(process.execPath, [calibrationScript, "--runs", runsIndexPath, "--out", proposalPath]);
    const proposal = JSON.parse(await readFile(proposalPath, "utf8"));
    assert.equal(proposal.comparableSampleCount, 1);
    assert.equal(proposal.eligibility, "insufficient_sample");

    {
      const parentEvidenceBytes = await readFile(prematchRun.paths.evidenceLedger);
      const parentAuditBytes = await readFile(prematchRun.paths.audit);
      const parentManifestBytes = await readFile(prematchRun.paths.manifest);
      const emptyEvidence = JSON.parse(parentEvidenceBytes.toString("utf8"));
      emptyEvidence.ledger = [];
      const emptyEvidenceBytes = Buffer.from(`${JSON.stringify(emptyEvidence, null, 2)}\n`, "utf8");
      const emptyAudit = auditEvidenceLedger({
        ledger: [],
        match: prematchRun.manifest.match,
        cutoffAt: prematchRun.manifest.dataCutoffAt
      });
      const emptyAuditBytes = Buffer.from(`${JSON.stringify(emptyAudit, null, 2)}\n`, "utf8");
      const rehashedParentManifest = JSON.parse(parentManifestBytes.toString("utf8"));
      rehashedParentManifest.artifacts.evidenceLedger.sha256 = createHash("sha256").update(emptyEvidenceBytes).digest("hex");
      rehashedParentManifest.artifacts.evidenceLedger.byteLength = emptyEvidenceBytes.byteLength;
      rehashedParentManifest.artifacts.audit.sha256 = createHash("sha256").update(emptyAuditBytes).digest("hex");
      rehashedParentManifest.artifacts.audit.byteLength = emptyAuditBytes.byteLength;
      rehashedParentManifest.artifacts.audit.metadata.evidenceAudit = {
        status: emptyAudit.status,
        missing: emptyAudit.missing,
        conflicts: emptyAudit.conflicts
      };
      await writeFile(prematchRun.paths.evidenceLedger, emptyEvidenceBytes);
      await writeFile(prematchRun.paths.audit, emptyAuditBytes);
      await writeFile(prematchRun.paths.manifest, `${JSON.stringify(rehashedParentManifest, null, 2)}\n`, "utf8");
      await assert.rejects(
        execFileAsync(process.execPath, [calibrationScript, "--runs", runsIndexPath, "--out", join(outputRoot, "missing-parent-evidence-proposal.json")]),
        /homeAdvantage|rating\/attack\/defense|模型输入.*绑定|基线绑定/
      );
      await writeFile(prematchRun.paths.evidenceLedger, parentEvidenceBytes);
      await writeFile(prematchRun.paths.audit, parentAuditBytes);
      await writeFile(prematchRun.paths.manifest, parentManifestBytes);
    }

    const recordBytes = await readFile(result.paths.record);
    const tamperedRecord = JSON.parse(recordBytes.toString("utf8"));
    tamperedRecord.publishedBeforeKickoff = false;
    await writeFile(result.paths.record, `${JSON.stringify(tamperedRecord, null, 2)}\n`, "utf8");
    await assert.rejects(
      execFileAsync(process.execPath, [calibrationScript, "--runs", runsIndexPath, "--out", join(outputRoot, "tampered-record-proposal.json")]),
      /record\.json.*SHA-256/
    );
    await writeFile(result.paths.record, recordBytes);

    const manifestBytes = await readFile(result.paths.manifest);
    const wrongParentManifest = JSON.parse(manifestBytes.toString("utf8"));
    wrongParentManifest.parentRunId = "invented-parent";
    await writeFile(result.paths.manifest, `${JSON.stringify(wrongParentManifest, null, 2)}\n`, "utf8");
    await assert.rejects(
      execFileAsync(process.execPath, [calibrationScript, "--runs", runsIndexPath, "--out", join(outputRoot, "wrong-parent-proposal.json")]),
      /parentRunId.*prematch/
    );
    await writeFile(result.paths.manifest, manifestBytes);

    const evidenceBytes = await readFile(result.paths.evidenceLedger);
    const tamperedEvidence = JSON.parse(evidenceBytes.toString("utf8"));
    tamperedEvidence.ledger[0].value.homeGoals = 3;
    const tamperedEvidenceBytes = Buffer.from(`${JSON.stringify(tamperedEvidence, null, 2)}\n`, "utf8");
    const rehashedManifest = JSON.parse(manifestBytes.toString("utf8"));
    rehashedManifest.artifacts.evidenceLedger.sha256 = createHash("sha256").update(tamperedEvidenceBytes).digest("hex");
    rehashedManifest.artifacts.evidenceLedger.byteLength = tamperedEvidenceBytes.byteLength;
    await writeFile(result.paths.evidenceLedger, tamperedEvidenceBytes);
    await writeFile(result.paths.manifest, `${JSON.stringify(rehashedManifest, null, 2)}\n`, "utf8");
    await assert.rejects(
      execFileAsync(process.execPath, [calibrationScript, "--runs", runsIndexPath, "--out", join(outputRoot, "tampered-evidence-proposal.json")]),
      /audit\.json.*重新审计/
    );
    await writeFile(result.paths.evidenceLedger, evidenceBytes);
    await writeFile(result.paths.manifest, manifestBytes);
    await assert.rejects(
      pipeline.runPostmatchPipeline({ prematchRunDir: prematchRun.runDirectory, input: postmatchInput, outDir: outputRoot }),
      /拒绝覆写旧赛后运行/
    );
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("赛事画像键必须区分赛季、基线、规则和样本窗口", () => {
  assert.equal(typeof postmatch.competitionProfileKey, "function");
  const baseKey = postmatch.competitionProfileKey(profile);
  assert.notEqual(baseKey, postmatch.competitionProfileKey({ ...profile, season: "2027-28" }));
  assert.notEqual(baseKey, postmatch.competitionProfileKey({ ...profile, baselineVersion: "eng-pl-2026-27-r2" }));
  assert.notEqual(baseKey, postmatch.competitionProfileKey({
    ...profile,
    baseline: { ...profile.baseline, goalsPerTeam: 2.1 }
  }));
  assert.notEqual(baseKey, postmatch.competitionProfileKey({ ...profile, homeAdvantage: 0.3 }));
  assert.notEqual(baseKey, postmatch.competitionProfileKey({
    ...profile,
    regulation: { ...profile.regulation, neutralVenue: true }
  }));
  assert.notEqual(baseKey, postmatch.competitionProfileKey({
    ...profile,
    baseline: { ...profile.baseline, sampleWindow: { ...profile.baseline.sampleWindow, matchCount: 100 } }
  }));
});

function calibrationRecord(overrides = {}) {
  return {
    predictionRunId: "same-run",
    predictionSha256: "a".repeat(64),
    matchId: "same-match",
    competitionProfile: profile,
    competitionProfileKey: postmatch.competitionProfileKey(profile),
    publishedBeforeKickoff: true,
    comparable: true,
    resultScope: "90min",
    actualOutcome: "home",
    probabilities: { home: 0.5, draw: 0.3, away: 0.2 },
    actualResult: { homeGoals: 2, awayGoals: 1, decidedIn: "90min" },
    dataQuality: {
      predictionLineageVerified: true,
      resultEvidenceAccepted: true,
      uncontaminated: true
    },
    ...overrides
  };
}

test("同一运行或同一比赛重复三十次只能计为一个样本", () => {
  const proposal = postmatch.proposeCalibration(Array.from({ length: 30 }, () => calibrationRecord()));

  assert.equal(proposal.comparableSampleCount, 1);
  assert.equal(proposal.eligibility, "insufficient_sample");
  assert.ok(proposal.dataQualityExclusions.some((item) => /重复/.test(item.reason)));
});

test("预测哈希或赛后证据质量不合格的记录不能进入校准", () => {
  const records = Array.from({ length: 30 }, (_, index) => calibrationRecord({
    predictionRunId: `run-${index}`,
    predictionSha256: "bad-hash",
    matchId: `match-${index}`,
    dataQuality: { predictionLineageVerified: false, resultEvidenceAccepted: false, uncontaminated: false }
  }));
  const proposal = postmatch.proposeCalibration(records);

  assert.equal(proposal.comparableSampleCount, 0);
  assert.equal(proposal.eligibility, "insufficient_sample");
  assert.equal(proposal.dataQualityExclusions.length, 30);
});

test("加时或点球终场比分不得标成实际90分钟结果或计算方向命中", () => {
  const actualResult = {
    homeGoals: 2,
    awayGoals: 1,
    decidedIn: "extra_time",
    observedAt: "2026-08-01T17:30:00Z",
    sourceClaimId: "result-extra-time"
  };
  const report = buildPostmatchReport({
    manifest: { mode: "postmatch", parentRunId: "prematch-run-1", match },
    prediction: { homeWinProb: 0.5, drawProb: 0.3, awayWinProb: 0.2 },
    evidenceAudit: { accepted: [{
      claimId: "result-extra-time",
      topic: "result",
      subject: match.matchId,
      value: resultValue({ decidedIn: "extra_time", observedAt: "2026-08-01T17:30:00Z" })
    }] },
    postmatch: { actualResult }
  });

  assert.match(report.markdown, /实际90分钟结果 \| 未提供|实际90分钟结果 \| 不可用/);
  assert.match(report.markdown, /方向命中 \| 未提供|方向命中 \| 不可用/);
  assert.doesNotMatch(report.markdown, /实际90分钟结果 \| 主胜/);
});

test("来源显式给出90分钟比分时可独立审计而不混用加时终场比分", () => {
  const actualResult = {
    homeGoals: 2,
    awayGoals: 1,
    decidedIn: "extra_time",
    observedAt: "2026-08-01T17:30:00Z",
    ninetyMinuteResult: { homeGoals: 1, awayGoals: 1 },
    sourceClaimId: "result-with-90"
  };
  const report = buildPostmatchReport({
    manifest: { mode: "postmatch", parentRunId: "prematch-run-1", match },
    prediction: { homeWinProb: 0.5, drawProb: 0.3, awayWinProb: 0.2 },
    evidenceAudit: { accepted: [{
      claimId: "result-with-90",
      topic: "result",
      subject: match.matchId,
      value: {
        ...resultValue({ decidedIn: "extra_time", observedAt: "2026-08-01T17:30:00Z" }),
        ninetyMinuteResult: { homeGoals: 1, awayGoals: 1 }
      }
    }] },
    postmatch: { actualResult }
  });

  assert.match(report.markdown, /实际赛果：ARS 2–1 CHE（extra_time）/);
  assert.match(report.markdown, /实际90分钟结果 \| 平局/);
  assert.match(report.markdown, /方向命中 \| 否/);
});

test("generate-report 拒绝覆盖既有产物", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "football-report-no-overwrite-"));
  const fixture = fileURLToPath(new URL("../assets/sample-data/club-league-snapshot.json", import.meta.url));
  const script = fileURLToPath(new URL("../scripts/generate-report.mjs", import.meta.url));
  try {
    await execFileAsync(process.execPath, [script, "--fixture", fixture, "--out-dir", outputDirectory]);
    await assert.rejects(
      execFileAsync(process.execPath, [script, "--fixture", fixture, "--out-dir", outputDirectory]),
      /已存在|EEXIST|覆写/
    );
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("generate-report 的赛后输出必须显式消费 postmatch manifest", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "football-report-postmatch-manifest-"));
  const fixturePath = join(outputDirectory, "fixture.json");
  const fixture = JSON.parse(await readFile(new URL("../assets/sample-data/club-league-snapshot.json", import.meta.url), "utf8"));
  fixture.postmatch = { actualResult: resultValue() };
  const script = fileURLToPath(new URL("../scripts/generate-report.mjs", import.meta.url));
  await writeFile(fixturePath, JSON.stringify(fixture), "utf8");
  try {
    await assert.rejects(
      execFileAsync(process.execPath, [script, "--fixture", fixturePath, "--out-dir", outputDirectory]),
      /postmatch manifest|mode.*postmatch|赛后运行清单/
    );
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
