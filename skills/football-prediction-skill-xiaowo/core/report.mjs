import { contentHash } from "./utils.mjs";

const REPORT_CSS = String.raw`
:root{color-scheme:light;--navy:#071b36;--navy2:#0a2a52;--navy3:#123f73;--blue:#e8f3ff;--line:#c8d9ec;--ink:#132238;--muted:#58708c;--green:#e5f6ed;--red:#ffebed;--gold:#fff4d5;--formula:#0b1729}
*{box-sizing:border-box}
html,body{margin:0;width:100%;min-width:0;background:#dce8f5;color:var(--ink)}
body{font-family:"Noto Sans CJK SC","Microsoft YaHei","PingFang SC","Source Han Sans SC",sans-serif;font-size:14px;line-height:1.62;overflow-x:hidden}
.report-shell{width:100%;max-width:430px;min-width:0;margin:0 auto;background:#f8fbff}
.report-cover{padding:30px 22px 24px;background:linear-gradient(145deg,var(--navy),var(--navy3));color:#fff}
.report-kicker{margin:0 0 8px;color:#9fd1ff;font-size:11px;font-weight:800;letter-spacing:.14em}
h1{margin:0;font-size:27px;line-height:1.22;letter-spacing:-.02em;text-wrap:pretty}
.report-meta{margin:16px 0 0;color:#d8eaff;font-size:12px}
main{padding:14px 12px 28px}
.report-card{min-width:0;margin:0 0 12px;padding:16px;border:1px solid var(--line);border-radius:12px;background:#fff;box-shadow:0 5px 16px rgba(10,42,82,.06)}
.report-card.tone-blue{background:var(--blue)}
.report-card.tone-green{background:var(--green);border-color:#abd8c1}
.report-card.tone-red{background:var(--red);border-color:#efb2b8}
.report-card.tone-gold{background:var(--gold);border-color:#ead295}
.report-card.tone-formula{background:var(--formula);border-color:#273952;color:#edf5ff}
.section-head{display:flex;align-items:baseline;gap:10px;margin:0 0 10px}
.section-index{flex:0 0 auto;color:var(--navy3);font:800 11px/1 ui-monospace,"Cascadia Mono",monospace}
.tone-formula .section-index{color:#79bfff}
h2{margin:0;font-size:17px;line-height:1.35;color:var(--navy);text-wrap:pretty}
.tone-formula h2{color:#fff}
p{margin:7px 0;overflow-wrap:anywhere;text-wrap:pretty}
ul{margin:7px 0;padding-left:20px}
li{margin:4px 0;overflow-wrap:anywhere}
.report-table-wrap{width:100%;min-width:0;overflow-x:hidden;margin:10px 0 4px;border:1px solid var(--line);border-radius:8px;background:#fff}
table{width:100%;max-width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px}
th,td{padding:9px 7px;border-bottom:1px solid #dce7f3;text-align:left;vertical-align:top;overflow-wrap:anywhere;word-break:break-word}
th{background:var(--navy2);color:#fff;font-weight:750}
tr:last-child td{border-bottom:0}
.tone-formula .report-table-wrap{border-color:#324862}
.tone-formula table{color:var(--ink)}
a{color:#0d5da8;overflow-wrap:anywhere}
.report-footer{padding:0 18px 22px;color:var(--muted);font-size:11px}
@media(max-width:360px){.report-cover{padding-inline:17px}main{padding-inline:8px}.report-card{padding:13px}h1{font-size:24px}th,td{padding-inline:5px;font-size:11px}}
`;

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function percent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "未提供";
}

function fixed(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "未提供";
}

function text(value, fallback = "未提供") {
  return value === undefined || value === null || value === "" ? fallback : String(value);
}

function teamNames(manifest = {}) {
  const match = manifest.match ?? {};
  return {
    home: match.homeTeamName ?? match.homeTeamId ?? "主队",
    away: match.awayTeamName ?? match.awayTeamId ?? "客队"
  };
}

function confidenceLabel(confidence) {
  return ({ high: "高", medium: "中", low: "低", unavailable: "不可用" })[confidence?.level ?? confidence] ?? "未提供";
}

function auditLabel(status) {
  return ({ passed: "通过", degraded_low_confidence: "降级为低置信", failed: "失败" })[status] ?? text(status);
}

function acceptedClaims(audit = {}) {
  return Array.isArray(audit.accepted) ? audit.accepted : [];
}

function claimsFor(audit, topics) {
  const allowed = new Set(topics);
  return acceptedClaims(audit).filter((claim) => allowed.has(claim?.topic));
}

function claimSummary(claim) {
  const fields = [claim.claimId, claim.subject, claim.value].filter((value) => value !== undefined && value !== null && value !== "");
  return fields.length ? fields.map((value) => typeof value === "object" ? JSON.stringify(value) : String(value)).join("｜") : "已接受证据";
}

const paragraph = (value) => ({ type: "paragraph", text: value });
const list = (items) => ({ type: "list", items });
const table = (headers, rows) => ({ type: "table", headers, rows });
const section = (title, tone, blocks) => ({ title, tone, blocks });

function claimBlocks(audit, topics, emptyText) {
  const claims = claimsFor(audit, topics);
  return claims.length ? [list(claims.map(claimSummary))] : [paragraph(emptyText)];
}

function regulationSummary(profile = {}) {
  const regulation = profile.regulation ?? {};
  const family = ({ league: "联赛", domestic_cup: "国内杯赛", continental_club: "洲际俱乐部赛事", national_tournament: "国家队赛事", friendly: "友谊赛" })[profile.family] ?? text(profile.family);
  const flag = (value) => value === true ? "是" : value === false ? "否" : "未提供";
  return [
    `赛事：${text(profile.competitionId)}`,
    `类型：${family}`,
    `两回合：${flag(regulation.twoLegged)}`,
    `加时：${flag(regulation.extraTime)}`,
    `点球：${flag(regulation.penalties)}`
  ];
}

function leadingOutcome(prediction = {}, teams) {
  const values = [
    ["主胜", prediction.homeWinProb, teams.home],
    ["平局", prediction.drawProb, "平局"],
    ["客胜", prediction.awayWinProb, teams.away]
  ].filter(([, value]) => Number.isFinite(value)).sort((left, right) => right[1] - left[1]);
  if (!values.length) return "未提供可用的90分钟概率，不能形成方向判断。";
  return `90分钟概率最高项为${values[0][0]}（${values[0][2]}，${percent(values[0][1])}），这不是确定赛果。`;
}

function scorelineRows(prediction = {}) {
  if (!Array.isArray(prediction.scoreMatrix)) return [];
  return prediction.scoreMatrix
    .filter((item) => Number.isInteger(item?.homeGoals) && Number.isInteger(item?.awayGoals) && Number.isFinite(item?.probability))
    .sort((left, right) => right.probability - left.probability).slice(0, 5)
    .map((item, index) => [String(index + 1), `${item.homeGoals}–${item.awayGoals}`, percent(item.probability)]);
}

function hasSource(source) {
  if (typeof source === "string") return source.trim().length > 0;
  if (!source || typeof source !== "object") return false;
  return [source.name, source.url, source.id].some((value) => typeof value === "string" && value.trim());
}

function auditMarket(market) {
  if (!market || typeof market !== "object") return { values: null, issues: ["市场数据未提供"] };
  const issues = [];
  const scope = market.scope ?? market.resultScope;
  const probabilityType = market.probabilityType ?? market.method;
  const scopeText = typeof scope === "string" ? scope.toLowerCase() : "";
  const typeText = typeof probabilityType === "string" ? probabilityType.toLowerCase() : "";
  const is90Minutes = ["90min", "90_minutes", "regulation_90min"].includes(scopeText) || /90.*min/.test(scopeText);
  const isDeVig = market.deVig === true || market.isDeVig === true || ["de_vig", "de-vig", "devig", "fair"].includes(typeText) || /de.?vig|去水/.test(scopeText);
  if (market.audited !== true) issues.push("市场审计状态未通过");
  if (!is90Minutes || !isDeVig) issues.push("市场口径不是90分钟去水概率");
  if (typeof market.observedAt !== "string" || !market.observedAt.trim() || Number.isNaN(Date.parse(market.observedAt))) issues.push("市场观察时间缺失或无效");
  if (!hasSource(market.source) && !hasSource(market.sourceUrl)) issues.push("市场来源缺失");
  const source = market.deVigProbabilities ?? market.fairProbabilities ?? market.probabilities ?? market;
  const values = { home: source.homeWinProb ?? source.home, draw: source.drawProb ?? source.draw, away: source.awayWinProb ?? source.away };
  const probabilities = Object.values(values);
  if (!probabilities.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) issues.push("市场概率超出合法范围");
  else if (Math.abs(probabilities.reduce((total, value) => total + value, 0) - 1) > 0.001) issues.push("市场概率未归一");
  return { values: issues.length ? null : values, issues };
}

function marketBlocks(marketAudit, prediction) {
  const { values } = marketAudit;
  if (!values) return [paragraph("市场数据未通过审计门禁，本报告不显示、推算或填补市场概率。")];
  const delta = (model, external) => Number.isFinite(model) ? `${((model - external) * 100).toFixed(1)} 个百分点` : "未提供";
  return [
    paragraph(`市场去水概率：主胜 ${percent(values.home)} · 平局 ${percent(values.draw)} · 客胜 ${percent(values.away)}`),
    table(["结果", "模型", "市场", "模型－市场"], [
      ["主胜", percent(prediction.homeWinProb), percent(values.home), delta(prediction.homeWinProb, values.home)],
      ["平局", percent(prediction.drawProb), percent(values.draw), delta(prediction.drawProb, values.draw)],
      ["客胜", percent(prediction.awayWinProb), percent(values.away), delta(prediction.awayWinProb, values.away)]
    ])
  ];
}

function auditBlocks(audit = {}, additionalMissing = []) {
  const originalMissing = Array.isArray(audit.missing) ? audit.missing : [];
  const combinedMissing = [...originalMissing, ...additionalMissing];
  const missing = combinedMissing.length ? combinedMissing.join("、") : "无";
  return [list([
    `审计状态：${auditLabel(audit.status)}`,
    `已接受证据：${acceptedClaims(audit).length} 条`,
    `未接受证据：${Array.isArray(audit.rejected) ? audit.rejected.length : 0} 条（不作为报告事实）`,
    `缺失信息：${missing}`,
    `隔离冲突：${Array.isArray(audit.conflicts) ? audit.conflicts.length : 0} 组`
  ])];
}

function sourceBlocks(audit = {}) {
  const claims = acceptedClaims(audit);
  if (!claims.length) return [paragraph("没有可列出的已接受来源。")];
  return [table(["证据", "主题", "主体", "来源"], claims.map((claim) => [
    text(claim.claimId), text(claim.topic), text(claim.subject), text(claim.sourceUrl)
  ]))];
}

function prematchDocument(data = {}) {
  const { manifest = {}, prediction = {}, evidenceAudit = {}, market = null } = data;
  const teams = teamNames(manifest);
  const profile = manifest.competitionProfile ?? {};
  const scores = scorelineRows(prediction);
  const regulation = profile.regulation ?? {};
  const knockoutApplies = profile.family && profile.family !== "league" && (regulation.extraTime || regulation.penalties || regulation.twoLegged);
  const marketAudit = auditMarket(market);
  return {
    kicker: "可审计足球预测 · 赛前",
    title: `${teams.home} vs ${teams.away}｜赛前预测报告`,
    meta: `数据截止：${text(manifest.dataCutoffAt)} · 模型：${text(prediction.modelVersion)}`,
    sections: [
      section("赛制与口径", "blue", [list([...regulationSummary(profile), "所有胜平负概率均限定常规时间90分钟（含补时）。"])]),
      section("执行结论", "green", [paragraph(leadingOutcome(prediction, teams)), paragraph(`数据置信度：${confidenceLabel(prediction.confidence)}。`)]),
      section("证据审计", evidenceAudit.status === "passed" && marketAudit.values ? "blue" : "red", auditBlocks(evidenceAudit, marketAudit.issues)),
      section("实力与状态", "blue", claimBlocks(evidenceAudit, ["statistics", "xg"], "没有进入审计账本的实力或近期状态证据；不做补写。")),
      section("人员可用性", "red", claimBlocks(evidenceAudit, ["lineup", "injury"], "未获得可作为事实展示的已接受首发或伤停证据。")),
      section("战术对位", "blue", claimBlocks(evidenceAudit, ["tactics"], "没有经审计的战术对位事实；不根据阵型名称自行推断。")),
      section("环境因素", "gold", claimBlocks(evidenceAudit, ["weather", "schedule"], "没有经审计的天气或赛程环境信息。")),
      section("方法说明", "formula", [list([
        `模型版本：${text(prediction.modelVersion)}`,
        `赛事基线版本：${text(prediction.trace?.baselineVersion)}`,
        `预期进球：${teams.home} ${fixed(prediction.expectedGoals?.home)}；${teams.away} ${fixed(prediction.expectedGoals?.away)}`,
        "胜平负由已归一化比分矩阵汇总；概率不是确定性承诺。"
      ])]),
      section("90分钟胜平负概率", "blue", [table(["主胜", "平局", "客胜"], [[percent(prediction.homeWinProb), percent(prediction.drawProb), percent(prediction.awayWinProb)]])]),
      section("比分候选", "blue", scores.length ? [table(["排序", "比分", "概率"], scores)] : [paragraph("没有可展示的已审计比分矩阵。")]),
      section("市场比较", marketAudit.values ? "blue" : "gold", marketBlocks(marketAudit, prediction)),
      section("淘汰赛分支", "gold", [paragraph(knockoutApplies ? "本节仅提示赛制存在90分钟后的晋级分支；当前模型不输出加时、点球或晋级概率。" : "本场赛制未提供适用的淘汰赛分支；不展示加时、点球或晋级概率。")]),
      section("不确定性与重算触发器", "red", [list(["官方首发或关键伤停发生变化", "赛制、开球时间或主客场口径变化", "出现截止时间内的新权威证据或现有证据冲突解除"])]),
      section("结论", "green", [paragraph(leadingOutcome(prediction, teams)), paragraph("请结合证据审计与缺失项阅读，不将低置信结果表述为确定赛果。")]),
      section("来源索引", "blue", sourceBlocks(evidenceAudit))
    ]
  };
}

function actualOutcome(actual = {}) {
  if (!Number.isInteger(actual.homeGoals) || actual.homeGoals < 0 || !Number.isInteger(actual.awayGoals) || actual.awayGoals < 0) return null;
  return actual.homeGoals > actual.awayGoals ? "主胜" : actual.homeGoals < actual.awayGoals ? "客胜" : "平局";
}

function acceptedClaimMap(audit = {}) {
  return new Map(acceptedClaims(audit).filter((claim) => typeof claim?.claimId === "string" && claim.claimId).map((claim) => [claim.claimId, claim]));
}

function matchIdentities(manifest = {}) {
  const match = manifest.match ?? {};
  if (typeof match.matchId === "string" && match.matchId) return new Set([match.matchId]);
  const identities = [
    match.homeTeamId && match.awayTeamId ? `${match.homeTeamId}-${match.awayTeamId}` : null,
    match.homeTeamId && match.awayTeamId ? `${match.homeTeamId} vs ${match.awayTeamId}` : null,
    match.homeTeamName && match.awayTeamName ? `${match.homeTeamName}-${match.awayTeamName}` : null,
    match.homeTeamName && match.awayTeamName ? `${match.homeTeamName} vs ${match.awayTeamName}` : null
  ].filter(Boolean);
  return new Set(identities);
}

function claimMatchesReportMatch(claim, manifest) {
  const identity = claim?.matchId ?? claim?.match?.matchId ?? claim?.subject;
  return typeof identity === "string" && matchIdentities(manifest).has(identity);
}

function canonicalFact(kind, value = {}) {
  if (!value || typeof value !== "object") return null;
  if (kind === "result") {
    if (!Number.isInteger(value.homeGoals) || value.homeGoals < 0 || !Number.isInteger(value.awayGoals) || value.awayGoals < 0) return null;
    return {
      homeGoals: value.homeGoals,
      awayGoals: value.awayGoals,
      decidedIn: value.decidedIn ?? null,
      observedAt: value.observedAt ?? null
    };
  }
  if (kind === "event") {
    if (typeof (value.event ?? value.description) !== "string" || !(value.event ?? value.description).trim()) return null;
    return {
      minute: Number.isFinite(value.minute) ? value.minute : null,
      occurredAt: value.occurredAt ?? null,
      event: value.event ?? value.description,
      teamId: value.teamId ?? null,
      teamName: value.teamName ?? null
    };
  }
  if (kind === "statistics") {
    if (typeof value.metric !== "string" || !value.metric.trim()) return null;
    return {
      metric: value.metric,
      home: value.home ?? null,
      away: value.away ?? null,
      definition: value.definition ?? value.metricDefinition ?? null
    };
  }
  return null;
}

function factFingerprint(kind, value) {
  const canonical = canonicalFact(kind, value);
  return canonical ? contentHash({ kind, value: canonical }) : null;
}

function boundClaim(item, claims, { topic, kind, manifest }) {
  const claimId = item?.sourceClaimId ?? item?.claimId;
  if (typeof claimId !== "string" || !claimId) return null;
  const claim = claims.get(claimId);
  if (!claim || claim.topic !== topic || !claimMatchesReportMatch(claim, manifest)) return null;
  const displayedFingerprint = factFingerprint(kind, item);
  const acceptedFingerprint = factFingerprint(kind, claim.value);
  if (!displayedFingerprint || !acceptedFingerprint || displayedFingerprint !== acceptedFingerprint) return null;
  if (claim.factFingerprint && claim.factFingerprint !== acceptedFingerprint) return null;
  return claim;
}

function outcomeProbability(outcome, prediction) {
  if (outcome === "主胜") return prediction.homeWinProb;
  if (outcome === "平局") return prediction.drawProb;
  if (outcome === "客胜") return prediction.awayWinProb;
  return null;
}

function predictedOutcome(prediction = {}) {
  const values = [["主胜", prediction.homeWinProb], ["平局", prediction.drawProb], ["客胜", prediction.awayWinProb]]
    .filter(([, value]) => Number.isFinite(value)).sort((left, right) => right[1] - left[1]);
  return values[0]?.[0] ?? null;
}

function timelineBlocks(items, claims, manifest) {
  const accepted = Array.isArray(items) ? items.filter((item) => boundClaim(item, claims, { topic: "event", kind: "event", manifest })) : [];
  if (!accepted.length) return [paragraph("事件时间线：未提供。")];
  return [table(["时间", "事件", "球队", "来源证据"], accepted.map((item) => [
    Number.isFinite(item.minute) ? `${item.minute}′` : text(item.occurredAt),
    text(item.event ?? item.description),
    text(item.teamName ?? item.teamId),
    text(item.sourceClaimId ?? item.claimId)
  ]))];
}

function statisticsBlocks(items, claims, manifest) {
  const accepted = Array.isArray(items) ? items.filter((item) => boundClaim(item, claims, { topic: "statistics", kind: "statistics", manifest })) : [];
  if (!accepted.length) return [paragraph("过程统计：未提供。"), paragraph("来源口径：未提供。")];
  return [table(["指标", "主队", "客队", "来源口径", "来源证据"], accepted.map((item) => [
    text(item.metric), text(item.home), text(item.away), text(item.definition ?? item.metricDefinition), text(item.sourceClaimId ?? item.claimId)
  ]))];
}

function calibrationBlocks(metrics = {}) {
  return [table(["指标", "值"], [
    ["Brier 分数", Number.isFinite(metrics.brierScore) ? fixed(metrics.brierScore, 4) : "未提供"],
    ["对数损失", Number.isFinite(metrics.logLoss) ? fixed(metrics.logLoss, 4) : "未提供"],
    ["样本量", Number.isInteger(metrics.sampleSize) && metrics.sampleSize >= 0 ? String(metrics.sampleSize) : "未提供"],
    ["评估窗口", text(metrics.evaluationWindow)],
    ["指标版本", text(metrics.version ?? metrics.method)]
  ])];
}

function statusLabel(status) {
  return ({ pending: "待人工批准", pending_human_review: "待人工复核", approved: "已批准", rejected: "已拒绝" })[status] ?? text(status);
}

function proposalBlocks(proposal = {}) {
  return [table(["字段", "值"], [
    ["提案 ID", text(proposal.proposalId)],
    ["状态", statusLabel(proposal.status)],
    ["摘要", text(proposal.summary)],
    ["创建时间", text(proposal.createdAt)]
  ]), paragraph("修正提案不会自动修改模型；只有人工批准且完成跨样本验证后，才可进入后续版本。")];
}

function approvalBlocks(approvals) {
  if (!Array.isArray(approvals) || !approvals.length) return [paragraph("人工批准项：未提供。")];
  return [table(["项目", "审批状态", "审批人", "决定时间"], approvals.map((item) => [
    text(item.itemId ?? item.proposalId), statusLabel(item.status), text(item.approver ?? item.approvedBy), text(item.decidedAt ?? item.approvedAt)
  ]))];
}

function postmatchDocument(data = {}) {
  const { manifest = {}, prediction = {}, evidenceAudit = {} } = data;
  const postmatch = data.postmatch ?? {};
  const binding = postmatch.prematchBinding ?? {};
  const claims = acceptedClaimMap(evidenceAudit);
  const candidateResult = postmatch.actualResult ?? data.actualResult ?? data.record ?? data.result ?? {};
  const actual = boundClaim(candidateResult, claims, { topic: "result", kind: "result", manifest }) ? candidateResult : {};
  const teams = teamNames(manifest);
  const outcome = actualOutcome(actual);
  const resultLine = outcome ? `实际赛果：${teams.home} ${actual.homeGoals}–${actual.awayGoals} ${teams.away}（${text(actual.decidedIn)}）` : "实际赛果：未提供。";
  const realized = outcomeProbability(outcome, prediction);
  const forecast = predictedOutcome(prediction);
  const runId = binding.runId ?? postmatch.prematchRunId ?? manifest.parentRunId;
  const predictionHash = binding.predictionHash ?? postmatch.predictionHash ?? manifest.artifacts?.prediction?.sha256;
  const rewrite = postmatch.noPosthocRewrite ?? {};
  return {
    kicker: "可审计足球预测 · 赛后",
    title: `${teams.home} vs ${teams.away}｜赛后复盘报告`,
    meta: `复盘口径：90分钟 · 原预测模型：${text(prediction.modelVersion)}`,
    sections: [
      section("赛前运行绑定", runId && predictionHash ? "blue" : "red", [list([`赛前运行 ID：${text(runId)}`, `预测产物哈希：${text(predictionHash)}`])]),
      section("赛果事实与事件时间线", outcome ? "green" : "red", [paragraph(resultLine), paragraph(`赛果观察时间：${outcome ? text(actual.observedAt) : "未提供"}`), paragraph(`赛果来源证据：${outcome ? text(actual.sourceClaimId ?? actual.claimId) : "未提供"}`), ...timelineBlocks(postmatch.eventTimeline, claims, manifest)]),
      section("过程统计与来源口径", "blue", statisticsBlocks(postmatch.processStatistics, claims, manifest)),
      section("预测命中审计", "formula", [table(["项目", "值"], [
        ["赛前最高概率结果", text(forecast)],
        ["实际90分钟结果", text(outcome)],
        ["方向命中", outcome && forecast ? (outcome === forecast ? "是" : "否") : "未提供"],
        ["实际结果赛前概率", outcome ? percent(realized) : "未提供"]
      ])]),
      section("校准指标", "formula", calibrationBlocks(postmatch.calibrationMetrics)),
      section("禁止事后回写", rewrite.enforced === true && rewrite.predictionHashUnchanged === true ? "green" : "red", [table(["项目", "状态"], [
        ["策略", "禁止事后回写"],
        ["执行状态", rewrite.enforced === true ? "已执行" : rewrite.enforced === false ? "未执行" : "未提供"],
        ["预测哈希保持不变", rewrite.predictionHashUnchanged === true ? "是" : rewrite.predictionHashUnchanged === false ? "否" : "未提供"]
      ])]),
      section("修正提案", "gold", proposalBlocks(postmatch.revisionProposal)),
      section("人工批准项", "red", approvalBlocks(postmatch.humanApprovals ?? postmatch.approvals)),
      section("来源索引", "blue", sourceBlocks(evidenceAudit))
    ]
  };
}

function markdownTable(block) {
  const header = `| ${block.headers.join(" | ")} |`;
  const divider = `| ${block.headers.map(() => "---").join(" | ")} |`;
  const rows = block.rows.map((row) => `| ${row.map((cell) => text(cell).replaceAll("|", "\\|")).join(" | ")} |`);
  return [header, divider, ...rows].join("\n");
}

function markdownBlocks(blocks) {
  return blocks.map((block) => block.type === "paragraph" ? block.text : block.type === "list" ? block.items.map((item) => `- ${item}`).join("\n") : markdownTable(block)).join("\n\n");
}

function renderMarkdown(document) {
  return [`# ${document.title}`, "", document.meta, "", ...document.sections.flatMap((item) => [`## ${item.title}`, "", markdownBlocks(item.blocks), ""])].join("\n").trimEnd() + "\n";
}

function htmlBlock(block) {
  if (block.type === "paragraph") return `<p>${escapeHtml(block.text)}</p>`;
  if (block.type === "list") return `<ul>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  const head = `<thead><tr>${block.headers.map((item) => `<th scope="col">${escapeHtml(item)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${block.rows.map((row) => `<tr>${row.map((item) => `<td>${escapeHtml(item)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<div class="report-table-wrap"><table>${head}${body}</table></div>`;
}

function renderHtml(document) {
  const cards = document.sections.map((item, index) => `<section class="report-card tone-${item.tone}" data-section="${escapeHtml(item.title)}"><div class="section-head"><span class="section-index">${String(index + 1).padStart(2, "0")}</span><h2>${escapeHtml(item.title)}</h2></div>${item.blocks.map(htmlBlock).join("")}</section>`).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(document.title)}</title><style>${REPORT_CSS}</style></head><body><article class="report-shell"><header class="report-cover"><p class="report-kicker">${escapeHtml(document.kicker)}</p><h1>${escapeHtml(document.title)}</h1><p class="report-meta">${escapeHtml(document.meta)}</p></header><main>${cards}</main><footer class="report-footer">仅展示本次运行中可审计的信息；缺失项保持为空，不做事实补全。</footer></article></body></html>\n`;
}

function buildReport(document) {
  return { markdown: renderMarkdown(document), html: renderHtml(document), document };
}

export function buildPrematchReport(data = {}) {
  return buildReport(prematchDocument(data));
}

export function buildPostmatchReport(data = {}) {
  return buildReport(postmatchDocument(data));
}
