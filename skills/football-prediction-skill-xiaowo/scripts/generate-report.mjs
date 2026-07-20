#!/usr/bin/env node

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { predict90 } from "../core/model.mjs";
import { buildPostmatchReport, buildPrematchReport } from "../core/report.mjs";
import { assertRendererAvailable, renderLongPng } from "../core/render.mjs";

const USAGE = "用法：node generate-report.mjs --fixture <输入夹具.json> --out-dir <输出目录>";

function parseArguments(argumentsList) {
  if (argumentsList.length !== 4) return null;
  const values = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const flag = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!["--fixture", "--out-dir"].includes(flag) || !value || values[flag]) return null;
    values[flag] = value;
  }
  return values["--fixture"] && values["--out-dir"] ? { fixture: values["--fixture"], outputDirectory: values["--out-dir"] } : null;
}

function reportMode(fixture) {
  if (fixture?.manifest?.mode === "postmatch" || fixture?.mode === "postmatch") return "postmatch";
  if (fixture?.postmatch && typeof fixture.postmatch === "object") return "postmatch";
  if (fixture?.actualResult || fixture?.record || fixture?.result) return "postmatch";
  return "prematch";
}

function assertPostmatchManifest(fixture, mode) {
  if (mode !== "postmatch") return;
  if (fixture?.manifest?.mode !== "postmatch" || typeof fixture.manifest.parentRunId !== "string" || !fixture.manifest.parentRunId) {
    throw new Error("赛后报告只能消费带 parentRunId 的 postmatch manifest；请使用赛后流水线创建运行清单。");
  }
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

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options) throw new Error(USAGE);

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
  const build = mode === "postmatch" ? buildPostmatchReport : buildPrematchReport;
  const report = build(reportInput);

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
