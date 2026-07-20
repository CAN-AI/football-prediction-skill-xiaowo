import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { auditEvidenceLedger } from "./evidence.mjs";
import { MODEL_VERSION, predict90 } from "./model.mjs";
import { renderLongPng } from "./render.mjs";
import { buildPostmatchReport, buildPrematchReport } from "./report.mjs";
import { recordPostmatch } from "./postmatch.mjs";
import {
  appendArtifact,
  assertMatchOrientation,
  createRunManifest,
  finalizeRunManifest,
  validateCompetitionProfile
} from "./schema.mjs";
import { contentHash } from "./utils.mjs";

const REQUIRED_ARTIFACTS = Object.freeze([
  ["evidenceLedger", "evidence-ledger.json"],
  ["audit", "audit.json"],
  ["reportPng", "report-long.png"],
  ["reportMarkdown", "report.md"],
  ["reportHtml", "report-long.html"],
  ["renderAudit", "render-audit.json"],
  ["inputSnapshot", "input-snapshot.json"],
  ["prediction", "prediction.json"]
]);
const POSTMATCH_ARTIFACTS = Object.freeze([...REQUIRED_ARTIFACTS, ["record", "record.json"]]);

function requiredArtifactsFor(run) {
  return run?.mode === "postmatch" ? POSTMATCH_ARTIFACTS : REQUIRED_ARTIFACTS;
}

async function loadInput(input) {
  if (typeof input === "string" || input instanceof URL) {
    return JSON.parse(await readFile(input, "utf8"));
  }
  if (!input || typeof input !== "object") throw new Error("流水线 input 必须是 JSON 路径或对象。");
  return structuredClone(input);
}

function evidenceLedgerFrom(input) {
  for (const field of ["evidenceLedger", "ledger"]) {
    if (!Object.hasOwn(input, field)) continue;
    const explicitLedger = input[field];
    if (Array.isArray(explicitLedger)) return explicitLedger;
    if (explicitLedger && typeof explicitLedger === "object" && Array.isArray(explicitLedger.ledger)) {
      return explicitLedger.ledger;
    }
    throw new Error(`显式证据账本结构无效：${field} 必须是数组或包含 ledger 数组的对象。`);
  }
  throw new Error("正式流水线必须提供显式 evidenceLedger/ledger，不能从旧 evidenceAudit 静默重建账本。");
}

function dataCutoffFrom(input) {
  return input.manifest?.dataCutoffAt
    ?? input.dataCutoffAt
    ?? input.cutoffAt
    ?? input.evidenceLedger?.cutoffAt;
}

function assertEvidenceAuditCompletable(evidenceAudit) {
  if (evidenceAudit.status === "failed") throw new Error("证据审计失败，赛前流水线不能继续。");
  if (evidenceAudit.status === "degraded_low_confidence"
    && !evidenceAudit.missing?.length
    && !evidenceAudit.conflicts?.length) {
    throw new Error("degraded_low_confidence 必须包含非空 missing 或 conflicts。");
  }
}

function renderAuditErrors(audit) {
  const errors = [];
  if (!audit.png?.present) errors.push("PNG 不存在或为空");
  if (audit.horizontalOverflow) errors.push("存在水平溢出");
  if (audit.tableOverflow?.length) errors.push(`存在 ${audit.tableOverflow.length} 个表格溢出`);
  if (audit.replacementCharacterDetected) errors.push("检测到替换字符");
  if (!audit.pageHeightValid) errors.push(`页面高度无效：${audit.documentHeight}`);
  return errors;
}

function assertAuditedModelBindings({ manifest, snapshot, evidenceAudit }) {
  const accepted = new Map(evidenceAudit.accepted.map((claim) => [claim.claimId, claim]));
  const profile = manifest.competitionProfile;
  const baseline = profile.baseline;
  const baselineClaims = baseline.evidenceClaimIds.map((claimId) => accepted.get(claimId));
  if (baselineClaims.some((claim) => !claim)) {
    throw new Error("赛事画像基线绑定的 evidenceClaimIds 必须全部通过本次证据审计。");
  }
  const expectedSubjects = new Set([profile.competitionId, `${profile.competitionId}:${profile.season}`]);
  const baselineBound = baselineClaims.some((claim) => (
    ["baseline", "statistics"].includes(claim.topic)
    && expectedSubjects.has(claim.subject)
    && claim.metricDefinitionVersion === profile.baselineVersion
    && Number(claim.value?.goalsPerTeam) === baseline.goalsPerTeam
    && claim.value?.homeAdvantage === profile.homeAdvantage
    && contentHash(claim.value?.sampleWindow) === contentHash(baseline.sampleWindow)
  ));
  if (!baselineBound) {
    throw new Error("赛事画像 baseline.goalsPerTeam/sampleWindow/baselineVersion/homeAdvantage 未与同赛事已审计证据严格绑定。");
  }

  for (const teamId of [manifest.match.homeTeamId, manifest.match.awayTeamId]) {
    const team = snapshot?.teams?.[teamId];
    const claim = accepted.get(team?.evidenceClaimId);
    const bound = claim
      && claim.topic === "statistics"
      && claim.subject === teamId
      && ["rating", "attack", "defense"].every((field) => Number(claim.value?.[field]) === team[field]);
    if (!bound) throw new Error(`球队 ${teamId} 的 rating/attack/defense 未与本次已审计证据绑定。`);
  }
}

export function validatePublishedRun(run) {
  const errors = [];
  if (run?.mode === "postmatch"
    && (typeof run.parentRunId !== "string" || !run.parentRunId || run.parentRunId === run.runId)) {
    errors.push("postmatch 运行必须绑定不同于自身的 parentRunId");
  }
  for (const [artifactName, fileName] of requiredArtifactsFor(run)) {
    const artifact = run?.artifacts?.[artifactName];
    if (!artifact
      || artifact.path !== fileName
      || !/^[a-f0-9]{64}$/i.test(artifact.sha256 ?? "")
      || !Number.isInteger(artifact.byteLength)
      || artifact.byteLength <= 0) {
      errors.push(`${fileName} 的固定相对 path、SHA-256 或 byteLength 字节数无效`);
    }
  }
  const metadata = run?.artifacts?.renderAudit?.metadata;
  if (!metadata || typeof metadata !== "object") {
    errors.push("render-audit.json 缺少 metadata");
  } else {
    if (metadata.passed !== true) errors.push("render-audit.json 未通过");
    if (!Array.isArray(metadata.errors) || metadata.errors.length) {
      errors.push("render-audit.json metadata.errors 必须是空数组");
    }
    if (metadata.horizontalOverflow !== false) errors.push("存在水平溢出或审计标志缺失");
    if (!Array.isArray(metadata.tableOverflow) || metadata.tableOverflow.length) {
      errors.push("存在表格溢出或审计标志缺失");
    }
    if (metadata.replacementCharacterDetected !== false) errors.push("检测到替换字符或审计标志缺失");
    if (metadata.pageHeightValid !== true) errors.push("页面高度审计未通过");
  }
  return { ok: errors.length === 0, errors };
}

async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseJsonArtifact(bytes, fileName) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${fileName} 不是有效 JSON。`, { cause: error });
  }
}

function assertFinalizedAt(manifest) {
  if (typeof manifest?.finalizedAt !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(manifest.finalizedAt)
    || !Number.isFinite(Date.parse(manifest.finalizedAt))) {
    throw new Error("正式运行的 finalizedAt 必须是有效的非空 ISO 时间。");
  }
}

function assertSnapshotManifestBinding(snapshotManifest, publishedManifest, label) {
  for (const field of ["runId", "skillVersion", "modelVersion", "createdAt", "dataCutoffAt", "mode", "parentRunId"]) {
    if (snapshotManifest?.[field] !== publishedManifest?.[field]) {
      throw new Error(`${label} input-snapshot.json 的 manifest.${field} 与外层定稿清单不匹配。`);
    }
  }
  for (const field of ["match", "competitionProfile"]) {
    if (!snapshotManifest?.[field]
      || contentHash(snapshotManifest[field]) !== contentHash(publishedManifest?.[field])) {
      throw new Error(`${label} input-snapshot.json 的 manifest.${field} 与外层定稿清单不匹配。`);
    }
  }
}

export async function loadPublishedRun(runDir, { expectedMode } = {}) {
  if (typeof runDir !== "string" || !runDir.trim()) throw new Error("正式运行目录不能为空。");
  const runDirectory = resolve(runDir);
  const manifest = parseJsonArtifact(await readFile(join(runDirectory, "run-manifest.json")), "run-manifest.json");
  if (!["prematch", "postmatch"].includes(manifest.mode)) {
    throw new Error("正式运行模式必须是 prematch 或 postmatch。");
  }
  const profileValidation = validateCompetitionProfile(manifest.competitionProfile);
  if (!profileValidation.ok) {
    throw new Error(`正式运行赛事画像无效：${profileValidation.errors.join("；")}`);
  }
  assertMatchOrientation(manifest.match);
  if (expectedMode && manifest.mode !== expectedMode) {
    throw new Error(`正式运行模式必须是 ${expectedMode}。`);
  }
  if (basename(runDirectory) !== manifest.runId) {
    throw new Error("运行目录名必须与 manifest.runId 完全一致。");
  }
  assertFinalizedAt(manifest);
  const publication = validatePublishedRun(manifest);
  if (!publication.ok) throw new Error(`正式运行发布校验失败：${publication.errors.join("；")}`);

  const artifactBytes = {};
  for (const [artifactName, fileName] of requiredArtifactsFor(manifest)) {
    const bytes = await readFile(join(runDirectory, fileName));
    const artifact = manifest.artifacts[artifactName];
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== artifact.byteLength || actualSha256 !== artifact.sha256) {
      throw new Error(`${fileName} 的字节数或 SHA-256 与 manifest 不匹配。`);
    }
    artifactBytes[artifactName] = bytes;
  }

  const evidenceEnvelope = parseJsonArtifact(artifactBytes.evidenceLedger, "evidence-ledger.json");
  const ledger = Array.isArray(evidenceEnvelope) ? evidenceEnvelope : evidenceEnvelope?.ledger;
  if (!Array.isArray(ledger)
    || contentHash(evidenceEnvelope?.match ?? manifest.match) !== contentHash(manifest.match)
    || (evidenceEnvelope?.cutoffAt ?? manifest.dataCutoffAt) !== manifest.dataCutoffAt) {
    throw new Error("evidence-ledger.json 与运行清单的比赛、截止时间或账本结构不匹配。");
  }
  const storedAudit = parseJsonArtifact(artifactBytes.audit, "audit.json");
  const recalculatedAudit = auditEvidenceLedger({ ledger, match: manifest.match, cutoffAt: manifest.dataCutoffAt });
  assertEvidenceAuditCompletable(recalculatedAudit);
  if (contentHash(storedAudit) !== contentHash(recalculatedAudit)) {
    throw new Error("audit.json 与原始 evidence-ledger.json 的重新审计结果不匹配。");
  }
  const auditSummary = manifest.artifacts.audit.metadata?.evidenceAudit;
  if (!auditSummary || typeof auditSummary !== "object" || contentHash(auditSummary) !== contentHash({
    status: recalculatedAudit.status,
    missing: recalculatedAudit.missing,
    conflicts: recalculatedAudit.conflicts
  })) {
    throw new Error("manifest 中的证据审计摘要与 audit.json 不匹配。");
  }

  return { manifest, runDirectory, artifactBytes, evidenceLedger: ledger, evidenceAudit: recalculatedAudit };
}

export async function loadVerifiedPostmatchRecord({ postmatchRunDir, prematchRunDir } = {}) {
  const [postmatchRun, prematchRun] = await Promise.all([
    loadPublishedRun(postmatchRunDir, { expectedMode: "postmatch" }),
    loadPublishedRun(prematchRunDir, { expectedMode: "prematch" })
  ]);
  const child = postmatchRun.manifest;
  const parent = prematchRun.manifest;
  if (child.parentRunId !== parent.runId) {
    throw new Error("postmatch manifest.parentRunId 与提供的 prematch 运行不匹配。");
  }
  if (contentHash(child.match) !== contentHash(parent.match)
    || contentHash(child.competitionProfile) !== contentHash(parent.competitionProfile)
    || child.modelVersion !== parent.modelVersion) {
    throw new Error("postmatch 运行的比赛、赛事画像或模型版本与父 prematch 运行不匹配。");
  }
  if (child.artifacts.prediction.sha256 !== parent.artifacts.prediction.sha256
    || !postmatchRun.artifactBytes.prediction.equals(prematchRun.artifactBytes.prediction)) {
    throw new Error("postmatch prediction.json 不是父 prematch 预测的原始字节副本。");
  }

  const inputSnapshot = parseJsonArtifact(postmatchRun.artifactBytes.inputSnapshot, "input-snapshot.json");
  assertSnapshotManifestBinding(inputSnapshot?.manifest, child, "postmatch");
  if (inputSnapshot?.parentRun?.runId !== parent.runId
    || inputSnapshot?.parentRun?.predictionSha256 !== parent.artifacts.prediction.sha256) {
    throw new Error("postmatch input-snapshot.json 的父运行绑定不匹配。");
  }
  const prediction = parseJsonArtifact(prematchRun.artifactBytes.prediction, "prediction.json");
  const parentInputSnapshot = parseJsonArtifact(prematchRun.artifactBytes.inputSnapshot, "input-snapshot.json");
  assertSnapshotManifestBinding(parentInputSnapshot?.manifest, parent, "prematch");
  assertAuditedModelBindings({
    manifest: parentInputSnapshot.manifest,
    snapshot: parentInputSnapshot.snapshot,
    evidenceAudit: prematchRun.evidenceAudit
  });
  const recalculatedPrediction = predict90({
    manifest: parentInputSnapshot.manifest,
    snapshot: parentInputSnapshot.snapshot,
    evidenceAudit: prematchRun.evidenceAudit
  });
  if (contentHash(prediction) !== contentHash(recalculatedPrediction)) {
    throw new Error("父 prematch prediction.json 与已审计输入重新计算的预测不匹配。");
  }
  const storedRecord = parseJsonArtifact(postmatchRun.artifactBytes.record, "record.json");
  const postmatch = inputSnapshot?.postmatch;
  const recalculatedRecord = recordPostmatch({
    manifest: parent,
    prediction,
    facts: {
      predictionRunId: parent.runId,
      predictionSha256: parent.artifacts.prediction.sha256,
      dataCutoffAt: child.dataCutoffAt,
      evidenceLedger: postmatchRun.evidenceLedger,
      actualResult: postmatch?.actualResult,
      comparable: postmatch?.comparable
    }
  });
  if (contentHash(storedRecord) !== contentHash(recalculatedRecord)) {
    throw new Error("record.json 与父预测、原始赛果证据重新计算的记录不匹配。");
  }

  const actualResult = postmatch?.actualResult;
  const reportPostmatch = {
    ...postmatch,
    actualResult,
    prematchBinding: {
      runId: parent.runId,
      predictionHash: parent.artifacts.prediction.sha256
    },
    noPosthocRewrite: { enforced: true, predictionHashUnchanged: true }
  };
  const rebuiltReport = buildPostmatchReport({
    manifest: child,
    prediction,
    evidenceAudit: postmatchRun.evidenceAudit,
    postmatch: reportPostmatch
  });
  if (!postmatchRun.artifactBytes.reportMarkdown.equals(Buffer.from(rebuiltReport.markdown, "utf8"))) {
    throw new Error("report.md 与已审计赛后运行重新生成的同源报告不匹配。");
  }
  if (!postmatchRun.artifactBytes.reportHtml.equals(Buffer.from(rebuiltReport.html, "utf8"))) {
    throw new Error("report-long.html 与已审计赛后运行重新生成的同源报告不匹配。");
  }

  return { record: storedRecord, postmatchRun, prematchRun };
}

export function finalizeManifest(manifest) {
  const evidenceAudit = manifest?.evidenceAudit
    ?? manifest?.artifacts?.audit?.metadata?.evidenceAudit;
  if (evidenceAudit?.status === "degraded_low_confidence"
    && !evidenceAudit.missing?.length
    && !evidenceAudit.conflicts?.length) {
    throw new Error("degraded_low_confidence 必须包含非空 missing 或 conflicts。");
  }

  for (const [artifactName, fileName] of requiredArtifactsFor(manifest)) {
    const artifact = manifest?.artifacts?.[artifactName];
    if (!artifact) {
      throw new Error(`正式运行缺少 ${fileName} 及其 SHA-256 哈希。`);
    }
    if (typeof artifact.path !== "string" || !artifact.path.trim()
      || !/^[a-f0-9]{64}$/i.test(artifact.sha256 ?? "")
      || !Number.isInteger(artifact.byteLength) || artifact.byteLength <= 0) {
      throw new Error(`${fileName} 的 path、SHA-256 或 byteLength 无效。`);
    }
  }
  const publication = validatePublishedRun(manifest);
  if (!publication.ok) {
    throw new Error(`正式运行发布校验失败：${publication.errors.join("；")}。`);
  }
  return finalizeRunManifest(manifest);
}

export async function runPrematchPipeline({ input, outDir } = {}) {
  const loaded = await loadInput(input);
  if (loaded.manifest?.mode && loaded.manifest.mode !== "prematch") {
    throw new Error("runPrematchPipeline 只接受 prematch 输入。");
  }

  let manifest = createRunManifest({
    ...loaded.manifest,
    mode: "prematch",
    modelVersion: MODEL_VERSION,
    dataCutoffAt: dataCutoffFrom(loaded)
  });
  if (basename(manifest.runId) !== manifest.runId || !/^[A-Za-z0-9._-]+$/.test(manifest.runId)) {
    throw new Error("runId 只能包含字母、数字、点、下划线和连字符。");
  }

  const ledger = evidenceLedgerFrom(loaded);
  const evidenceAudit = auditEvidenceLedger({
    ledger,
    match: manifest.match,
    cutoffAt: manifest.dataCutoffAt
  });
  assertEvidenceAuditCompletable(evidenceAudit);
  assertAuditedModelBindings({ manifest, snapshot: loaded.snapshot, evidenceAudit });

  if (typeof outDir !== "string" || !outDir.trim()) throw new Error("流水线 outDir 不能为空。");
  const outputRoot = resolve(outDir);
  const runDirectory = join(outputRoot, manifest.runId);
  await mkdir(outputRoot, { recursive: true });
  try {
    await mkdir(runDirectory);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`运行目录已存在，拒绝覆写旧预测：${runDirectory}`, { cause: error });
    throw error;
  }

  const paths = {
    evidenceLedger: join(runDirectory, "evidence-ledger.json"),
    audit: join(runDirectory, "audit.json"),
    inputSnapshot: join(runDirectory, "input-snapshot.json"),
    prediction: join(runDirectory, "prediction.json"),
    reportMarkdown: join(runDirectory, "report.md"),
    reportHtml: join(runDirectory, "report-long.html"),
    reportPng: join(runDirectory, "report-long.png"),
    renderAudit: join(runDirectory, "render-audit.json"),
    manifest: join(runDirectory, "run-manifest.json")
  };

  await writeJson(paths.evidenceLedger, { match: manifest.match, cutoffAt: manifest.dataCutoffAt, ledger });
  await writeJson(paths.audit, evidenceAudit);

  const auditedSnapshot = { manifest, snapshot: loaded.snapshot };
  await writeJson(paths.inputSnapshot, auditedSnapshot);

  const prediction = predict90({ manifest, snapshot: loaded.snapshot, evidenceAudit });
  await writeJson(paths.prediction, prediction);

  const report = buildPrematchReport({
    ...loaded,
    manifest,
    snapshot: loaded.snapshot,
    evidenceAudit,
    prediction
  });
  await Promise.all([
    writeFile(paths.reportMarkdown, report.markdown, "utf8"),
    writeFile(paths.reportHtml, report.html, "utf8")
  ]);

  const renderAudit = await renderLongPng({
    html: report.html,
    outputPath: paths.reportPng,
    auditPath: paths.renderAudit
  });
  const errors = renderAuditErrors(renderAudit);
  if (errors.length) throw new Error(`渲染审计失败：${errors.join("；")}`);

  const artifactFiles = Object.fromEntries(await Promise.all(
    Object.entries(paths)
      .filter(([name]) => name !== "manifest")
      .map(async ([name, path]) => {
        const fileStat = await stat(path);
        return [name, { sha256: await sha256File(path), byteLength: fileStat.size }];
      })
  ));
  const evidenceAuditSummary = {
    status: evidenceAudit.status,
    missing: evidenceAudit.missing,
    conflicts: evidenceAudit.conflicts
  };
  for (const [artifactName, fileName] of REQUIRED_ARTIFACTS) {
    const metadata = artifactName === "audit"
      ? { evidenceAudit: evidenceAuditSummary }
      : artifactName === "renderAudit"
        ? {
            passed: true,
            errors: [],
            horizontalOverflow: renderAudit.horizontalOverflow,
            tableOverflow: renderAudit.tableOverflow,
            replacementCharacterDetected: renderAudit.replacementCharacterDetected,
            pageHeightValid: renderAudit.pageHeightValid
          }
        : undefined;
    manifest = appendArtifact(manifest, artifactName, {
      path: fileName,
      sha256: artifactFiles[artifactName].sha256,
      byteLength: artifactFiles[artifactName].byteLength,
      ...(metadata ? { metadata } : {})
    });
  }
  manifest = finalizeManifest(manifest);
  await writeJson(paths.manifest, manifest);

  return { manifest, runDirectory, paths };
}

async function loadPublishedPrematchRun(prematchRunDir) {
  const published = await loadPublishedRun(prematchRunDir, { expectedMode: "prematch" });
  const predictionBytes = published.artifactBytes.prediction;
  return {
    manifest: published.manifest,
    predictionBytes,
    prediction: parseJsonArtifact(predictionBytes, "prediction.json"),
    runDirectory: published.runDirectory
  };
}

export async function runPostmatchPipeline({ prematchRunDir, input, outDir } = {}) {
  const parentRun = await loadPublishedPrematchRun(prematchRunDir);
  const loaded = await loadInput(input);
  const ledger = evidenceLedgerFrom(loaded);
  const dataCutoffAt = dataCutoffFrom(loaded);
  if (!dataCutoffAt) throw new Error("postmatch 流水线必须显式提供 dataCutoffAt。");

  let manifest = createRunManifest({
    runId: loaded.manifest?.runId,
    mode: "postmatch",
    parentRunId: parentRun.manifest.runId,
    modelVersion: parentRun.manifest.modelVersion,
    dataCutoffAt,
    competitionProfile: parentRun.manifest.competitionProfile,
    match: parentRun.manifest.match
  });
  if (basename(manifest.runId) !== manifest.runId || !/^[A-Za-z0-9._-]+$/.test(manifest.runId)) {
    throw new Error("runId 只能包含字母、数字、点、下划线和连字符。");
  }

  const evidenceAudit = auditEvidenceLedger({ ledger, match: manifest.match, cutoffAt: manifest.dataCutoffAt });
  assertEvidenceAuditCompletable(evidenceAudit);
  const postmatchInput = loaded.postmatch ?? loaded;
  const actualResult = postmatchInput.actualResult ?? loaded.actualResult;
  const record = recordPostmatch({
    manifest: parentRun.manifest,
    prediction: parentRun.prediction,
    facts: {
      predictionRunId: parentRun.manifest.runId,
      predictionSha256: parentRun.manifest.artifacts.prediction.sha256,
      dataCutoffAt: manifest.dataCutoffAt,
      evidenceLedger: ledger,
      actualResult,
      comparable: postmatchInput.comparable
    }
  });

  if (typeof outDir !== "string" || !outDir.trim()) throw new Error("流水线 outDir 不能为空。");
  const outputRoot = resolve(outDir);
  const runDirectory = join(outputRoot, manifest.runId);
  await mkdir(outputRoot, { recursive: true });
  try {
    await mkdir(runDirectory);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`运行目录已存在，拒绝覆写旧赛后运行：${runDirectory}`, { cause: error });
    throw error;
  }

  const paths = {
    evidenceLedger: join(runDirectory, "evidence-ledger.json"),
    audit: join(runDirectory, "audit.json"),
    inputSnapshot: join(runDirectory, "input-snapshot.json"),
    prediction: join(runDirectory, "prediction.json"),
    record: join(runDirectory, "record.json"),
    reportMarkdown: join(runDirectory, "report.md"),
    reportHtml: join(runDirectory, "report-long.html"),
    reportPng: join(runDirectory, "report-long.png"),
    renderAudit: join(runDirectory, "render-audit.json"),
    manifest: join(runDirectory, "run-manifest.json")
  };

  await writeJson(paths.evidenceLedger, { match: manifest.match, cutoffAt: manifest.dataCutoffAt, ledger });
  await writeJson(paths.audit, evidenceAudit);
  await writeJson(paths.inputSnapshot, {
    manifest,
    parentRun: {
      runId: parentRun.manifest.runId,
      predictionSha256: parentRun.manifest.artifacts.prediction.sha256
    },
    postmatch: postmatchInput
  });
  await writeFile(paths.prediction, parentRun.predictionBytes);
  await writeJson(paths.record, record);

  const reportPostmatch = {
    ...postmatchInput,
    actualResult,
    prematchBinding: {
      runId: parentRun.manifest.runId,
      predictionHash: parentRun.manifest.artifacts.prediction.sha256
    },
    noPosthocRewrite: { enforced: true, predictionHashUnchanged: true }
  };
  const report = buildPostmatchReport({ manifest, prediction: parentRun.prediction, evidenceAudit, postmatch: reportPostmatch });
  await Promise.all([
    writeFile(paths.reportMarkdown, report.markdown, "utf8"),
    writeFile(paths.reportHtml, report.html, "utf8")
  ]);
  const renderAudit = await renderLongPng({ html: report.html, outputPath: paths.reportPng, auditPath: paths.renderAudit });
  const renderErrors = renderAuditErrors(renderAudit);
  if (renderErrors.length) throw new Error(`渲染审计失败：${renderErrors.join("；")}`);

  const artifactFiles = Object.fromEntries(await Promise.all(
    Object.entries(paths)
      .filter(([name]) => name !== "manifest")
      .map(async ([name, path]) => {
        const bytes = await readFile(path);
        return [name, {
          sha256: createHash("sha256").update(bytes).digest("hex"),
          byteLength: bytes.byteLength
        }];
      })
  ));
  const evidenceAuditSummary = {
    status: evidenceAudit.status,
    missing: evidenceAudit.missing,
    conflicts: evidenceAudit.conflicts
  };
  for (const [artifactName, fileName] of POSTMATCH_ARTIFACTS) {
    const metadata = artifactName === "audit"
      ? { evidenceAudit: evidenceAuditSummary }
      : artifactName === "renderAudit"
        ? {
            passed: true,
            errors: [],
            horizontalOverflow: renderAudit.horizontalOverflow,
            tableOverflow: renderAudit.tableOverflow,
            replacementCharacterDetected: renderAudit.replacementCharacterDetected,
            pageHeightValid: renderAudit.pageHeightValid
          }
        : undefined;
    manifest = appendArtifact(manifest, artifactName, {
      path: fileName,
      sha256: artifactFiles[artifactName].sha256,
      byteLength: artifactFiles[artifactName].byteLength,
      ...(metadata ? { metadata } : {})
    });
  }
  manifest = finalizeManifest(manifest);
  await writeJson(paths.manifest, manifest);

  return { manifest, record, runDirectory, paths };
}
