#!/usr/bin/env node

import { buildScenario } from "../core/model.mjs";
import { parseArgs, readJson, requireArg, writeJson } from "../core/utils.mjs";

const usage = "Usage: node scripts/generate-scenarios.mjs --prediction <prediction.json> [--min-goals 3] [--max-goals 2] [--out scenario.json]";
const args = parseArgs(process.argv.slice(2));
const prediction = await readJson(requireArg(args, "prediction", usage));
const scenario = buildScenario(prediction, {
  minGoals: args["min-goals"],
  maxGoals: args["max-goals"],
  top: args.top ? Number(args.top) : undefined
});

if (args.out) {
  await writeJson(args.out, scenario);
} else {
  console.log(JSON.stringify(scenario, null, 2));
}
