#!/usr/bin/env node

import { join } from "node:path";
import { runPostmatchPipeline } from "../core/pipeline.mjs";

const USAGE = "用法：node run-postmatch-pipeline.mjs --prematch-run-dir <赛前运行目录> --input <赛后输入.json> --out-dir <输出根目录>";

function parseArguments(argumentsList) {
  const flags = ["--prematch-run-dir", "--input", "--out-dir"];
  if (argumentsList.length !== flags.length * 2) return null;
  const values = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const flag = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!flags.includes(flag) || !value || values[flag]) return null;
    values[flag] = value;
  }
  return flags.every((flag) => values[flag]) ? {
    prematchRunDir: values["--prematch-run-dir"],
    input: values["--input"],
    outDir: values["--out-dir"]
  } : null;
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (!options) throw new Error(USAGE);
  const result = await runPostmatchPipeline(options);
  console.log(`赛后流水线完成：${join(result.runDirectory, "run-manifest.json")}`);
} catch (error) {
  console.error(`赛后流水线失败：${error.message}`);
  process.exitCode = 1;
}
