#!/usr/bin/env node

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { predict90 } from "../core/model.mjs";
import { loadVerifiedPostmatchRecord } from "../core/pipeline.mjs";
import { buildPrematchReport } from "../core/report.mjs";
import { assertRendererAvailable, renderLongPng } from "../core/render.mjs";

const USAGE = "用法：node generate-report.mjs --fixture <赛前夹具.json> --out-dir <输出目录>；或 --run-dir <赛后运行目录> --prematch-run-dir <父赛前运行目录>";

function parseArguments(argumentsList) {
  if (argumentsList.length !== 4) return null;
  const values = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const flag = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!["--fixture", "--out-dir", "--run-dir", "--prematch-run-dir"].includes(flag) || !value || values[flag]) return null;
    values[flag] = value;
  }
  if (values["--fixture"] && values["--out-dir"] && !values["--run-dir"] && !values["--prematch-run-dir"]) {
    return { fixture: values["--fixture"], outputDirectory: values["--out-dir"] };
  }
  if (values["--run-dir"] && values["--prematch-run-dir"] && !values["--fixture"] && !values["--out-dir"]) {
    return { runDirectory: values["--run-dir"], prematchRunDirectory: values["--prematch-run-dir"] };
  }
  return null;
}

function reportMode(fixture) {
  if (fixture?.manifest?.mode === "postmatch" || fixture?.mode === "postmatch") return "postmatch";
  if (fixture?.postmatch && typeof fixture.postmatch === "object") return "postmatch";
  if (fixture?.actualResult || fixture?.record || fixture?.result) return "postmatch";
  return "prematch";
}

function assertPostmatchManifest(fixture, mode) {
  if (mode !== "postmatch") return;
  throw new Error("公开报告命令不接受可编辑的 postmatch manifest 夹具；请使用赛后流水线发布，或用 --run-dir 复验已定稿赛后运行清单。");
}

async function assertOutputsAbsent(paths) {
  for (const path of paths) {
    try {
      await stat(path);
      throw new Error(`报告产物已存在，拒绝覆写：${path}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

function assertAuditPassed(audit) {
  const failures = [];
  if (!audit.png?.present) failures.push("PNG 不存在或为空");
  if (audit.horizontalOverflow) failures.push("存在水平溢出");
  if (audit.tableOverflow.length) failures.push(`存在 ${audit.tableOverflow.length} 个表格溢出`);
  if (audit.replacementCharacterDetected) failures.push("检测到替换字符");
  if (!audit.pageHeightValid) failures.push(`页面高度无效：${audit.documentHeight}`);
  if (failures.length) throw new Error(`渲染审计失败：${failures.join("；")}`);
}

async function assertPostmatchPngMatches(verified) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "football-postmatch-report-verify-"));
  try {
    const outputPath = join(temporaryDirectory, "report-long.png");
    const auditPath = join(temporaryDirectory, "render-audit.json");
    const html = verified.postmatchRun.artifactBytes.reportHtml.toString("utf8");
    await assertRendererAvailable();
    const audit = await renderLongPng({ html, outputPath, auditPath });
    assertAuditPassed(audit);
    const renderedPng = await readFile(outputPath);
    if (!renderedPng.equals(verified.postmatchRun.artifactBytes.reportPng)) {
      throw new Error("report-long.png 与已审计 HTML 重新渲染的同源长图不匹配。");
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options) throw new Error(USAGE);
  if (options.runDirectory) {
    const verified = await loadVerifiedPostmatchRecord({
      postmatchRunDir: options.runDirectory,
      prematchRunDir: options.prematchRunDirectory
    });
    await assertPostmatchPngMatches(verified);
    console.log(`赛后报告复验通过：${resolve(verified.postmatchRun.runDirectory, "report.md")}`);
    return;
  }

  const fixturePath = resolve(options.fixture);
  const outputDirectory = resolve(options.outputDirectory);
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  const mode = reportMode(fixture);
  assertPostmatchManifest(fixture, mode);
  const prediction = fixture.prediction ?? predict90({
    manifest: fixture.manifest,
    snapshot: fixture.snapshot,
    evidenceAudit: fixture.evidenceAudit
  });
  const reportInput = { ...fixture, prediction };
  const report = buildPrematchReport(reportInput);

  await mkdir(outputDirectory, { recursive: true });
  const markdownPath = resolve(outputDirectory, "report.md");
  const htmlPath = resolve(outputDirectory, "report-long.html");
  const pngPath = resolve(outputDirectory, "report-long.png");
  const auditPath = resolve(outputDirectory, "render-audit.json");
  await assertOutputsAbsent([markdownPath, htmlPath, pngPath, auditPath]);
  await assertRendererAvailable();

  await Promise.all([
    writeFile(markdownPath, report.markdown, { encoding: "utf8", flag: "wx" }),
    writeFile(htmlPath, report.html, { encoding: "utf8", flag: "wx" })
  ]);
  const audit = await renderLongPng({ html: report.html, outputPath: pngPath, auditPath });
  assertAuditPassed(audit);

  const outputs = await Promise.all([markdownPath, htmlPath, pngPath, auditPath].map((path) => stat(path)));
  if (outputs.some((item) => !item.isFile() || item.size === 0)) throw new Error("同源报告产物不完整。");
  console.log(`报告生成完成：${outputDirectory}`);
}

try {
  await main();
} catch (error) {
  console.error(`报告生成失败：${error.message}`);
  process.exitCode = 1;
}
