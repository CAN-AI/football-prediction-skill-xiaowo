import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { auditEvidenceLedger } from "../core/evidence.mjs";
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

test("市场只有通过完整审计门禁时才显示", () => {
  const base = {
    manifest: { match: { homeTeamId: "ARS", awayTeamId: "CHE" } },
    prediction: { homeWinProb: 0.45, drawProb: 0.28, awayWinProb: 0.27 },
    evidenceAudit: { status: "passed", missing: [], conflicts: [], accepted: [] }
  };
  const withoutMarket = buildPrematchReport(base);
  const withMarket = buildPrematchReport({
    ...base,
    market: {
      audited: true,
      scope: "90min",
      probabilityType: "de_vig",
      observedAt: "2026-08-01T09:55:00Z",
      source: "审计交易所快照",
      homeWinProb: 0.5,
      drawProb: 0.25,
      awayWinProb: 0.25
    }
  });

  assert.doesNotMatch(withoutMarket.markdown, /市场去水概率：/);
  assert.match(withMarket.markdown, /市场去水概率：主胜 50\.0% · 平局 25\.0% · 客胜 25\.0%/);
});

test("拒绝未审计、负数和不归一市场且不泄露概率", () => {
  const base = {
    manifest: { match: { homeTeamId: "ARS", awayTeamId: "CHE" } },
    prediction: { homeWinProb: 0.45, drawProb: 0.28, awayWinProb: 0.27 },
    evidenceAudit: { status: "passed", missing: [], conflicts: [], accepted: [] }
  };
  const validMetadata = {
    scope: "90min",
    probabilityType: "de_vig",
    observedAt: "2026-08-01T09:55:00Z",
    source: "审计交易所快照"
  };
  const rejectedMarkets = [
    { ...validMetadata, audited: false, homeWinProb: 0.6, drawProb: 0.2, awayWinProb: 0.2 },
    { ...validMetadata, audited: true, homeWinProb: -0.1, drawProb: 0.5, awayWinProb: 0.6 },
    { ...validMetadata, audited: true, homeWinProb: 0.7, drawProb: 0.4, awayWinProb: 0.2 }
  ];

  for (const market of rejectedMarkets) {
    const report = buildPrematchReport({ ...base, market });
    assert.doesNotMatch(report.markdown, /市场去水概率：/);
    assert.doesNotMatch(report.markdown, /60\.0%|70\.0%|-10\.0%/);
    assert.match(report.markdown, /市场数据未通过审计门禁/);
  }
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

test("无已接受来源绑定的赛果保持未提供", () => {
  const report = buildPostmatchReport({
    manifest: { match: { homeTeamName: "阿森纳", awayTeamName: "切尔西" } },
    prediction: { homeWinProb: 0.45, drawProb: 0.28, awayWinProb: 0.27 },
    evidenceAudit: { status: "passed", missing: [], conflicts: [], accepted: [] },
    postmatch: { actualResult: { homeGoals: 2, awayGoals: 1, decidedIn: "90min", sourceClaimId: "missing-result" } }
  });

  assert.match(report.markdown, /实际赛果：未提供/);
  assert.doesNotMatch(report.markdown, /2–1/);
});

test("伤停 claim 不能授权伪造赛果", () => {
  const report = buildPostmatchReport({
    manifest: { match: { matchId: "ARS-CHE-2026-08-01", homeTeamId: "ARS", awayTeamId: "CHE" } },
    prediction: { homeWinProb: 0.45, drawProb: 0.28, awayWinProb: 0.27 },
    evidenceAudit: {
      accepted: [{
        claimId: "injury-1",
        topic: "injury",
        subject: "ARS-CHE-2026-08-01",
        value: { homeGoals: 9, awayGoals: 0, decidedIn: "90min", observedAt: "2026-08-01T17:00:00Z" }
      }]
    },
    postmatch: { actualResult: { homeGoals: 9, awayGoals: 0, decidedIn: "90min", observedAt: "2026-08-01T17:00:00Z", sourceClaimId: "injury-1" } }
  });

  assert.match(report.markdown, /实际赛果：未提供/);
  assert.doesNotMatch(report.markdown, /9–0/);
});

test("相同 result claimId 的不同比分不能授权展示", () => {
  const report = buildPostmatchReport({
    manifest: { match: { matchId: "ARS-CHE-2026-08-01", homeTeamId: "ARS", awayTeamId: "CHE" } },
    prediction: { homeWinProb: 0.45, drawProb: 0.28, awayWinProb: 0.27 },
    evidenceAudit: {
      accepted: [{
        claimId: "result-1",
        topic: "result",
        subject: "ARS-CHE-2026-08-01",
        value: { homeGoals: 1, awayGoals: 0, decidedIn: "90min", observedAt: "2026-08-01T17:00:00Z" }
      }]
    },
    postmatch: { actualResult: { homeGoals: 2, awayGoals: 0, decidedIn: "90min", observedAt: "2026-08-01T17:00:00Z", sourceClaimId: "result-1" } }
  });

  assert.match(report.markdown, /实际赛果：未提供/);
  assert.doesNotMatch(report.markdown, /2–0/);
});

test("比赛身份不符的事件与值不符的统计不能展示", () => {
  const report = buildPostmatchReport({
    manifest: { match: { matchId: "ARS-CHE-2026-08-01", homeTeamId: "ARS", awayTeamId: "CHE" } },
    prediction: {},
    evidenceAudit: {
      accepted: [
        {
          claimId: "event-1",
          topic: "event",
          subject: "OTHER-MATCH",
          value: { minute: 18, event: "虚构事件", teamId: "ARS" }
        },
        {
          claimId: "stats-1",
          topic: "statistics",
          subject: "ARS-CHE-2026-08-01",
          value: { metric: "射门", home: 14, away: 8, definition: "官方全场射门口径" }
        }
      ]
    },
    postmatch: {
      eventTimeline: [{ minute: 18, event: "虚构事件", teamId: "ARS", sourceClaimId: "event-1" }],
      processStatistics: [{ metric: "射门", home: 999, away: 8, definition: "虚构统计口径", sourceClaimId: "stats-1" }]
    }
  });

  assert.match(report.markdown, /事件时间线：未提供/);
  assert.match(report.markdown, /过程统计：未提供/);
  assert.doesNotMatch(report.markdown, /999|虚构事件|虚构统计口径/);
});

test("赛后报告显示来源绑定事实并按完整复盘顺序输出治理状态", () => {
  const predictionHash = "a".repeat(64);
  const match = {
    matchId: "ARS-CHE-2026-08-01",
    homeTeamId: "ARS",
    awayTeamId: "CHE",
    homeTeamName: "阿森纳",
    awayTeamName: "切尔西",
    kickoffAt: "2026-08-01T15:00:00Z"
  };
  const claimDefaults = {
    subject: match.matchId,
    sourceUrl: "https://official.test/fact",
    publishedAt: "2026-08-01T17:00:00Z",
    observedAt: "2026-08-01T17:00:00Z",
    affectsModel: true,
    reviewStatus: "accepted"
  };
  const evidenceAudit = auditEvidenceLedger({
    match,
    cutoffAt: "2026-08-01T18:00:00Z",
    ledger: [
      {
        ...claimDefaults,
        claimId: "result-1",
        topic: "result",
        sourceTier: "organizer",
        value: { homeGoals: 2, awayGoals: 1, decidedIn: "90min", observedAt: "2026-08-01T17:00:00Z" }
      },
      {
        ...claimDefaults,
        claimId: "event-1",
        topic: "event",
        sourceTier: "data_provider",
        value: { minute: 18, event: "阿森纳进球", teamId: "ARS" }
      },
      {
        ...claimDefaults,
        claimId: "stats-1",
        topic: "statistics",
        sourceTier: "data_provider",
        value: { metric: "射门", home: 14, away: 8, definition: "官方全场射门口径" }
      }
    ]
  });
  const report = buildPostmatchReport({
    manifest: { match },
    prediction: { modelVersion: "model-v3", homeWinProb: 0.45, drawProb: 0.28, awayWinProb: 0.27 },
    evidenceAudit,
    postmatch: {
      prematchBinding: { runId: "prematch-run-42", predictionHash },
      actualResult: { homeGoals: 2, awayGoals: 1, decidedIn: "90min", observedAt: "2026-08-01T17:00:00Z", sourceClaimId: "result-1" },
      eventTimeline: [{ minute: 18, event: "阿森纳进球", teamId: "ARS", sourceClaimId: "event-1" }],
      processStatistics: [{ metric: "射门", home: 14, away: 8, definition: "官方全场射门口径", sourceClaimId: "stats-1" }],
      calibrationMetrics: { brierScore: 0.31, logLoss: 0.8, sampleSize: 1 },
      noPosthocRewrite: { enforced: true, predictionHashUnchanged: true },
      revisionProposal: { proposalId: "proposal-1", status: "pending_human_review", summary: "等待跨样本验证" },
      humanApprovals: [{ itemId: "proposal-1", status: "pending", approver: null, decidedAt: null }]
    }
  });
  const sectionNames = [
    "赛前运行绑定", "赛果事实与事件时间线", "过程统计与来源口径", "预测命中审计", "校准指标",
    "禁止事后回写", "修正提案", "人工批准项", "来源索引"
  ];

  assert.match(report.markdown, /实际赛果：阿森纳 2–1 切尔西/);
  assert.match(report.markdown, /赛前运行 ID：prematch-run-42/);
  assert.match(report.markdown, new RegExp(`预测产物哈希：${predictionHash}`));
  assert.match(report.markdown, /阿森纳进球/);
  assert.match(report.markdown, /官方全场射门口径/);
  assert.match(report.markdown, /Brier 分数.*0\.31/s);
  assert.match(report.markdown, /策略 \| 禁止事后回写/);
  assert.match(report.markdown, /proposal-1/);
  assert.match(report.markdown, /待人工批准/);
  for (const [output, heading] of [[report.markdown, (name) => `## ${name}`], [report.html, (name) => `<h2>${name}</h2>`]]) {
    let cursor = -1;
    for (const name of sectionNames) {
      const next = output.indexOf(heading(name));
      assert.ok(next > cursor, `${name} 应按赛后固定顺序出现`);
      cursor = next;
    }
  }
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

test("报告 CLI 自动识别结构化 postmatch 夹具", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "football-postmatch-cli-"));
  const fixturePath = join(outputDirectory, "postmatch-fixture.json");
  const fixture = JSON.parse(await readFile(new URL("../assets/sample-data/club-league-snapshot.json", import.meta.url), "utf8"));
  fixture.evidenceAudit.accepted = [{
    claimId: "result-cli-1",
    topic: "result",
    subject: "ARS-CHE-2026-08-01",
    sourceUrl: "https://official.test/result",
    value: { homeGoals: 1, awayGoals: 0, decidedIn: "90min", observedAt: null }
  }];
  fixture.postmatch = {
    prematchBinding: { runId: "prematch-cli-run", predictionHash: "b".repeat(64) },
    actualResult: { homeGoals: 1, awayGoals: 0, decidedIn: "90min", sourceClaimId: "result-cli-1" }
  };
  await writeFile(fixturePath, JSON.stringify(fixture), "utf8");
  try {
    await execFileAsync(process.execPath, [fileURLToPath(new URL("../scripts/generate-report.mjs", import.meta.url)), "--fixture", fixturePath, "--out-dir", outputDirectory]);
    const markdown = await readFile(join(outputDirectory, "report.md"), "utf8");
    assert.match(markdown, /## 赛前运行绑定/);
    assert.match(markdown, /实际赛果：ARS 1–0 CHE/);
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
