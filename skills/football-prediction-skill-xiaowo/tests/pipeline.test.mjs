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
const CLEAN_RENDER_METADATA = Object.freeze({
  passed: true,
  errors: [],
  horizontalOverflow: false,
  tableOverflow: [],
  replacementCharacterDetected: false,
  pageHeightValid: true
});

function completeManifest(overrides = {}) {
  const artifact = (path) => ({ path, sha256: SHA256, byteLength: 1 });
  return {
    artifacts: {
      evidenceLedger: artifact("evidence-ledger.json"),
      audit: { ...artifact("audit.json"), metadata: { evidenceAudit: { status: "passed", missing: [], conflicts: [] } } },
      inputSnapshot: artifact("input-snapshot.json"),
      prediction: artifact("prediction.json"),
      reportMarkdown: artifact("report.md"),
      reportHtml: artifact("report-long.html"),
      reportPng: artifact("report-long.png"),
      renderAudit: { ...artifact("render-audit.json"), metadata: CLEAN_RENDER_METADATA },
      ...overrides
    }
  };
}

test("发布验证要求八个产物使用固定相对文件名", () => {
  const invalidPaths = [
    ["reportMarkdown", "C:\\outside\\report.md"],
    ["reportPng", "..\\outside.png"],
    ["renderAudit", "report.md"],
    ["inputSnapshot", "audited-snapshot.json"]
  ];

  for (const [artifactName, path] of invalidPaths) {
    const manifest = completeManifest();
    manifest.artifacts[artifactName] = { ...manifest.artifacts[artifactName], path };
    assert.equal(validatePublishedRun(manifest).ok, false);
    assert.throws(() => finalizeManifest(manifest), /path/);
  }
});

test("发布验证要求八个产物各自带有效 SHA-256 和字节数", () => {
  for (const artifactName of Object.keys(completeManifest().artifacts)) {
    const manifest = completeManifest();
    manifest.artifacts[artifactName] = { ...manifest.artifacts[artifactName], sha256: "short" };
    assert.equal(validatePublishedRun(manifest).ok, false);
    assert.throws(() => finalizeManifest(manifest), /SHA-256/);
  }
});

test("发布验证接受路径、哈希和审计 metadata 完整的真实清单", () => {
  assert.deepEqual(validatePublishedRun(completeManifest()), { ok: true, errors: [] });
});

test("发布运行必须同时拥有 Markdown、PNG 和干净的渲染审计", () => {
  const run = completeManifest({
    renderAudit: {
      path: "render-audit.json",
      sha256: SHA256,
      byteLength: 1,
      metadata: { ...CLEAN_RENDER_METADATA, horizontalOverflow: true }
    }
  });

  assert.equal(validatePublishedRun(run).ok, false);
});

test("发布验证拒绝缺失 Markdown 或 PNG 记录", () => {
  const invalidManifests = [
    completeManifest({ reportMarkdown: null }),
    completeManifest({ reportPng: null })
  ];

  for (const manifest of invalidManifests) {
    assert.equal(validatePublishedRun(manifest).ok, false);
  }
});

test("发布验证拒绝缺失或未通过的 renderAudit metadata", () => {
  const invalidMetadata = [
    undefined,
    { ...CLEAN_RENDER_METADATA, passed: false }
  ];

  for (const metadata of invalidMetadata) {
    const renderAudit = { path: "render-audit.json", sha256: SHA256, byteLength: 1, ...(metadata ? { metadata } : {}) };
    assert.equal(validatePublishedRun(completeManifest({ renderAudit })).ok, false);
  }
});

test("发布验证拒绝 metadata 中缺失或不洁的渲染标志", () => {
  const invalidMetadata = [
    { passed: true },
    { ...CLEAN_RENDER_METADATA, horizontalOverflow: true },
    { ...CLEAN_RENDER_METADATA, tableOverflow: [{}] },
    { ...CLEAN_RENDER_METADATA, replacementCharacterDetected: true },
    { ...CLEAN_RENDER_METADATA, pageHeightValid: false }
  ];

  for (const metadata of invalidMetadata) {
    const renderAudit = { path: "render-audit.json", sha256: SHA256, byteLength: 1, metadata };
    assert.equal(validatePublishedRun(completeManifest({ renderAudit })).ok, false);
  }
});

test("发布验证要求 renderAudit metadata.errors 是空数组", () => {
  for (const errors of [undefined, "render failed", ["render failed"]]) {
    const metadata = { ...CLEAN_RENDER_METADATA, errors };
    if (errors === undefined) delete metadata.errors;
    const manifest = completeManifest({
      renderAudit: { path: "render-audit.json", sha256: SHA256, byteLength: 1, metadata }
    });

    assert.equal(validatePublishedRun(manifest).ok, false);
    assert.throws(() => finalizeManifest(manifest), /errors/);
  }
});

test("正式运行拒绝缺失长图哈希", () => {
  const manifest = completeManifest({ reportPng: null });

  assert.throws(() => finalizeManifest(manifest), /report-long\.png/);
});

test("正式运行拒绝缺失任一必需产物", () => {
  const manifest = completeManifest({ reportHtml: null });

  assert.throws(() => finalizeManifest(manifest), /report-long\.html/);
});

test("正式运行拒绝无效的产物 SHA-256", () => {
  const manifest = completeManifest({ prediction: { path: "prediction.json", sha256: "abc", byteLength: 1 } });

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
      byteLength: 1,
      metadata: { passed: false, errors: ["存在水平溢出"] }
    }
  });

  assert.throws(() => finalizeManifest(manifest), /render-audit\.json.*未通过/);
});

test("实际定稿路径调用发布验证并拒绝不洁 renderAudit metadata", () => {
  const manifest = completeManifest({
    renderAudit: {
      path: "render-audit.json",
      sha256: SHA256,
      byteLength: 1,
      metadata: { ...CLEAN_RENDER_METADATA, horizontalOverflow: true }
    }
  });

  assert.throws(() => finalizeManifest(manifest), /发布校验失败.*水平溢出/);
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
    const required = ["evidenceLedger", "audit", "inputSnapshot", "prediction", "reportMarkdown", "reportHtml", "reportPng", "renderAudit"];

    assert.equal(manifest.finalizedAt !== null, true);
    for (const name of required) {
      const artifact = manifest.artifacts[name];
      const contents = await readFile(join(result.runDirectory, artifact.path));
      assert.equal(createHash("sha256").update(contents).digest("hex"), artifact.sha256);
      assert.equal(contents.byteLength, artifact.byteLength);
    }
    assert.deepEqual(manifest.artifacts.renderAudit.metadata, CLEAN_RENDER_METADATA);
    assert.deepEqual(validatePublishedRun(manifest), { ok: true, errors: [] });
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

test("无独立账本的旧 Task5 夹具可读取但不得作为正式流水线发布", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "football-pipeline-task5-"));
  const fixture = JSON.parse(await readFile(new URL("../assets/sample-data/club-league-snapshot.json", import.meta.url), "utf8"));
  fixture.manifest.dataCutoffAt = "2026-08-01T10:00:00Z";
  delete fixture.evidenceLedger;
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
    await assert.rejects(
      runPrematchPipeline({ input: fixture, outDir: outputRoot }),
      /显式 evidenceLedger/
    );
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

test("只有候选首发被拒绝时正式流水线发布带明确缺失项的低置信运行", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "football-pipeline-candidate-lineup-"));
  const fixture = JSON.parse(await readFile(new URL("../assets/sample-data/club-league-snapshot.json", import.meta.url), "utf8"));
  fixture.manifest.runId = "candidate-lineup-run";
  fixture.evidenceLedger.push({
    claimId: "ars-candidate-lineup",
    topic: "lineup",
    subject: "ARS",
    sourceTier: "club_official",
    sourceUrl: "https://example.invalid/ars/candidate-lineup",
    publishedAt: "2026-08-01T09:30:00Z",
    observedAt: "2026-08-01T09:31:00Z",
    validUntil: "2026-08-01T15:00:00Z",
    affectsModel: true,
    reviewStatus: "accepted",
    lineupStatus: "candidate",
    value: ["ARS-1", "ARS-2"]
  });

  try {
    const result = await runPrematchPipeline({ input: fixture, outDir: outputRoot });
    const audit = JSON.parse(await readFile(result.paths.audit, "utf8"));
    const manifest = JSON.parse(await readFile(result.paths.manifest, "utf8"));

    assert.equal(audit.status, "degraded_low_confidence");
    assert.ok(audit.missing.includes("lineup.ARS.confirmed"));
    assert.equal(manifest.artifacts.audit.metadata.evidenceAudit.status, "degraded_low_confidence");
    assert.deepEqual(validatePublishedRun(manifest), { ok: true, errors: [] });
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});
