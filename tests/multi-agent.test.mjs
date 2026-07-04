import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function runNode(args) {
  return spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8"
  });
}

test("资料审计拒绝未经交叉验证的自媒体线索影响模型", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "xiaowo-collection-"));
  const collectionPath = join(tempDir, "collection.json");
  writeFileSync(collectionPath, JSON.stringify({
    metadata: {
      collectionVersion: "test-v1",
      generatedAt: "2026-07-04T12:00:00+08:00",
      matchId: "ARG-ALG-2026-06-17"
    },
    match: {
      matchId: "ARG-ALG-2026-06-17",
      homeTeamId: "ARG",
      awayTeamId: "ALG",
      kickoffAt: "2026-06-17T20:00:00Z"
    },
    claims: [
      {
        id: "claim-self-1",
        topic: "injury",
        targetType: "team",
        targetId: "ARG",
        summary: "某自媒体称阿根廷核心伤停。",
        sourceType: "self_media",
        sourceName: "测试自媒体",
        sourceUrl: "https://example.com/self-media",
        observedAt: "2026-06-17T09:00:00Z",
        confidence: "medium",
        affectsModel: true,
        humanReviewed: true,
        verifications: []
      }
    ]
  }, null, 2), "utf8");

  const result = runNode([
    "skills/worldcup-prediction-skill-xiaowo/scripts/audit-collection.mjs",
    "--collection",
    collectionPath
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /自媒体|交叉验证|affectsModel/);
});

test("总控流水线为单场比赛产出审计、预测、报告和清单", () => {
  const outputDir = mkdtempSync(join(tmpdir(), "xiaowo-pipeline-"));
  const result = runNode([
    "skills/worldcup-prediction-skill-xiaowo/scripts/run-pipeline.mjs",
    "--data",
    "examples/snapshots/sample-worldcup-snapshot.json",
    "--match",
    "ARG-ALG-2026-06-17",
    "--out-dir",
    outputDir
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(existsSync(join(outputDir, "audit.json")), true);
  assert.equal(existsSync(join(outputDir, "prediction.json")), true);
  assert.equal(existsSync(join(outputDir, "report.md")), true);
  assert.equal(existsSync(join(outputDir, "pipeline-manifest.json")), true);

  const manifest = JSON.parse(readFileSync(join(outputDir, "pipeline-manifest.json"), "utf8"));
  assert.deepEqual(manifest.agents, ["orchestrator", "collector", "auditor", "predictor", "reporter"]);
  assert.equal(manifest.outputs.report, "report.md");
});

test("修正建议必须等待人工确认，不能自动改权重", () => {
  const outputDir = mkdtempSync(join(tmpdir(), "xiaowo-revision-"));
  const outPath = join(outputDir, "revision-proposal.json");
  const result = runNode([
    "skills/worldcup-prediction-skill-xiaowo/scripts/propose-revision.mjs",
    "--records",
    "examples/records/sample-arg-alg.record.json",
    "--out",
    outPath
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const proposal = JSON.parse(readFileSync(outPath, "utf8"));
  assert.equal(proposal.requiresHumanApproval, true);
  assert.equal(proposal.applyAutomatically, false);
  assert.equal(proposal.recordCount, 1);
  assert.ok(Array.isArray(proposal.proposedAdjustments));
});
