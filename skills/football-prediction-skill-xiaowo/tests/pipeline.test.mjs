import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { finalizeManifest, runPrematchPipeline, validatePublishedRun } from "../core/pipeline.mjs";

const execFileAsync = promisify(execFile);

const SHA256 = "a".repeat(64);

function completeManifest(overrides = {}) {
  return {
    artifacts: {
      inputSnapshot: { path: "audited-snapshot.json", sha256: SHA256 },
      prediction: { path: "prediction.json", sha256: SHA256 },
      reportMarkdown: { path: "report.md", sha256: SHA256 },
      reportHtml: { path: "report-long.html", sha256: SHA256 },
      reportPng: { path: "report-long.png", sha256: SHA256 },
      renderAudit: { path: "render-audit.json", sha256: SHA256, metadata: { passed: true } },
      ...overrides
    }
  };
}

test("发布运行必须同时拥有 Markdown、PNG 和干净的渲染审计", () => {
  const run = {
    artifacts: {
      reportMarkdown: { sha256: "a" },
      reportPng: { sha256: "b" },
      renderAudit: { horizontalOverflow: true }
    }
  };

  assert.equal(validatePublishedRun(run).ok, false);
});

test("发布验证拒绝缺失 Markdown 或 PNG 哈希", () => {
  const cleanAudit = { horizontalOverflow: false, replacementCharacterDetected: false, tableOverflow: [] };
  const invalidArtifacts = [
    { reportMarkdown: {}, reportPng: { sha256: "b" }, renderAudit: cleanAudit },
    { reportMarkdown: { sha256: "a" }, reportPng: {}, renderAudit: cleanAudit },
    { reportMarkdown: { sha256: "a" }, renderAudit: cleanAudit }
  ];

  for (const artifacts of invalidArtifacts) {
    assert.equal(validatePublishedRun({ artifacts }).ok, false);
  }
});

test("发布验证拒绝缺失或带坏文本和溢出的渲染审计", () => {
  const artifacts = {
    reportMarkdown: { sha256: "a" },
    reportPng: { sha256: "b" }
  };
  const invalidAudits = [
    undefined,
    { horizontalOverflow: false, tableOverflow: [{}], replacementCharacterDetected: false },
    { horizontalOverflow: false, tableOverflow: [], replacementCharacterDetected: true }
  ];

  for (const renderAudit of invalidAudits) {
    assert.equal(validatePublishedRun({ artifacts: { ...artifacts, renderAudit } }).ok, false);
  }
});

test("正式运行拒绝缺失长图哈希", () => {
  const manifest = {
    artifacts: {
      reportMarkdown: { path: "report.md", sha256: "abc" },
      reportPng: null
    }
  };

  assert.throws(() => finalizeManifest(manifest), /report-long\.png/);
});

test("正式运行拒绝缺失任一必需产物", () => {
  const manifest = completeManifest({ reportHtml: null });

  assert.throws(() => finalizeManifest(manifest), /report-long\.html/);
});

test("正式运行拒绝无效的产物 SHA-256", () => {
  const manifest = completeManifest({ prediction: { path: "prediction.json", sha256: "abc" } });

  assert.throws(() => finalizeManifest(manifest), /prediction\.json.*SHA-256/);
});

test("低置信度运行必须列出缺失项或冲突", () => {
  const manifest = completeManifest();
  manifest.evidenceAudit = { status: "degraded_low_confidence", missing: [], conflicts: [], rejected: [{}] };

  assert.throws(() => finalizeManifest(manifest), /missing.*conflicts/);
});

test("正式运行拒绝带错误的渲染审计", () => {
  const manifest = completeManifest({
    renderAudit: {
      path: "render-audit.json",
      sha256: SHA256,
      metadata: { passed: false, errors: ["存在水平溢出"] }
    }
  });

  assert.throws(() => finalizeManifest(manifest), /render-audit\.json.*未通过/);
});

test("完整正式运行清单定稿后带有定稿时间", () => {
  const finalized = finalizeManifest(completeManifest());

  assert.match(finalized.finalizedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("赛前流水线按固定顺序生成可哈希的完整运行目录", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "football-pipeline-"));
  const inputPath = fileURLToPath(new URL("../assets/sample-data/club-league-snapshot.json", import.meta.url));
  try {
    const result = await runPrematchPipeline({ input: inputPath, outDir: outputRoot });
    const manifest = JSON.parse(await readFile(join(result.runDirectory, "run-manifest.json"), "utf8"));
    const required = ["inputSnapshot", "prediction", "reportMarkdown", "reportHtml", "reportPng", "renderAudit"];

    assert.equal(manifest.finalizedAt !== null, true);
    for (const name of required) {
      const artifact = manifest.artifacts[name];
      const contents = await readFile(join(result.runDirectory, artifact.path));
      assert.equal(createHash("sha256").update(contents).digest("hex"), artifact.sha256);
    }
    assert.equal(manifest.artifacts.renderAudit.metadata.passed, true);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("流水线 CLI 从 input 和 out-dir 生成正式运行", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "football-pipeline-cli-"));
  const inputPath = fileURLToPath(new URL("../assets/sample-data/club-league-snapshot.json", import.meta.url));
  const scriptPath = fileURLToPath(new URL("../scripts/run-pipeline.mjs", import.meta.url));
  try {
    const { stdout } = await execFileAsync(process.execPath, [scriptPath, "--input", inputPath, "--out-dir", outputRoot]);
    assert.match(stdout, /run-manifest\.json/);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("同一 runId 的旧预测绝不覆写", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "football-pipeline-immutable-"));
  const fixture = JSON.parse(await readFile(new URL("../assets/sample-data/club-league-snapshot.json", import.meta.url), "utf8"));
  fixture.manifest.runId = "immutable-run";
  const runDirectory = join(outputRoot, fixture.manifest.runId);
  const predictionPath = join(runDirectory, "prediction.json");
  await mkdir(runDirectory);
  await writeFile(predictionPath, "old-prediction", "utf8");
  try {
    await assert.rejects(runPrematchPipeline({ input: fixture, outDir: outputRoot }), /拒绝覆写旧预测/);
    assert.equal(await readFile(predictionPath, "utf8"), "old-prediction");
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("Task5 审计夹具在无独立账本时仍重新审计并绑定接受事实", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "football-pipeline-task5-"));
  const fixture = JSON.parse(await readFile(new URL("../assets/sample-data/club-league-snapshot.json", import.meta.url), "utf8"));
  fixture.manifest.dataCutoffAt = "2026-08-01T10:00:00Z";
  fixture.evidenceAudit.accepted = [{
    claimId: "injury-task5-1",
    topic: "injury",
    subject: "ARS-player-9",
    sourceTier: "club_official",
    sourceUrl: "https://example.invalid/ars/injury",
    publishedAt: "2026-08-01T08:00:00Z",
    observedAt: "2026-08-01T09:00:00Z",
    affectsModel: true,
    reviewStatus: "accepted",
    value: "缺席",
    deterministicAdjustment: { homeLambdaDelta: -0.1, awayLambdaDelta: 0 }
  }];
  try {
    const result = await runPrematchPipeline({ input: fixture, outDir: outputRoot });
    const snapshot = JSON.parse(await readFile(result.paths.inputSnapshot, "utf8"));
    const prediction = JSON.parse(await readFile(result.paths.prediction, "utf8"));

    assert.deepEqual(snapshot.evidenceAudit.accepted.map((claim) => claim.claimId), ["injury-task5-1"]);
    assert.deepEqual(prediction.adjustments.map((adjustment) => adjustment.claimId), ["injury-task5-1"]);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("显式非法 ledger 不得回退到旧 Task5 审计", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "football-pipeline-invalid-ledger-"));
  const fixture = JSON.parse(await readFile(new URL("../assets/sample-data/club-league-snapshot.json", import.meta.url), "utf8"));
  fixture.manifest.dataCutoffAt = "2026-08-01T10:00:00Z";
  fixture.evidenceLedger = { ledger: "不是数组" };
  fixture.evidenceAudit.accepted = [{
    claimId: "legacy-injury-1",
    topic: "injury",
    subject: "ARS-player-9",
    sourceTier: "club_official",
    sourceUrl: "https://example.invalid/ars/injury",
    publishedAt: "2026-08-01T08:00:00Z",
    observedAt: "2026-08-01T09:00:00Z",
    affectsModel: true,
    reviewStatus: "accepted",
    value: "缺席"
  }];
  try {
    await assert.rejects(
      runPrematchPipeline({ input: fixture, outDir: outputRoot }),
      /显式证据账本结构无效/
    );
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});
