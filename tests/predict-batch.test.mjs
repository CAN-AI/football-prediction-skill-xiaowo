import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { snapshotContentHash } from "../skills/worldcup-prediction-skill-xiaowo/core/utils.mjs";

test("批量预测脚本为快照中的所有未赛比赛输出汇总", () => {
  const outputDir = mkdtempSync(join(tmpdir(), "xiaowo-batch-"));
  const result = spawnSync(process.execPath, [
    "skills/worldcup-prediction-skill-xiaowo/scripts/predict-batch.mjs",
    "--data",
    "examples/snapshots/worldcup-2026-07-06-r16-snapshot.json",
    "--out-dir",
    outputDir
  ], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const summary = JSON.parse(readFileSync(join(outputDir, "batch-summary.json"), "utf8"));
  assert.equal(summary.count, 2);
  assert.deepEqual(summary.matches.map((item) => item.matchId), [
    "POR-ESP-2026-07-06-M93",
    "USA-BEL-2026-07-06-M94"
  ]);
  assert.match(readFileSync(join(outputDir, "POR-ESP-2026-07-06-M93.prediction.json"), "utf8"), /葡萄牙/);
  assert.match(readFileSync(join(outputDir, "USA-BEL-2026-07-06-M94.prediction.json"), "utf8"), /比利时/);
});

test("批量预测默认跳过进行中比赛，显式 include-live 才纳入", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "xiaowo-live-"));
  const snapshotPath = join(tempDir, "snapshot.json");
  const snapshot = JSON.parse(readFileSync("examples/snapshots/worldcup-2026-07-06-r16-snapshot.json", "utf8"));
  snapshot.matchStates[1].status = "in_progress";
  snapshot.metadata.snapshotContentHash = snapshotContentHash(snapshot);
  writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  const defaultResult = spawnSync(process.execPath, [
    "skills/worldcup-prediction-skill-xiaowo/scripts/predict-batch.mjs",
    "--data",
    snapshotPath
  ], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(defaultResult.status, 0, defaultResult.stderr || defaultResult.stdout);
  assert.equal(JSON.parse(defaultResult.stdout).summary.count, 1);

  const liveResult = spawnSync(process.execPath, [
    "skills/worldcup-prediction-skill-xiaowo/scripts/predict-batch.mjs",
    "--data",
    snapshotPath,
    "--include-live"
  ], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.equal(liveResult.status, 0, liveResult.stderr || liveResult.stdout);
  assert.equal(JSON.parse(liveResult.stdout).summary.count, 2);
});
