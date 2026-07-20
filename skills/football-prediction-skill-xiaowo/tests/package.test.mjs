import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { V3_SKILL_VERSION, SUPPORTED_COMPETITION_FAMILIES } from "../core/constants.mjs";

const cliPath = fileURLToPath(new URL("../../../bin/football-xiaowo.mjs", import.meta.url));

function runCli(...args) {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8" });
}

test("v3 宣告通用赛事范围且不覆盖 v1", () => {
  assert.match(V3_SKILL_VERSION, /^football-xiaowo-v3\./);
  assert.deepEqual(SUPPORTED_COMPETITION_FAMILIES, [
    "league",
    "domestic_cup",
    "continental_club",
    "national_tournament",
    "friendly"
  ]);
});

test("football-xiaowo 使用 --version 输出 v3 版本", () => {
  const result = runCli("--version");

  assert.equal(result.status, 0);
  assert.equal(result.stdout, `${V3_SKILL_VERSION}\n`);
});

test("football-xiaowo 无参数或 --help 输出中文用途", () => {
  for (const args of [[], ["--help"]]) {
    const result = runCli(...args);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /小蜗通用足球预测/);
    assert.match(result.stdout, /完整流水线将在 v3 包安装后可用/);
  }
});

test("football-xiaowo 拒绝未知命令并提示帮助", () => {
  const result = runCli("predict");

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /请运行 --help/);
});
