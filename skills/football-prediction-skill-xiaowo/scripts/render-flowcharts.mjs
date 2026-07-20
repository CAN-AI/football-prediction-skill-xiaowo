#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDir = join(root, "assets");

const diagrams = [
  {
    file: "v3-lifecycle-flow.png",
    kicker: "V3 / PREMATCH TO POSTMATCH",
    title: "可审计预测生命周期",
    subtitle: "能力先行 · 证据入账 · 同源交付 · 赛后只追加",
    nodes: [
      ["01", "能力预检", "网络 / Node.js / PNG 渲染器"],
      ["02", "赛事画像", "主客身份 / 赛制 / 基线版本"],
      ["03", "证据审计", "截止时间 / 来源 / 冲突隔离"],
      ["04", "90 分钟预测", "概率 / xG / 输入哈希"],
      ["05", "同源报告", "report.md + report-long.png"],
      ["06", "不可变发布", "清单哈希 / 新 runId / 禁止覆盖"],
      ["07", "赛后治理", "事实绑定 / 30 场 / 人工批准"]
    ],
    footer: "任何正式步骤失败，均停在当前门禁；不以占位内容继续。"
  },
  {
    file: "v3-conflict-degrade-flow.png",
    kicker: "V3 / EVIDENCE GATE",
    title: "冲突隔离与缺失降级",
    subtitle: "不猜测 · 不平均 · 不把传闻写成事实",
    nodes: [
      ["01", "读取证据台账", "claim ID / topic / subject / 时间"],
      ["02", "来源与截止门禁", "拒绝越界、未知与未确认证据"],
      ["03", "口径冲突检测", "指标版本 / 事件源是否一致"],
      ["04", "完整性检查", "精确列出 missing 与 attempted sources"],
      ["05", "状态决议", "passed / degraded_low_confidence / failed"],
      ["06", "报告边界", "低置信 + 缺失项 + 重算触发器"],
      ["07", "资料恢复", "声明缺口后请求最小必要上传"]
    ],
    footer: "冲突证据整组隔离；没有网络能力时明确写“未检索”。"
  },
  {
    file: "v3-lineage-flow.png",
    kicker: "V3 / IMMUTABLE LINEAGE",
    title: "不可变运行血缘",
    subtitle: "一个输入快照 · 一个运行身份 · 一组可验证产物",
    nodes: [
      ["01", "截止输入", "赛事画像 + 证据账本 + SHA-256"],
      ["02", "运行身份", "runId / parentRunId / modelVersion"],
      ["03", "审计与预测", "audited-snapshot.json → prediction.json"],
      ["04", "报告产物", "Markdown / HTML / PNG / render audit"],
      ["05", "最终清单", "逐文件路径、字节数与 SHA-256"],
      ["06", "赛后记录", "引用原 runId 与 prediction hash"],
      ["07", "新版本分支", "人工批准后创建新快照与新运行"]
    ],
    footer: "历史预测不得回写；实际结果只追加为可追溯的赛后事实。"
  }
];

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function htmlFor(diagram) {
  const nodes = diagram.nodes.map(([number, title, detail], index) => `
    <li>
      <span class="number">${number}</span>
      <span class="copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></span>
      ${index < diagram.nodes.length - 1 ? '<span class="arrow" aria-hidden="true">→</span>' : ""}
    </li>`).join("");

  return `<!doctype html>
  <html lang="zh-CN"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box} html,body{margin:0;width:1440px;height:900px;overflow:hidden;background:#f8f8f6}
    body{font-family:"Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC",Arial,sans-serif;color:#171717}
    main{position:relative;width:100%;height:100%;padding:68px 76px;background:
      linear-gradient(90deg,rgba(184,18,29,.045) 1px,transparent 1px),
      linear-gradient(rgba(184,18,29,.045) 1px,transparent 1px),#f8f8f6;background-size:36px 36px}
    main:before{content:"";position:absolute;left:0;top:0;width:18px;height:100%;background:#b8121d}
    header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #b8121d;padding-bottom:24px}
    .kicker{font:700 16px/1.2 Consolas,monospace;letter-spacing:.17em;color:#b8121d}
    h1{margin:9px 0 8px;font-size:48px;line-height:1.1;letter-spacing:.03em}
    .subtitle{margin:0;color:#5c5c5c;font-size:19px;letter-spacing:.06em}
    .mark{width:112px;height:72px;border:2px solid #b8121d;color:#b8121d;display:grid;place-items:center;font:800 26px/1 Consolas,monospace;background:#fff}
    ol{list-style:none;margin:46px 0 34px;padding:0;display:grid;grid-template-columns:repeat(4,1fr);gap:24px 46px}
    li{position:relative;min-height:196px;background:#fff;border:1px solid #d7d1cd;border-top:7px solid #b8121d;padding:25px 20px 20px;box-shadow:0 8px 0 rgba(23,23,23,.05)}
    .number{display:block;font:800 17px/1 Consolas,monospace;color:#b8121d;margin-bottom:31px}
    .copy strong{display:block;font-size:25px;line-height:1.2;margin-bottom:14px}
    .copy small{display:block;color:#5c5c5c;font-size:16px;line-height:1.55}
    .arrow{position:absolute;right:-39px;top:79px;color:#b8121d;font:800 31px/1 Consolas,monospace;z-index:2}
    li:nth-child(4) .arrow{right:calc(50% - 16px);top:auto;bottom:-39px;transform:rotate(90deg)} li:nth-child(5){grid-column:4} li:nth-child(6){grid-column:3;grid-row:2} li:nth-child(7){grid-column:2;grid-row:2}
    li:nth-child(5) .arrow,li:nth-child(6) .arrow{right:auto;left:-39px;transform:rotate(180deg)}
    footer{position:absolute;left:76px;right:76px;bottom:43px;display:flex;align-items:center;gap:14px;border-top:1px solid #c7c1bd;padding-top:18px;font-size:17px;color:#4b4b4b}
    footer:before{content:"RULE";font:800 14px/1 Consolas,monospace;color:white;background:#b8121d;padding:8px 10px;letter-spacing:.12em}
  </style></head><body><main>
    <header><div><div class="kicker">${escapeHtml(diagram.kicker)}</div><h1>${escapeHtml(diagram.title)}</h1><p class="subtitle">${escapeHtml(diagram.subtitle)}</p></div><div class="mark">V3</div></header>
    <ol>${nodes}</ol><footer>${escapeHtml(diagram.footer)}</footer>
  </main></body></html>`;
}

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  for (const diagram of diagrams) {
    await page.setContent(htmlFor(diagram), { waitUntil: "load" });
    await page.screenshot({ path: join(outputDir, diagram.file), type: "png", animations: "disabled" });
    console.log(`已生成 ${diagram.file}`);
  }
} finally {
  await browser.close();
}
