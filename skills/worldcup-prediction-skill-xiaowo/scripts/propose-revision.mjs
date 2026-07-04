#!/usr/bin/env node

import { proposeRevision } from "../core/revision.mjs";
import { parseArgs, readJson, requireArg, writeJson } from "../core/utils.mjs";

const usage = "Usage: node scripts/propose-revision.mjs --records <record1.json,record2.json> [--model-version version] [--out revision-proposal.json]";
const args = parseArgs(process.argv.slice(2));
const recordPaths = requireArg(args, "records", usage)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

if (recordPaths.length === 0) {
  throw new Error(`${usage}\n--records 至少需要一个 record.json。`);
}

const records = [];
for (const recordPath of recordPaths) {
  records.push(await readJson(recordPath));
}

const proposal = proposeRevision(records, { modelVersion: args["model-version"] });

if (args.out) {
  await writeJson(args.out, proposal);
} else {
  console.log(JSON.stringify(proposal, null, 2));
}
