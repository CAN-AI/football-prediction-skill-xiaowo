import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { buildPostmatchReport, buildPrematchReport } from "../core/report.mjs";
import { assertRendererAvailable, renderLongPng } from "../core/render.mjs";

const execFileAsync = promisify(execFile);

test("赛前报告将模型、市场和缺失信息分栏", () => {
  const report = buildPrematchReport({
    manifest: {
      match: { homeTeamName: "阿森纳", awayTeamName: "切尔西" },
      dataCutoffAt: "2026-08-01T10:00:00Z"
    },
    prediction: {
      homeWinProb: 0.45,
      drawProb: 0.28,
      awayWinProb: 0.27,
      confidence: { level: "low" }
    },
    evidenceAudit: {
      status: "degraded_low_confidence",
      missing: ["正式首发"],
      conflicts: []
    },
    market: null
  });

  assert.match(report.markdown, /90分钟胜平负概率/);
  assert.match(report.markdown, /正式首发/);
  assert.doesNotMatch(report.markdown, /市场去水概率：/);
});

test("赛前 Markdown 与 HTML 共享固定章节顺序", () => {
  const report = buildPrematchReport({
    manifest: {
      competitionProfile: {
        family: "league",
        competitionId: "ENG-PL",
        regulation: { extraTime: false, penalties: false, twoLegged: false }
      },
      match: { homeTeamName: "阿森纳", awayTeamName: "切尔西" },
      dataCutoffAt: "2026-08-01T10:00:00Z"
    },
    prediction: {
      modelVersion: "football-xiaowo-v3.0.0-90min",
      homeWinProb: 0.45,
      drawProb: 0.28,
      awayWinProb: 0.27,
      expectedGoals: { home: 1.7, away: 1.1 },
      scoreMatrix: [{ homeGoals: 1, awayGoals: 0, probability: 0.12 }],
      confidence: { level: "high" },
      trace: { baselineVersion: "eng-pl-2026-27-r1" }
    },
    evidenceAudit: { status: "passed", missing: [], conflicts: [], accepted: [] }
  });
  const sectionNames = [
    "赛制与口径", "执行结论", "证据审计", "实力与状态", "人员可用性", "战术对位",
    "环境因素", "方法说明", "90分钟胜平负概率", "比分候选", "市场比较", "淘汰赛分支",
    "不确定性与重算触发器", "结论", "来源索引"
  ];

  assert.equal(typeof report.html, "string");
  assert.match(report.html, /lang="zh-CN"/);
  assert.match(report.html, /class="report-card/);
  for (const [output, heading] of [[report.markdown, (name) => `## ${name}`], [report.html, (name) => `<h2>${name}</h2>`]]) {
    let cursor = -1;
    for (const name of sectionNames) {
      const next = output.indexOf(heading(name));
      assert.ok(next > cursor, `${name} 应按固定顺序出现`);
      cursor = next;
    }
  }
});

test("市场为空时不编造概率，存在审计市场时才显示", () => {
  const base = {
    manifest: { match: { homeTeamId: "ARS", awayTeamId: "CHE" } },
    prediction: { homeWinProb: 0.45, drawProb: 0.28, awayWinProb: 0.27 },
    evidenceAudit: { status: "passed", missing: [], conflicts: [], accepted: [] }
  };
  const withoutMarket = buildPrematchReport(base);
  const withMarket = buildPrematchReport({
    ...base,
    market: { homeWinProb: 0.5, drawProb: 0.25, awayWinProb: 0.25, audited: true }
  });

  assert.doesNotMatch(withoutMarket.markdown, /市场去水概率：/);
  assert.match(withMarket.markdown, /市场去水概率：主胜 50\.0% · 平局 25\.0% · 客胜 25\.0%/);
});

test("报告只把已接受证据写入来源索引", () => {
  const report = buildPrematchReport({
    manifest: { match: { homeTeamId: "ARS", awayTeamId: "CHE" } },
    prediction: { homeWinProb: 0.45, drawProb: 0.28, awayWinProb: 0.27 },
    evidenceAudit: {
      status: "degraded_low_confidence",
      missing: [],
      conflicts: [],
      accepted: [{ claimId: "accepted-1", topic: "injury", subject: "主队前锋", sourceUrl: "https://example.test/accepted" }],
      rejected: [{ claim: { claimId: "rejected-1", value: "未经证实的伤停内幕" }, reasons: ["来源不可信"] }]
    }
  });

  assert.match(report.markdown, /accepted-1/);
  assert.doesNotMatch(report.markdown, /未经证实的伤停内幕/);
  assert.doesNotMatch(report.html, /rejected-1/);
});

test("赛后报告使用独立复盘结构并对照实际赛果", () => {
  const report = buildPostmatchReport({
    manifest: { match: { homeTeamName: "阿森纳", awayTeamName: "切尔西" } },
    prediction: { homeWinProb: 0.45, drawProb: 0.28, awayWinProb: 0.27 },
    evidenceAudit: { status: "passed", missing: [], conflicts: [], accepted: [] },
    actualResult: { homeGoals: 2, awayGoals: 1, decidedIn: "90min" }
  });

  assert.match(report.markdown, /赛后复盘报告/);
  assert.match(report.markdown, /实际赛果：阿森纳 2–1 切尔西/);
  assert.match(report.markdown, /预测与实赛对照/);
  assert.match(report.markdown, /偏差归因与校准建议/);
  assert.doesNotMatch(report.markdown, /## 执行结论/);
});

test("国家队赛事使用数据契约中的赛事类别名称", () => {
  const report = buildPrematchReport({
    manifest: {
      competitionProfile: { family: "national_tournament", competitionId: "AFC-ASIAN-CUP" },
      match: { homeTeamId: "CHN", awayTeamId: "JPN" }
    },
    prediction: {},
    evidenceAudit: {}
  });

  assert.match(report.markdown, /类型：国家队赛事/);
});

test("Chromium 在 430px 视口生成真实长图并返回完整审计", async () => {
  const renderer = await assertRendererAvailable();
  assert.equal(renderer.browserName, "chromium");
  assert.match(renderer.version, /^\d+/);

  const outputDirectory = await mkdtemp(join(tmpdir(), "football-report-"));
  const outputPath = join(outputDirectory, "report-long.png");
  try {
    const report = buildPrematchReport({
      manifest: { match: { homeTeamId: "ARS", awayTeamId: "CHE" } },
      prediction: { homeWinProb: 0.45, drawProb: 0.28, awayWinProb: 0.27 },
      evidenceAudit: { status: "passed", missing: [], conflicts: [], accepted: [] }
    });
    const audit = await renderLongPng({ html: report.html, outputPath });
    const png = await readFile(outputPath);

    assert.equal(audit.viewport.width, 430);
    assert.ok(audit.documentHeight > 0);
    assert.equal(audit.pageHeightValid, true);
    assert.equal(audit.horizontalOverflow, false);
    assert.deepEqual(audit.tableOverflow, []);
    assert.equal(audit.replacementCharacterDetected, false);
    assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
    assert.ok(png.byteLength > 10_000);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("渲染审计识别替换字符", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "football-report-bad-text-"));
  try {
    const audit = await renderLongPng({
      html: '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body>坏字符：�</body></html>',
      outputPath: join(outputDirectory, "bad.png")
    });
    assert.equal(audit.replacementCharacterDetected, true);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("报告 CLI 从一个样例同源生成 Markdown、HTML、PNG 和审计", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "football-report-cli-"));
  const fixture = new URL("../assets/sample-data/club-league-snapshot.json", import.meta.url);
  const script = new URL("../scripts/generate-report.mjs", import.meta.url);
  try {
    await execFileAsync(process.execPath, [fileURLToPath(script), "--fixture", fileURLToPath(fixture), "--out-dir", outputDirectory]);
    const [markdown, html, png, auditText] = await Promise.all([
      readFile(join(outputDirectory, "report.md"), "utf8"),
      readFile(join(outputDirectory, "report-long.html"), "utf8"),
      readFile(join(outputDirectory, "report-long.png")),
      readFile(join(outputDirectory, "render-audit.json"), "utf8")
    ]);
    const audit = JSON.parse(auditText);

    assert.match(markdown, /## 90分钟胜平负概率/);
    assert.doesNotMatch(markdown, /市场去水概率：/);
    assert.match(html, /data-section="90分钟胜平负概率"/);
    assert.ok(png.byteLength > 10_000);
    assert.equal(audit.horizontalOverflow, false);
    assert.deepEqual(audit.tableOverflow, []);
    assert.equal(audit.replacementCharacterDetected, false);
    assert.equal(audit.pageHeightValid, true);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("报告 CLI 检测到替换字符时非零退出", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "football-report-cli-bad-"));
  const fixturePath = join(outputDirectory, "bad-fixture.json");
  const fixture = JSON.parse(await readFile(new URL("../assets/sample-data/club-league-snapshot.json", import.meta.url), "utf8"));
  fixture.manifest.match.homeTeamName = "坏字符�队";
  await writeFile(fixturePath, JSON.stringify(fixture), "utf8");
  try {
    await assert.rejects(
      execFileAsync(process.execPath, [fileURLToPath(new URL("../scripts/generate-report.mjs", import.meta.url)), "--fixture", fixturePath, "--out-dir", outputDirectory]),
      (error) => error.code === 1 && /替换字符/.test(error.stderr)
    );
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
