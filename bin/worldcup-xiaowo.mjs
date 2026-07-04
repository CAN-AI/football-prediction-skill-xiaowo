#!/usr/bin/env node

import { runCli } from "../skills/worldcup-prediction-skill-xiaowo/core/cli.mjs";

runCli(process.argv.slice(2)).catch((error) => {
  console.error(error?.message ?? String(error));
  process.exitCode = 1;
});
