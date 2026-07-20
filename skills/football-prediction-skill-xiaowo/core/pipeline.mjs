import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { auditEvidenceLedger } from "./evidence.mjs";
import { MODEL_VERSION, predict90 } from "./model.mjs";
import { renderLongPng } from "./render.mjs";
import { buildPrematchReport } from "./report.mjs";
import { appendArtifact, createRunManifest, finalizeRunManifest } from "./schema.mjs";
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
    && contentHash(claim.value?.sampleWindow) === contentHash(baseline.sampleWindow)
  ));
  if (!baselineBound) {
    throw new Error("赛事画像 baseline.goalsPerTeam/sampleWindow/baselineVersion 未与同赛事已审计证据严格绑定。");
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
  for (const [artifactName, fileName] of REQUIRED_ARTIFACTS) {
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

export function finalizeManifest(manifest) {
  const evidenceAudit = manifest?.evidenceAudit
    ?? manifest?.artifacts?.audit?.metadata?.evidenceAudit;
  if (evidenceAudit?.status === "degraded_low_confidence"
    && !evidenceAudit.missing?.length
    && !evidenceAudit.conflicts?.length) {
    throw new Error("degraded_low_confidence 必须包含非空 missing 或 conflicts。");
  }

  for (const [artifactName, fileName] of REQUIRED_ARTIFACTS) {
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
