import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { auditEvidenceLedger } from "./evidence.mjs";
import { MODEL_VERSION, predict90 } from "./model.mjs";
import { renderLongPng } from "./render.mjs";
import { buildPrematchReport } from "./report.mjs";
import { appendArtifact, createRunManifest, finalizeRunManifest } from "./schema.mjs";

const REQUIRED_ARTIFACTS = Object.freeze([
  ["reportPng", "report-long.png"],
  ["reportMarkdown", "report.md"],
  ["reportHtml", "report-long.html"],
  ["renderAudit", "render-audit.json"],
  ["inputSnapshot", "audited-snapshot.json"],
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
  if (Array.isArray(input.evidenceLedger)) return input.evidenceLedger;
  if (Array.isArray(input.evidenceLedger?.ledger)) return input.evidenceLedger.ledger;
  if (Array.isArray(input.ledger)) return input.ledger;
  const accepted = Array.isArray(input.evidenceAudit?.accepted) ? input.evidenceAudit.accepted : [];
  const rejected = Array.isArray(input.evidenceAudit?.rejected)
    ? input.evidenceAudit.rejected.map((item) => item?.claim).filter(Boolean)
    : [];
  return [...accepted, ...rejected];
}

function dataCutoffFrom(input) {
  return input.manifest?.dataCutoffAt
    ?? input.dataCutoffAt
    ?? input.cutoffAt
    ?? input.evidenceLedger?.cutoffAt
    ?? input.manifest?.match?.kickoffAt;
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

async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function finalizeManifest(manifest) {
  const evidenceAudit = manifest?.evidenceAudit
    ?? manifest?.artifacts?.inputSnapshot?.metadata?.evidenceAudit;
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
    if (typeof artifact.path !== "string" || !artifact.path.trim() || !/^[a-f0-9]{64}$/i.test(artifact.sha256 ?? "")) {
      throw new Error(`${fileName} 的 path 或 SHA-256 无效。`);
    }
  }
  if (manifest.artifacts.renderAudit.metadata?.passed !== true) {
    throw new Error("render-audit.json 未通过，正式运行不能定稿。");
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
    inputSnapshot: join(runDirectory, "audited-snapshot.json"),
    prediction: join(runDirectory, "prediction.json"),
    reportMarkdown: join(runDirectory, "report.md"),
    reportHtml: join(runDirectory, "report-long.html"),
    reportPng: join(runDirectory, "report-long.png"),
    renderAudit: join(runDirectory, "render-audit.json"),
    manifest: join(runDirectory, "run-manifest.json")
  };

  const auditedSnapshot = {
    manifest,
    snapshot: loaded.snapshot,
    evidenceLedger: ledger,
    evidenceAudit
  };
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

  const hashes = Object.fromEntries(await Promise.all(
    Object.entries(paths)
      .filter(([name]) => name !== "manifest")
      .map(async ([name, path]) => [name, await sha256File(path)])
  ));
  const evidenceAuditSummary = {
    status: evidenceAudit.status,
    missing: evidenceAudit.missing,
    conflicts: evidenceAudit.conflicts
  };
  for (const [artifactName, fileName] of REQUIRED_ARTIFACTS) {
    const metadata = artifactName === "inputSnapshot"
      ? { evidenceAudit: evidenceAuditSummary }
      : artifactName === "renderAudit"
        ? { passed: true, errors: [] }
        : undefined;
    manifest = appendArtifact(manifest, artifactName, {
      path: fileName,
      sha256: hashes[artifactName],
      ...(metadata ? { metadata } : {})
    });
  }
  manifest = finalizeManifest(manifest);
  await writeJson(paths.manifest, manifest);

  return { manifest, runDirectory, paths };
}
