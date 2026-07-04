#!/usr/bin/env node

import { join } from "node:path";
import { predictMatch } from "../core/model.mjs";
import { parseArgs, readJson, requireArg, safeFileName, writeJson } from "../core/utils.mjs";

const usage = "Usage: node scripts/predict-batch.mjs --data <snapshot.json> [--out-dir reports/batch] [--include-live] [--all] [--max-goals 7] [--top 5]";
const args = parseArgs(process.argv.slice(2));
const snapshot = await readJson(requireArg(args, "data", usage));

function safePredictionFileName(matchId) {
  return `${safeFileName(matchId)}.prediction.json`;
}

const matches = (snapshot.matchStates ?? []).filter((match) => {
  if (args.all) return true;
  if (args["include-live"]) return match.status === "scheduled" || match.status === "in_progress";
  return match.status === "scheduled";
});

const predictions = matches.map((match) => predictMatch(snapshot, {
  matchId: match.matchId,
  maxGoals: args["max-goals"] ? Number(args["max-goals"]) : undefined,
  top: args.top ? Number(args.top) : undefined
}));

const summary = {
  generatedAt: new Date().toISOString(),
  dataVersion: snapshot.metadata?.dataVersion,
  count: predictions.length,
  matches: predictions.map((prediction) => ({
    matchId: prediction.matchId,
    homeTeamName: prediction.homeTeamName,
    awayTeamName: prediction.awayTeamName,
    resultScope: prediction.resultScope,
    homeWin90Prob: prediction.homeWin90Prob,
    draw90Prob: prediction.draw90Prob,
    awayWin90Prob: prediction.awayWin90Prob,
    expectedGoalsHome: prediction.expectedGoalsHome,
    expectedGoalsAway: prediction.expectedGoalsAway,
    favoriteLabel: prediction.favoriteLabel,
    confidenceLevel: prediction.confidenceLevel,
    upsetRisk: prediction.upsetRisk,
    topScorelines: prediction.topScorelines
  }))
};

if (args["out-dir"]) {
  for (const prediction of predictions) {
    await writeJson(join(args["out-dir"], safePredictionFileName(prediction.matchId)), prediction);
  }
  await writeJson(join(args["out-dir"], "batch-summary.json"), summary);
} else {
  console.log(JSON.stringify({ summary, predictions }, null, 2));
}
