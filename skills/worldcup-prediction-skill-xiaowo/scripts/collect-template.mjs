#!/usr/bin/env node

import { createCollectionTemplate } from "../core/collection.mjs";
import { parseArgs, requireArg, writeJson } from "../core/utils.mjs";

const usage = "Usage: node scripts/collect-template.mjs --match <matchId> --home <teamId> --away <teamId> --kickoff-at <iso-time> [--out collection.json]";
const args = parseArgs(process.argv.slice(2));
const template = createCollectionTemplate({
  matchId: requireArg(args, "match", usage),
  homeTeamId: requireArg(args, "home", usage),
  awayTeamId: requireArg(args, "away", usage),
  kickoffAt: requireArg(args, "kickoff-at", usage)
});

if (args.out) {
  await writeJson(args.out, template);
} else {
  console.log(JSON.stringify(template, null, 2));
}
