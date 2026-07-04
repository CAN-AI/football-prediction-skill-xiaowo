#!/usr/bin/env node

import { auditCollection } from "../core/collection.mjs";
import { parseArgs, readJson, requireArg, writeJson } from "../core/utils.mjs";

const usage = "Usage: node scripts/audit-collection.mjs --collection <collection.json> [--out audit.json] [--normalized-out collection.normalized.json]";
const args = parseArgs(process.argv.slice(2));
const collection = await readJson(requireArg(args, "collection", usage));
const audit = auditCollection(collection);

if (args.out) {
  await writeJson(args.out, audit);
} else {
  console.log(JSON.stringify(audit, null, 2));
}

if (args["normalized-out"]) {
  await writeJson(args["normalized-out"], audit.normalizedCollection);
}

if (!audit.ok) process.exitCode = 1;
