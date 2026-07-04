#!/usr/bin/env node

import { join } from "node:path";
import { auditSnapshot } from "../core/audit.mjs";
import { auditCollection } from "../core/collection.mjs";
import { predictMatch } from "../core/model.mjs";
import { generateReport } from "../core/report.mjs";
import { parseArgs, readJson, requireArg, safeFileName, writeJson, writeText } from "../core/utils.mjs";

const usage = "Usage: node scripts/run-pipeline.mjs --data <snapshot.json> [--collection collection.json] [--match <matchId> | --batch] --out-dir <dir> [--include-live]";
const args = parseArgs(process.argv.slice(2));
const snapshotPath = requireArg(args, "data", usage);
const outDir = requireArg(args, "out-dir", usage);
const snapshot = await readJson(snapshotPath);

async function writeManifest(manifest) {
  await writeJson(join(outDir, "pipeline-manifest.json"), manifest);
}

const manifest = {
  generatedAt: new Date().toISOString(),
  mode: args.batch ? "batch" : "single",
  agents: ["orchestrator", "collector", "auditor", "predictor", "reporter"],
  inputs: {
    snapshot: snapshotPath,
    collection: args.collection ?? null,
    match: args.match ?? null
  },
  stages: [],
  outputs: {}
};

if (args.collection) {
  const collection = await readJson(args.collection);
  const collectionAudit = auditCollection(collection);
  await writeJson(join(outDir, "collection-audit.json"), collectionAudit);
  manifest.stages.push({
    agent: "collector",
    status: "checked",
    output: "collection-audit.json",
    ok: collectionAudit.ok
  });
  if (!collectionAudit.ok) {
    await writeManifest(manifest);
    throw new Error(`资料包审计未通过：\n${collectionAudit.errors.map((item) => `- ${item}`).join("\n")}`);
  }
}

const snapshotAudit = auditSnapshot(snapshot);
await writeJson(join(outDir, "audit.json"), snapshotAudit);
manifest.stages.push({
  agent: "auditor",
  status: "checked",
  output: "audit.json",
  ok: snapshotAudit.ok
});
if (!snapshotAudit.ok) {
  await writeManifest(manifest);
  throw new Error(`输入快照审计未通过：\n${snapshotAudit.errors.map((item) => `- ${item}`).join("\n")}`);
}

function scheduledMatches() {
  return (snapshot.matchStates ?? []).filter((match) => {
    if (args["include-live"]) return match.status === "scheduled" || match.status === "in_progress";
    return match.status === "scheduled";
  });
}

if (args.batch) {
  const matches = scheduledMatches();
  const predictions = [];
  const reportSections = [];

  for (const match of matches) {
    const prediction = predictMatch(snapshot, { matchId: match.matchId });
    predictions.push(prediction);
    const name = safeFileName(prediction.matchId);
    const predictionPath = join("predictions", `${name}.prediction.json`);
    const reportPath = join("reports", `${name}.report.md`);
    await writeJson(join(outDir, predictionPath), prediction);
    const report = generateReport({ snapshot, prediction });
    await writeText(join(outDir, reportPath), report);
    reportSections.push(report);
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    dataVersion: snapshot.metadata?.dataVersion,
    count: predictions.length,
    matches: predictions.map((prediction) => ({
      matchId: prediction.matchId,
      homeTeamName: prediction.homeTeamName,
      awayTeamName: prediction.awayTeamName,
      favoriteLabel: prediction.favoriteLabel,
      confidenceLevel: prediction.confidenceLevel,
      upsetRisk: prediction.upsetRisk,
      homeWin90Prob: prediction.homeWin90Prob,
      draw90Prob: prediction.draw90Prob,
      awayWin90Prob: prediction.awayWin90Prob,
      topScorelines: prediction.topScorelines
    }))
  };
  await writeJson(join(outDir, "batch-summary.json"), summary);
  await writeText(join(outDir, "combined-report.md"), reportSections.join("\n\n---\n\n"));

  manifest.stages.push({ agent: "predictor", status: "completed", output: "predictions/" });
  manifest.stages.push({ agent: "reporter", status: "completed", output: "combined-report.md" });
  manifest.outputs = {
    audit: "audit.json",
    batchSummary: "batch-summary.json",
    combinedReport: "combined-report.md"
  };
} else {
  const matchId = requireArg(args, "match", usage);
  const prediction = predictMatch(snapshot, { matchId });
  await writeJson(join(outDir, "prediction.json"), prediction);
  const report = generateReport({ snapshot, prediction });
  await writeText(join(outDir, "report.md"), report);

  manifest.stages.push({ agent: "predictor", status: "completed", output: "prediction.json" });
  manifest.stages.push({ agent: "reporter", status: "completed", output: "report.md" });
  manifest.outputs = {
    audit: "audit.json",
    prediction: "prediction.json",
    report: "report.md"
  };
}

await writeManifest(manifest);
console.log(JSON.stringify(manifest, null, 2));
