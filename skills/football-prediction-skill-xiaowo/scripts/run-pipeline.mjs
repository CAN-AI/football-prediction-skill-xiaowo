#!/usr/bin/env node

import { join } from "node:path";
import { runPrematchPipeline } from "../core/pipeline.mjs";

const USAGE = "用法：node run-pipeline.mjs --input <输入.json> --out-dir <输出根目录>";

function parseArguments(argumentsList) {
  if (argumentsList.length !== 4) return null;
  const values = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const flag = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!['--input', '--out-dir'].includes(flag) || !value || values[flag]) return null;
    values[flag] = value;
  }
  return values["--input"] && values["--out-dir"]
    ? { input: values["--input"], outDir: values["--out-dir"] }
    : null;
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (!options) throw new Error(USAGE);
  const result = await runPrematchPipeline(options);
  console.log(`赛前流水线完成：${join(result.runDirectory, "run-manifest.json")}`);
} catch (error) {
  console.error(`赛前流水线失败：${error.message}`);
  process.exitCode = 1;
}
