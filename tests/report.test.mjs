import test from "node:test";
import assert from "node:assert/strict";

import { generateReport } from "../skills/worldcup-prediction-skill-xiaowo/core/report.mjs";
import { dataVersionFromSources } from "../skills/worldcup-prediction-skill-xiaowo/core/utils.mjs";

const sourceVersions = {
  schedule: "schedule-v1",
  ranking: "ranking-v1"
};
const strengthSnapshotVersion = "strength-v1";
const dataVersion = dataVersionFromSources(sourceVersions, strengthSnapshotVersion);

const prediction = {
  matchId: "AAA-BBB",
  dataVersion: "xiaowo-test",
  homeTeamName: "甲队",
  awayTeamName: "乙队",
  homeWin90Prob: 0.45,
  draw90Prob: 0.25,
  awayWin90Prob: 0.3,
  expectedGoalsHome: 1.4,
  expectedGoalsAway: 1.1,
  favoriteLabel: "主胜",
  confidenceLevel: "medium",
  upsetRisk: "medium",
  topScorelines: [
    { scoreline: { home: 1, away: 0 }, probability: 0.12 }
  ],
  inputsUsed: {
    home: { adjustments: ["home-review-v1"] },
    away: { adjustments: [] }
  }
};

function validSnapshot(overrides = {}) {
  return {
    metadata: {
      modelVersion: "test-model-v1",
      dataVersion,
      sourceVersions,
      strengthSnapshotVersion,
      expectedTeamCount: 2,
      generatedAt: "2026-07-04T12:00:00+08:00"
    },
    teams: [
      {
        id: "AAA",
        name: "甲队",
        ratingValue: 1700,
        strengthVersion: strengthSnapshotVersion
      },
      {
        id: "BBB",
        name: "乙队",
        ratingValue: 1650,
        strengthVersion: strengthSnapshotVersion
      }
    ],
    matchStates: [
      {
        matchId: "AAA-BBB",
        stage: "round_of_16",
        homeTeamId: "AAA",
        awayTeamId: "BBB",
        status: "scheduled"
      }
    ],
    contextAdjustments: [],
    officialFacts: [
      { id: "fact-1", type: "schedule", summary: "甲队将在测试场对阵乙队。" }
    ],
    ...overrides
  };
}

test("报告自动列出来源版本和事实摘要", () => {
  const report = generateReport({
    prediction: { ...prediction, dataVersion },
    snapshot: validSnapshot()
  });

  assert.match(report, /来源与事实摘要/);
  assert.match(report, /schedule/);
  assert.match(report, /schedule-v1/);
  assert.match(report, /甲队将在测试场对阵乙队/);
});

test("报告默认拒绝审计失败的快照", () => {
  const snapshot = validSnapshot({ teams: [] });

  assert.throws(
    () => generateReport({ prediction, snapshot }),
    /审计未通过|audit failed/
  );
});

test("诊断模式可以显式允许审计失败的快照", () => {
  const snapshot = validSnapshot({ teams: [] });

  const report = generateReport({ prediction, snapshot, allowFailedAudit: true });

  assert.match(report, /审计结果/);
});
