import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { competitionProfileKey, proposeCalibration, recordPostmatch } from "../core/postmatch.mjs";

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
    mode: "prematch",
    competitionProfile: {
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
    },
    artifacts: { prediction: { path: "prediction.json", sha256: PREDICTION_SHA256, byteLength: 1 } }
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
    dataCutoffAt: "2026-08-01T18:00:00Z",
    actualResult,
    evidenceLedger: [{
      claimId: "result-claim-1",
      topic: "result",
      subject: "ARS-CHE-2026-08-01",
      sourceTier: "competition_official",
      sourceUrl: "https://official.test/result",
      publishedAt: "2026-08-01T17:00:00Z",
      observedAt: "2026-08-01T17:00:00Z",
      affectsModel: true,
      reviewStatus: "accepted",
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

function validCalibrationRecord(index, overrides = {}) {
  const competitionProfile = publishedManifest().competitionProfile;
  return {
    predictionRunId: `run-${index}`,
    predictionSha256: String((index % 9) + 1).repeat(64),
    competitionProfile,
    competitionProfileKey: competitionProfileKey(competitionProfile),
    matchId: `match-${index}`,
    publishedBeforeKickoff: true,
    comparable: true,
    resultScope: "90min",
    actualOutcome: "home",
    probabilities: { home: 0.4, draw: 0.3, away: 0.3 },
    actualResult: { homeGoals: 2, awayGoals: 1, decidedIn: "90min" },
    dataQuality: {
      predictionLineageVerified: true,
      resultEvidenceAccepted: true,
      uncontaminated: true
    },
    ...overrides
  };
}

test("少于三十场可比较样本时不提出调参", () => {
  const records = Array.from({ length: 29 }, (_, index) => validCalibrationRecord(index));

  const proposal = proposeCalibration(records);

  assert.equal(proposal.eligibility, "insufficient_sample");
  assert.deepEqual(proposal.proposedChanges, []);
  assert.equal(proposal.applyAutomatically, false);
});

test("无效概率记录不能凑足三十场门槛", () => {
  const records = Array.from({ length: 30 }, (_, index) => validCalibrationRecord(index, {
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
  const valid = Array.from({ length: 30 }, (_, index) => validCalibrationRecord(index, {
    probabilities: { home: 0.5, draw: 0.3, away: 0.2 }
  }));
  const excluded = [
    { ...validCalibrationRecord(30), competitionProfileKey: "profile-v1:other" },
    { ...validCalibrationRecord(31), publishedBeforeKickoff: false },
    { ...validCalibrationRecord(32), comparable: false }
  ];

  const proposal = proposeCalibration([...valid, ...excluded]);

  assert.equal(proposal.competitionProfileKey, competitionProfileKey(publishedManifest().competitionProfile));
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
  assert.equal(record.competitionProfileKey, competitionProfileKey(manifest.competitionProfile));
  assert.equal(record.actualOutcome, "home");
  assert.deepEqual(record.probabilities, { home: 0.5, draw: 0.3, away: 0.2 });
  assert.equal(record.actualResult.sourceClaimId, "result-claim-1");
  assert.equal(record.publishedBeforeKickoff, true);
  assert.equal(record.comparable, true);
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

test("赛后记录要求 facts 显式提供运行 ID 和预测 SHA-256", () => {
  for (const missingField of ["predictionRunId", "predictionSha256"]) {
    const facts = confirmedFacts();
    delete facts[missingField];
    assert.throws(
      () => recordPostmatch({
        manifest: publishedManifest(),
        prediction: prediction(),
        facts
      }),
      new RegExp(`facts\\.${missingField}`)
    );
  }
});

test("赛后记录拒绝未定稿或 finalizedAt 非法的 manifest", () => {
  for (const finalizedAt of [null, "", "not-an-iso-time"]) {
    const manifest = publishedManifest();
    manifest.finalizedAt = finalizedAt;
    assert.throws(
      () => recordPostmatch({ manifest, prediction: prediction(), facts: confirmedFacts() }),
      /manifest\.finalizedAt/
    );
  }
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

test("缺失、加时或点球口径的赛果不得进入 90 分钟校准", () => {
  for (const decidedIn of [undefined, "extra_time", "penalties"]) {
    const facts = confirmedFacts();
    if (decidedIn === undefined) {
      delete facts.actualResult.decidedIn;
      delete facts.evidenceLedger[0].value.decidedIn;
    } else {
      facts.actualResult.decidedIn = decidedIn;
      facts.evidenceLedger[0].value.decidedIn = decidedIn;
    }

    const record = recordPostmatch({
      manifest: publishedManifest(),
      prediction: prediction(),
      facts
    });

    assert.equal(record.comparable, false);
    assert.equal(record.actualResult.decidedIn, decidedIn ?? null);
  }
});

test("预测自身缺少 90 分钟口径时赛后记录不可比较", () => {
  const prematchPrediction = prediction();
  delete prematchPrediction.resultScope;

  const record = recordPostmatch({
    manifest: publishedManifest(),
    prediction: prematchPrediction,
    facts: confirmedFacts()
  });

  assert.equal(record.comparable, false);
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
      facts: confirmedFacts({ evidenceLedger: [] })
    }),
    /accepted.*sourceClaimId/
  );
});

test("赛后记录拒绝主题、比赛身份或规范化赛果不匹配的 claim", () => {
  const validClaim = confirmedFacts().evidenceLedger[0];
  for (const claim of [
    { ...validClaim, topic: "statistics" },
    { ...validClaim, matchId: "OTHER-MATCH" },
    { ...validClaim, value: { ...validClaim.value, homeGoals: 3 } }
  ]) {
    assert.throws(
      () => recordPostmatch({
        manifest: publishedManifest(),
        prediction: prediction(),
        facts: confirmedFacts({ evidenceLedger: [claim] })
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
  const predictionBytes = `${JSON.stringify(prediction(), null, 2)}\n`;
  const predictionSha256 = createHash("sha256").update(predictionBytes).digest("hex");
  const manifest = publishedManifest();
  manifest.artifacts.prediction.sha256 = predictionSha256;
  await Promise.all([
    writeFile(manifestPath, JSON.stringify(manifest), "utf8"),
    writeFile(predictionPath, predictionBytes, "utf8"),
    writeFile(factsPath, JSON.stringify(confirmedFacts({ predictionSha256 })), "utf8")
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
    assert.equal(record.predictionSha256, predictionSha256);
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

test("record-result CLI 拒绝内容改写但沿用旧哈希的 prediction 文件", async () => {
  const directory = await mkdtemp(join(tmpdir(), "football-postmatch-tampered-"));
  const manifestPath = join(directory, "manifest.json");
  const predictionPath = join(directory, "prediction.json");
  const factsPath = join(directory, "facts.json");
  const outputPath = join(directory, "record.json");
  const scriptPath = fileURLToPath(new URL("../scripts/record-result.mjs", import.meta.url));
  const originalBytes = `${JSON.stringify(prediction(), null, 2)}\n`;
  const originalSha256 = createHash("sha256").update(originalBytes).digest("hex");
  const manifest = publishedManifest();
  manifest.artifacts.prediction.sha256 = originalSha256;
  const tamperedPrediction = prediction();
  tamperedPrediction.probabilities = { homeWinProb: 0.99, drawProb: 0.005, awayWinProb: 0.005 };

  await Promise.all([
    writeFile(manifestPath, JSON.stringify(manifest), "utf8"),
    writeFile(predictionPath, JSON.stringify(tamperedPrediction), "utf8"),
    writeFile(factsPath, JSON.stringify(confirmedFacts({ predictionSha256: originalSha256 })), "utf8")
  ]);

  try {
    await assert.rejects(execFileAsync(process.execPath, [
      scriptPath,
      "--manifest", manifestPath,
      "--prediction", predictionPath,
      "--facts", factsPath,
      "--out", outputPath
    ]), /SHA-256/);
    await assert.rejects(readFile(outputPath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("propose-calibration CLI 拒绝可编辑 records 聚合文件", async () => {
  const directory = await mkdtemp(join(tmpdir(), "football-calibration-proposal-"));
  const recordsPath = join(directory, "records.json");
  const outputPath = join(directory, "proposal.json");
  const scriptPath = fileURLToPath(new URL("../scripts/propose-calibration.mjs", import.meta.url));
  const records = Array.from({ length: 29 }, (_, index) => validCalibrationRecord(index, {
    actualOutcome: "draw",
    actualResult: { homeGoals: 1, awayGoals: 1, decidedIn: "90min" }
  }));
  await writeFile(recordsPath, JSON.stringify(records), "utf8");

  try {
    await assert.rejects(
      execFileAsync(process.execPath, [scriptPath, "--records", recordsPath, "--out", outputPath]),
      (error) => error.code === 1 && /run|运行目录|不可变/.test(error.stderr)
    );
    await assert.rejects(readFile(outputPath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
