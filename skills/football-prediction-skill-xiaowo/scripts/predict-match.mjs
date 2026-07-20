#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { predict90 } from "../core/model.mjs";

const usage = "用法：node scripts/predict-match.mjs --input <输入快照.json> [--out <预测.json>]";
const args = process.argv.slice(2);
const inputIndex = args.indexOf("--input");
const outputIndex = args.indexOf("--out");

if (inputIndex === -1 || !args[inputIndex + 1]) {
  console.error(usage);
  process.exitCode = 1;
} else {
  const input = JSON.parse(await readFile(args[inputIndex + 1], "utf8"));
  const prediction = predict90(input);
  const output = `${JSON.stringify(prediction, null, 2)}\n`;

  if (outputIndex !== -1 && args[outputIndex + 1]) await writeFile(args[outputIndex + 1], output, "utf8");
  else console.log(output);
}
