#!/usr/bin/env node

import { auditSnapshot } from "../core/audit.mjs";
import { parseArgs, readJson, requireArg } from "../core/utils.mjs";

const usage = "Usage: node scripts/audit-input.mjs --data <snapshot.json>";
const args = parseArgs(process.argv.slice(2));
const dataPath = requireArg(args, "data", usage);
const snapshot = await readJson(dataPath);
const audit = auditSnapshot(snapshot);

console.log(JSON.stringify(audit, null, 2));
if (!audit.ok) process.exitCode = 1;
