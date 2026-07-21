import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const skillUrl = new URL("../SKILL.md", import.meta.url);

test("Skill 明确报告、低置信、不可回写、样本门槛与免责声明", async () => {
  const skill = await readFile(skillUrl, "utf8");
  for (const phrase of [
    "report.md",
    "report-long.png",
    "低置信",
    "不得回写",
    "30 场",
    "不构成"
  ]) {
    assert.match(skill, new RegExp(phrase));
  }
  assert.ok(skill.split(/\r?\n/).length < 500, "SKILL.md 必须少于 500 行");
});

test("Skill 链接跨 Agent、赛事画像、缺失资料与三张流程图", async () => {
  const skill = await readFile(skillUrl, "utf8");
  for (const link of [
    "references/agent-portability.md",
    "references/competition-profile.md",
    "references/missing-data-playbook.md",
    "assets/v3-lifecycle-flow.png",
    "assets/v3-conflict-degrade-flow.png",
    "assets/v3-lineage-flow.png"
  ]) {
    assert.match(skill, new RegExp(link.replaceAll(".", "\\.")));
  }
});

test("可移植协议显式检查网络、Node.js 与 PNG 渲染器", async () => {
  const portability = await readFile(new URL("../references/agent-portability.md", import.meta.url), "utf8");
  assert.match(portability, /网络能力/);
  assert.match(portability, /Node\.js/);
  assert.match(portability, /PNG 渲染器/);
});

test("三张流程图是非空 PNG", async () => {
  for (const name of [
    "v3-lifecycle-flow.png",
    "v3-conflict-degrade-flow.png",
    "v3-lineage-flow.png"
  ]) {
    const png = await readFile(new URL(`../assets/${name}`, import.meta.url));
    assert.ok(png.length > 1000, `${name} 不能为空`);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  }
});
