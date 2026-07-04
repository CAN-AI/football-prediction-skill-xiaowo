#!/usr/bin/env node

import { recordResult } from "../core/record.mjs";
import { parseArgs, readJson, requireArg, writeJson } from "../core/utils.mjs";

const usage = "Usage: node scripts/record-result.mjs --prediction <prediction.json> --actual-home <goals> --actual-away <goals> [--out record.json]";
const args = parseArgs(process.argv.slice(2));
const prediction = await readJson(requireArg(args, "prediction", usage));
const actualHome = Number(requireArg(args, "actual-home", usage));
const actualAway = Number(requireArg(args, "actual-away", usage));
if (!Number.isInteger(actualHome) || !Number.isInteger(actualAway) || actualHome < 0 || actualAway < 0) {
  throw new Error(`${usage}\nactual-home/actual-away 必须是非负整数。`);
}
const record = recordResult(prediction, { home: actualHome, away: actualAway }, { reason: args.reason });

if (args.out) {
  await writeJson(args.out, record);
} else {
  console.log(JSON.stringify(record, null, 2));
}
