#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { V3_SKILL_VERSION } from "../skills/football-prediction-skill-xiaowo/core/constants.mjs";

const [command, ...commandArguments] = process.argv.slice(2);
const COMMAND_SCRIPTS = Object.freeze({
  audit: "audit-evidence.mjs",
  predict: "predict-match.mjs",
  report: "generate-report.mjs",
  pipeline: "run-pipeline.mjs",
  record: "record-result.mjs",
  calibrate: "propose-calibration.mjs"
});

function printHelp() {
  console.log("小蜗通用足球预测 v3");
  console.log("用法：football-xiaowo <command> [...参数]");
  console.log("命令：");
  console.log("  audit      审计证据账本");
  console.log("  predict    生成 90 分钟预测 JSON");
  console.log("  report     生成赛前报告或复验已定稿赛后父子运行");
  console.log("  pipeline   运行不可变赛前发布流水线");
  console.log("  record     从原始赛后账本生成审计记录");
  console.log("  calibrate  从已复验父子运行生成 30 场门槛校准提案");
  console.log("  --version  输出 v3 版本");
  console.log("运行 football-xiaowo <command> 可查看该命令的完整参数用法。");
}

async function dispatch(scriptName) {
  const scriptPath = fileURLToPath(new URL(`../skills/football-prediction-skill-xiaowo/scripts/${scriptName}`, import.meta.url));
  const child = spawn(process.execPath, [scriptPath, ...commandArguments], { stdio: "inherit" });
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  if (result.signal) {
    console.error(`命令被信号 ${result.signal} 终止。`);
    process.exitCode = 1;
  } else {
    process.exitCode = result.code ?? 1;
  }
}

if (command === "--version") {
  console.log(V3_SKILL_VERSION);
} else if (!command || command === "--help") {
  printHelp();
} else if (COMMAND_SCRIPTS[command]) {
  await dispatch(COMMAND_SCRIPTS[command]);
} else {
  console.error(`未知命令：${command}。请运行 --help 查看用法。`);
  process.exitCode = 1;
}
