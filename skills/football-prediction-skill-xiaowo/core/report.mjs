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

function marketProbabilities(market) {
  if (!market || typeof market !== "object") return null;
  const source = market.deVigProbabilities ?? market.fairProbabilities ?? market.probabilities ?? market;
  const values = { home: source.homeWinProb ?? source.home, draw: source.drawProb ?? source.draw, away: source.awayWinProb ?? source.away };
  return Object.values(values).every(Number.isFinite) ? values : null;
}

function marketBlocks(market, prediction) {
  const values = marketProbabilities(market);
  if (!values) return [paragraph("未提供经审计的市场概率，本报告不推算或填补市场数据。")];
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

function auditBlocks(audit = {}) {
  const missing = Array.isArray(audit.missing) && audit.missing.length ? audit.missing.join("、") : "无";
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
  return {
    kicker: "可审计足球预测 · 赛前",
    title: `${teams.home} vs ${teams.away}｜赛前预测报告`,
    meta: `数据截止：${text(manifest.dataCutoffAt)} · 模型：${text(prediction.modelVersion)}`,
    sections: [
      section("赛制与口径", "blue", [list([...regulationSummary(profile), "所有胜平负概率均限定常规时间90分钟（含补时）。"])]),
      section("执行结论", "green", [paragraph(leadingOutcome(prediction, teams)), paragraph(`数据置信度：${confidenceLabel(prediction.confidence)}。`)]),
      section("证据审计", evidenceAudit.status === "passed" ? "blue" : "red", auditBlocks(evidenceAudit)),
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
      section("市场比较", marketProbabilities(market) ? "blue" : "gold", marketBlocks(market, prediction)),
      section("淘汰赛分支", "gold", [paragraph(knockoutApplies ? "本节仅提示赛制存在90分钟后的晋级分支；当前模型不输出加时、点球或晋级概率。" : "本场赛制未提供适用的淘汰赛分支；不展示加时、点球或晋级概率。")]),
      section("不确定性与重算触发器", "red", [list(["官方首发或关键伤停发生变化", "赛制、开球时间或主客场口径变化", "出现截止时间内的新权威证据或现有证据冲突解除"])]),
      section("结论", "green", [paragraph(leadingOutcome(prediction, teams)), paragraph("请结合证据审计与缺失项阅读，不将低置信结果表述为确定赛果。")]),
      section("来源索引", "blue", sourceBlocks(evidenceAudit))
    ]
  };
}

function actualOutcome(actual = {}) {
  if (!Number.isInteger(actual.homeGoals) || !Number.isInteger(actual.awayGoals)) return null;
  return actual.homeGoals > actual.awayGoals ? "主胜" : actual.homeGoals < actual.awayGoals ? "客胜" : "平局";
}

function postmatchDocument(data = {}) {
  const { manifest = {}, prediction = {}, evidenceAudit = {}, market = null } = data;
  const actual = data.actualResult ?? data.record ?? data.result ?? {};
  const teams = teamNames(manifest);
  const outcome = actualOutcome(actual);
  const resultLine = outcome ? `实际赛果：${teams.home} ${actual.homeGoals}–${actual.awayGoals} ${teams.away}（${text(actual.decidedIn, "90min")}）` : "实际赛果：未提供，不能完成结果对照。";
  const realized = outcome === "主胜" ? prediction.homeWinProb : outcome === "平局" ? prediction.drawProb : outcome === "客胜" ? prediction.awayWinProb : null;
  const scores = scorelineRows(prediction);
  const exact = outcome && scores.some((row) => row[1] === `${actual.homeGoals}–${actual.awayGoals}`);
  return {
    kicker: "可审计足球预测 · 赛后",
    title: `${teams.home} vs ${teams.away}｜赛后复盘报告`,
    meta: `复盘口径：90分钟 · 原预测模型：${text(prediction.modelVersion)}`,
    sections: [
      section("实际赛果与口径", outcome ? "green" : "red", [paragraph(resultLine), list(regulationSummary(manifest.competitionProfile ?? {}))]),
      section("复盘摘要", "green", [paragraph(outcome ? `模型对实际${outcome}分配的赛前概率为 ${percent(realized)}。` : "缺少实际赛果，以下仅保留预测基线。")]),
      section("证据审计回放", evidenceAudit.status === "passed" ? "blue" : "red", auditBlocks(evidenceAudit)),
      section("预测与实赛对照", "blue", [table(["项目", "赛前预测", "实际"], [["结果", leadingOutcome(prediction, teams), outcome ?? "未提供"], ["比分", scores[0]?.[1] ?? "未提供", outcome ? `${actual.homeGoals}–${actual.awayGoals}` : "未提供"]])]),
      section("概率结果评估", "formula", [paragraph(outcome ? `实际结果的赛前分配概率：${percent(realized)}。复盘应评估概率校准，不以单场命中与否替代长期验证。` : "实际结果缺失，不能计算单场结果对应概率。")]),
      section("比分偏差", "blue", [paragraph(outcome ? `实际比分${exact ? "位于" : "未位于"}报告展示的前五个比分候选中。` : "实际比分缺失。")]),
      section("关键事件与战术复盘", "blue", claimBlocks(evidenceAudit, ["statistics", "tactics", "lineup", "injury"], "没有经审计的赛后关键事件或战术证据；不做叙事性补写。")),
      section("环境与赛程复盘", "gold", claimBlocks(evidenceAudit, ["weather", "schedule"], "没有经审计的环境或赛程事实可供归因。")),
      section("市场回看", marketProbabilities(market) ? "blue" : "gold", marketBlocks(market, prediction)),
      section("偏差归因与校准建议", "red", [list(["区分数据缺失、证据冲突与模型结构误差，不凭单场结果自动改权重。", "只有经人工确认、跨样本验证的修正建议才进入后续模型版本。", "保留原始预测、实际结果和来源索引以支持复核。"])]),
      section("复盘结论", "green", [paragraph(outcome ? `${resultLine}；本报告只评估原预测，不改写赛前概率。` : "复盘未完成：需要补充经审计的实际赛果。")]),
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
