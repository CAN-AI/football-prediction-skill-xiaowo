import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { V3_SKILL_VERSION, SUPPORTED_COMPETITION_FAMILIES } from "../core/constants.mjs";

const cliPath = fileURLToPath(new URL("../../../bin/football-xiaowo.mjs", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

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
    for (const command of ["audit", "predict", "report", "pipeline", "record", "calibrate"]) {
      assert.match(result.stdout, new RegExp(command));
    }
  }
});

test("football-xiaowo 把六个工作流命令分发到 v3 脚本", () => {
  for (const command of ["audit", "predict", "report", "pipeline", "record", "calibrate"]) {
    const result = runCli(command);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /用法/);
    assert.doesNotMatch(result.stderr, /未知命令/);
  }
});

test("football-xiaowo audit 可实际生成 v3 审计文件", () => {
  const directory = mkdtempSync(join(tmpdir(), "football-root-cli-"));
  const ledger = fileURLToPath(new URL("../assets/sample-data/league-evidence.json", import.meta.url));
  const output = join(directory, "audit.json");
  try {
    const result = runCli("audit", "--ledger", ledger, "--out", output);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(output, "utf8")).status, "passed");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("football-xiaowo 拒绝未知命令并提示帮助", () => {
  const result = runCli("unknown-command");

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /请运行 --help/);
});

test("npm 包保留 README 的全部本地链接且排除内部和临时路径", () => {
  const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  const packed = spawnSync(process.execPath, [npmCli, "pack", "--dry-run", "--json"], {
    cwd: repositoryRoot,
    encoding: "utf8"
  });
  assert.equal(packed.status, 0, packed.stderr);
  const metadata = JSON.parse(packed.stdout);
  const packagePaths = new Set(metadata[0].files.map((file) => file.path.replaceAll("\\", "/")));
  const readme = readFileSync(join(repositoryRoot, "README.md"), "utf8");
  const references = [
    ...readme.matchAll(/\[[^\]]*\]\(([^)]+)\)/g),
    ...readme.matchAll(/<img\s+[^>]*src=["']([^"']+)["']/g)
  ].map((match) => match[1].split(/[?#]/, 1)[0].replace(/^\.\//, ""))
    .filter((path) => path && !/^[a-z]+:/i.test(path) && !path.startsWith("#"));

  for (const path of references) {
    assert.ok(packagePaths.has(path), `README 本地链接不在 npm 包内：${path}`);
  }
  for (const path of packagePaths) {
    assert.doesNotMatch(path, /^(?:reports\/|\.tmp|\.superpowers\/|docs\/superpowers\/)/);
  }
});
