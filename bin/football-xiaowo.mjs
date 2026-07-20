#!/usr/bin/env node

import { V3_SKILL_VERSION } from "../skills/football-prediction-skill-xiaowo/core/constants.mjs";

const [command] = process.argv.slice(2);

function printHelp() {
  console.log("小蜗通用足球预测 v3");
  console.log("用法：football-xiaowo [--version|--help]");
  console.log("完整流水线将在 v3 包安装后可用。");
}

if (command === "--version") {
  console.log(V3_SKILL_VERSION);
} else if (!command || command === "--help") {
  printHelp();
} else {
  console.error(`未知命令：${command}。请运行 --help 查看用法。`);
  process.exitCode = 1;
}
