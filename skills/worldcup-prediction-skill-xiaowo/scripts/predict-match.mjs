#!/usr/bin/env node

import { predictMatch } from "../core/model.mjs";
import { parseArgs, readJson, requireArg, writeJson } from "../core/utils.mjs";

const usage = "Usage: node scripts/predict-match.mjs --data <snapshot.json> [--match <matchId> | --home <teamId> --away <teamId>] [--stage group] [--venue-country USA] [--out prediction.json]";
const args = parseArgs(process.argv.slice(2));
const snapshot = await readJson(requireArg(args, "data", usage));
const prediction = predictMatch(snapshot, {
  matchId: args.match,
  homeTeamId: args.home,
  awayTeamId: args.away,
  stage: args.stage,
  venueCountryCode: args["venue-country"],
  maxGoals: args["max-goals"] ? Number(args["max-goals"]) : undefined,
  top: args.top ? Number(args.top) : undefined
});

if (args.out) {
  await writeJson(args.out, prediction);
} else {
  console.log(JSON.stringify(prediction, null, 2));
}
