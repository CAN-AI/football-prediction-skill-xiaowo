#!/usr/bin/env node

import { generateReport } from "../core/report.mjs";
import { parseArgs, readJson, requireArg, writeText } from "../core/utils.mjs";

const usage = "Usage: node scripts/generate-report.mjs --prediction <prediction.json> [--data snapshot.json] [--record record.json] [--out report.md] [--allow-failed-audit]";
const args = parseArgs(process.argv.slice(2));
const prediction = await readJson(requireArg(args, "prediction", usage));
const snapshot = args.data ? await readJson(args.data) : undefined;
const record = args.record ? await readJson(args.record) : undefined;
const report = generateReport({
  snapshot,
  prediction,
  record,
  allowFailedAudit: args["allow-failed-audit"] === true
});

if (args.out) {
  await writeText(args.out, report);
} else {
  console.log(report);
}
