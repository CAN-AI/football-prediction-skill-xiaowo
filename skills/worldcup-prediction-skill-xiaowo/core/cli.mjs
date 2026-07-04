import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = resolve(dirname(fileURLToPath(import.meta.url)), "../scripts");
const COMMANDS = new Map([
  ["collect-template", "collect-template.mjs"],
  ["audit-collection", "audit-collection.mjs"],
  ["audit", "audit-input.mjs"],
  ["predict", "predict-match.mjs"],
  ["predict-batch", "predict-batch.mjs"],
  ["scenario", "generate-scenarios.mjs"],
  ["record", "record-result.mjs"],
  ["report", "generate-report.mjs"],
  ["pipeline", "run-pipeline.mjs"],
  ["revise", "propose-revision.mjs"]
]);

function usage() {
  return `Usage:
  worldcup-xiaowo collect-template --match <matchId> --home <teamId> --away <teamId> --kickoff-at <iso-time> [--out collection.json]
  worldcup-xiaowo audit-collection --collection <collection.json> [--out audit.json]
  worldcup-xiaowo audit --data <snapshot.json>
  worldcup-xiaowo predict --data <snapshot.json> --match <matchId> [--out prediction.json]
  worldcup-xiaowo predict-batch --data <snapshot.json> [--include-live] [--out-dir reports/batch]
  worldcup-xiaowo scenario --prediction <prediction.json> --min-goals 3 [--out scenario.json]
  worldcup-xiaowo record --prediction <prediction.json> --actual-home 3 --actual-away 0 [--out record.json]
  worldcup-xiaowo report --data <snapshot.json> --prediction <prediction.json> [--record record.json] [--out report.md] [--allow-failed-audit]
  worldcup-xiaowo pipeline --data <snapshot.json> --match <matchId> --out-dir <dir>
  worldcup-xiaowo pipeline --data <snapshot.json> --batch --out-dir <dir>
  worldcup-xiaowo revise --records <record1.json,record2.json> [--out revision-proposal.json]`;
}

export async function runCli(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    console.log(usage());
    return;
  }
  const script = COMMANDS.get(command);
  if (!script) throw new Error(`${usage()}\nUnknown command: ${command}`);
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [resolve(scriptDir, script), ...rest], {
      stdio: "inherit",
      shell: false
    });
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`Command ${command} failed with exit code ${code}`));
    });
    child.on("error", rejectPromise);
  });
}
