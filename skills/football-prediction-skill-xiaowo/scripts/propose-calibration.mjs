#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadVerifiedPostmatchRecord } from "../core/pipeline.mjs";
import { proposeCalibration } from "../core/postmatch.mjs";

const USAGE = "用法：node propose-calibration.mjs --runs <postmatch-runs.json> --out <calibration-proposal.json>；runs 中每项必须给出 postmatchRunDir 和 prematchRunDir";

function parseArguments(argumentsList) {
  if (argumentsList.length !== 4) return null;
  const values = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const flag = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!['--runs', '--out'].includes(flag) || !value || values[flag]) return null;
    values[flag] = value;
  }
  return values["--runs"] && values["--out"] ? values : null;
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (!options) throw new Error(USAGE);
  const runsIndexPath = resolve(options["--runs"]);
  const input = JSON.parse(await readFile(runsIndexPath, "utf8"));
  const runs = Array.isArray(input) ? input : input?.runs;
  if (!Array.isArray(runs)) throw new Error("runs 索引必须是数组或包含 runs 数组的对象。");
  const records = [];
  for (const [index, run] of runs.entries()) {
    if (typeof run?.postmatchRunDir !== "string" || !run.postmatchRunDir.trim()
      || typeof run?.prematchRunDir !== "string" || !run.prematchRunDir.trim()) {
      throw new Error(`runs[${index}] 必须提供 postmatchRunDir 和 prematchRunDir。`);
    }
    const verified = await loadVerifiedPostmatchRecord({
      postmatchRunDir: resolve(dirname(runsIndexPath), run.postmatchRunDir),
      prematchRunDir: resolve(dirname(runsIndexPath), run.prematchRunDir)
    });
    records.push(verified.record);
  }
  const proposal = proposeCalibration(records);
  await writeFile(options["--out"], `${JSON.stringify(proposal, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  console.log(`校准提案已写入：${options["--out"]}`);
} catch (error) {
  console.error(`校准提案失败：${error.message}`);
  process.exitCode = 1;
}
