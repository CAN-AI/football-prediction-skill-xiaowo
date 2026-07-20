import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { proposeCalibration, recordPostmatch } from "../core/postmatch.mjs";

const PREDICTION_SHA256 = "a".repeat(64);
const execFileAsync = promisify(execFile);

function publishedManifest() {
  return {
    runId: "prematch-run-1",
    createdAt: "2026-08-01T10:00:00Z",
    finalizedAt: "2026-08-01T10:05:00Z",
    match: {
      matchId: "ARS-CHE-2026-08-01",
      homeTeamId: "ARS",
      awayTeamId: "CHE",
      kickoffAt: "2026-08-01T15:00:00Z"
    },
    competitionProfile: { family: "league", competitionId: "ENG-PL" },
    artifacts: { prediction: { path: "prediction.json", sha256: PREDICTION_SHA256 } }
  };
}

function prediction() {
  return {
    modelVersion: "football-xiaowo-v3.0.0-90min",
    resultScope: "90min",
    probabilities: { homeWinProb: 0.5, drawProb: 0.3, awayWinProb: 0.2 }
  };
}

function confirmedFacts(overrides = {}) {
  const actualResult = {
    homeGoals: 2,
    awayGoals: 1,
    decidedIn: "90min",
    observedAt: "2026-08-01T17:00:00Z",
    sourceClaimId: "result-claim-1"
  };
  return {
    predictionRunId: "prematch-run-1",
    predictionSha256: PREDICTION_SHA256,
    actualResult,
    acceptedClaims: [{
      claimId: "result-claim-1",
      topic: "result",
      matchId: "ARS-CHE-2026-08-01",
      value: {
        homeGoals: actualResult.homeGoals,
        awayGoals: actualResult.awayGoals,
        decidedIn: actualResult.decidedIn,
        observedAt: actualResult.observedAt
      }
    }],
    ...overrides
  };
}

test("少于三十场可比较样本时不提出调参", () => {
  const records = Array.from({ length: 29 }, (_, index) => ({
    predictionRunId: `run-${index}`,
    competitionProfileKey: "league:ENG-PL",
    publishedBeforeKickoff: true,
    comparable: true,
    actualOutcome: "home",
    probabilities: { home: 0.4, draw: 0.3, away: 0.3 }
  }));

  const proposal = proposeCalibration(records);

  assert.equal(proposal.eligibility, "insufficient_sample");
  assert.deepEqual(proposal.proposedChanges, []);
  assert.equal(proposal.applyAutomatically, false);
});

test("无效概率记录不能凑足三十场门槛", () => {
  const records = Array.from({ length: 30 }, (_, index) => ({
    predictionRunId: `run-${index}`,
    competitionProfileKey: "league:ENG-PL",
    publishedBeforeKickoff: true,
    comparable: true,
    actualOutcome: "home",
    probabilities: index === 29
      ? { home: 1.2, draw: -0.1, away: -0.1 }
      : { home: 0.4, draw: 0.3, away: 0.3 }
  }));

  const proposal = proposeCalibration(records);

  assert.equal(proposal.comparableSampleCount, 29);
  assert.equal(proposal.eligibility, "insufficient_sample");
  assert.deepEqual(proposal.proposedChanges, []);
});

test("达到门槛后只对同赛事画像计算指标并等待人工批准", () => {
  const valid = Array.from({ length: 30 }, (_, index) => ({
    predictionRunId: `run-${index}`,
    competitionProfileKey: "league:ENG-PL",
    publishedBeforeKickoff: true,
    comparable: true,
    actualOutcome: "home",
    probabilities: { home: 0.5, draw: 0.3, away: 0.2 }
  }));
  const excluded = [
    { ...valid[0], competitionProfileKey: "league:ESP-LL" },
    { ...valid[1], publishedBeforeKickoff: false },
    { ...valid[2], comparable: false }
  ];

  const proposal = proposeCalibration([...valid, ...excluded]);

  assert.equal(proposal.competitionProfileKey, "league:ENG-PL");
  assert.equal(proposal.comparableSampleCount, 30);
  assert.equal(proposal.eligibility, "eligible_for_human_review");
  assert.ok(Math.abs(proposal.metrics.brierScore - 0.38) < 1e-12);
  assert.equal(proposal.metrics.directionHitRate, 1);
  assert.equal(proposal.requiresHumanApproval, true);
  assert.equal(proposal.applyAutomatically, false);
  assert.equal(typeof proposal.proposedChanges[0], "string");
});

test("赛后记录绑定已发布运行、预测哈希和有来源的赛果", () => {
  const manifest = publishedManifest();
  const prematchPrediction = prediction();
  const facts = confirmedFacts();
  const before = structuredClone(prematchPrediction);

  const record = recordPostmatch({ manifest, prediction: prematchPrediction, facts });

  assert.equal(record.predictionRunId, manifest.runId);
  assert.equal(record.predictionSha256, manifest.artifacts.prediction.sha256);
  assert.equal(record.competitionProfileKey, "league:ENG-PL");
  assert.equal(record.actualOutcome, "home");
  assert.deepEqual(record.probabilities, { home: 0.5, draw: 0.3, away: 0.2 });
  assert.equal(record.actualResult.sourceClaimId, "result-claim-1");
  assert.equal(record.publishedBeforeKickoff, true);
  assert.deepEqual(prematchPrediction, before);
});

test("赛后记录拒绝不匹配的赛前运行 ID", () => {
  assert.throws(
    () => recordPostmatch({
      manifest: publishedManifest(),
      prediction: prediction(),
      facts: confirmedFacts({ predictionRunId: "other-run" })
    }),
    /predictionRunId.*manifest/
  );
});

test("赛后记录拒绝不匹配的预测 SHA-256", () => {
  assert.throws(
    () => recordPostmatch({
      manifest: publishedManifest(),
      prediction: prediction(),
      facts: confirmedFacts({ predictionSha256: "b".repeat(64) })
    }),
    /SHA-256.*manifest/
  );
});

test("赛后记录拒绝开球前观察到的赛果", () => {
  assert.throws(
    () => recordPostmatch({
      manifest: publishedManifest(),
      prediction: prediction(),
      facts: confirmedFacts({
        actualResult: {
          ...confirmedFacts().actualResult,
          observedAt: "2026-08-01T14:59:59Z"
        }
      })
    }),
    /observedAt.*kickoffAt/
  );
});

test("赛后记录拒绝没有来源标识的赛果", () => {
  const actualResult = { ...confirmedFacts().actualResult };
  delete actualResult.sourceClaimId;

  assert.throws(
    () => recordPostmatch({
      manifest: publishedManifest(),
      prediction: prediction(),
      facts: confirmedFacts({ actualResult })
    }),
    /sourceClaimId/
  );
});

test("赛后记录拒绝只给裸 sourceClaimId 而没有 accepted claim", () => {
  assert.throws(
    () => recordPostmatch({
      manifest: publishedManifest(),
      prediction: prediction(),
      facts: confirmedFacts({ acceptedClaims: [] })
    }),
    /accepted.*sourceClaimId/
  );
});

test("赛后记录拒绝主题、比赛身份或规范化赛果不匹配的 claim", () => {
  const validClaim = confirmedFacts().acceptedClaims[0];
  for (const claim of [
    { ...validClaim, topic: "statistics" },
    { ...validClaim, matchId: "OTHER-MATCH" },
    { ...validClaim, value: { ...validClaim.value, homeGoals: 3 } }
  ]) {
    assert.throws(
      () => recordPostmatch({
        manifest: publishedManifest(),
        prediction: prediction(),
        facts: confirmedFacts({ evidenceAudit: { accepted: [claim] }, acceptedClaims: undefined })
      }),
      /accepted.*sourceClaimId/
    );
  }
});

test("record-result CLI 写出绑定后的赛后记录且拒绝覆盖", async () => {
  const directory = await mkdtemp(join(tmpdir(), "football-postmatch-record-"));
  const manifestPath = join(directory, "manifest.json");
  const predictionPath = join(directory, "prediction.json");
  const factsPath = join(directory, "facts.json");
  const outputPath = join(directory, "record.json");
  const scriptPath = fileURLToPath(new URL("../scripts/record-result.mjs", import.meta.url));
  await Promise.all([
    writeFile(manifestPath, JSON.stringify(publishedManifest()), "utf8"),
    writeFile(predictionPath, JSON.stringify(prediction()), "utf8"),
    writeFile(factsPath, JSON.stringify(confirmedFacts()), "utf8")
  ]);

  try {
    await execFileAsync(process.execPath, [
      scriptPath,
      "--manifest", manifestPath,
      "--prediction", predictionPath,
      "--facts", factsPath,
      "--out", outputPath
    ]);
    const record = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(record.predictionRunId, "prematch-run-1");
    assert.equal(record.predictionSha256, PREDICTION_SHA256);
    await assert.rejects(execFileAsync(process.execPath, [
      scriptPath,
      "--manifest", manifestPath,
      "--prediction", predictionPath,
      "--facts", factsPath,
      "--out", outputPath
    ]));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("propose-calibration CLI 写出不可自动应用的提案", async () => {
  const directory = await mkdtemp(join(tmpdir(), "football-calibration-proposal-"));
  const recordsPath = join(directory, "records.json");
  const outputPath = join(directory, "proposal.json");
  const scriptPath = fileURLToPath(new URL("../scripts/propose-calibration.mjs", import.meta.url));
  const records = Array.from({ length: 29 }, (_, index) => ({
    predictionRunId: `run-${index}`,
    competitionProfileKey: "league:ENG-PL",
    publishedBeforeKickoff: true,
    comparable: true,
    actualOutcome: "draw",
    probabilities: { home: 0.4, draw: 0.3, away: 0.3 }
  }));
  await writeFile(recordsPath, JSON.stringify(records), "utf8");

  try {
    await execFileAsync(process.execPath, [scriptPath, "--records", recordsPath, "--out", outputPath]);
    const proposal = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(proposal.comparableSampleCount, 29);
    assert.equal(proposal.eligibility, "insufficient_sample");
    assert.equal(proposal.applyAutomatically, false);
    assert.deepEqual(proposal.proposedChanges, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
