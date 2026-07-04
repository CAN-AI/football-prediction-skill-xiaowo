import test from "node:test";
import assert from "node:assert/strict";

import { auditSnapshot } from "../skills/worldcup-prediction-skill-xiaowo/core/audit.mjs";
import {
  dataVersionFromSources,
  snapshotContentHash
} from "../skills/worldcup-prediction-skill-xiaowo/core/utils.mjs";

function validSnapshot(overrides = {}) {
  const sourceVersions = { schedule: "test-schedule-v1", ratings: "test-ratings-v1" };
  const strengthSnapshotVersion = "test-strength-v1";
  return {
    metadata: {
      modelVersion: "test-model-v1",
      dataVersion: dataVersionFromSources(sourceVersions, strengthSnapshotVersion),
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
    officialFacts: [],
    ...overrides
  };
}

test("关键展示字段出现问号占位时审计失败", () => {
  const snapshot = validSnapshot();
  snapshot.teams[0].name = "???";

  const audit = auditSnapshot(snapshot);

  assert.equal(audit.ok, false);
  assert.match(audit.errors.join("\n"), /编码损坏|问号占位|UTF-8/);
});

test("非关键说明字段出现问号占位时只给警告", () => {
  const snapshot = validSnapshot({
    metadata: {
      ...validSnapshot().metadata,
      sampleScope: "???"
    }
  });

  const audit = auditSnapshot(snapshot);

  assert.equal(audit.ok, true);
  assert.match(audit.warnings.join("\n"), /编码损坏|问号占位|UTF-8/);
});

test("matchId 只能使用安全文件名字符", () => {
  const snapshot = validSnapshot();
  snapshot.matchStates[0].matchId = "../AAA-BBB";

  const audit = auditSnapshot(snapshot);

  assert.equal(audit.ok, false);
  assert.match(audit.errors.join("\n"), /matchId|文件名|安全/);
});

test("snapshotContentHash 不匹配时审计失败", () => {
  const snapshot = validSnapshot();
  snapshot.metadata.snapshotContentHash = snapshotContentHash(snapshot);
  snapshot.teams[0].ratingValue = 1900;

  const audit = auditSnapshot(snapshot);

  assert.equal(audit.ok, false);
  assert.match(audit.errors.join("\n"), /snapshotContentHash|内容哈希/);
});
