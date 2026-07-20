#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { proposeCalibration } from "../core/postmatch.mjs";

const USAGE = "用法：node propose-calibration.mjs --records <postmatch-records.json> --out <calibration-proposal.json>";

function parseArguments(argumentsList) {
  if (argumentsList.length !== 4) return null;
  const values = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const flag = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!['--records', '--out'].includes(flag) || !value || values[flag]) return null;
    values[flag] = value;
  }
  return values["--records"] && values["--out"] ? values : null;
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (!options) throw new Error(USAGE);
  const input = JSON.parse(await readFile(options["--records"], "utf8"));
  const records = Array.isArray(input) ? input : input?.records;
  const proposal = proposeCalibration(records);
  await writeFile(options["--out"], `${JSON.stringify(proposal, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  console.log(`校准提案已写入：${options["--out"]}`);
} catch (error) {
  console.error(`校准提案失败：${error.message}`);
  process.exitCode = 1;
}
