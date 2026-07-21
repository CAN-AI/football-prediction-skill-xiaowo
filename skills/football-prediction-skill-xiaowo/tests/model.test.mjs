import test from "node:test";
import assert from "node:assert/strict";
import { predict90 } from "../core/model.mjs";

const input = {
  manifest: {
    competitionProfile: {
      baselineVersion: "eng-pl-2026-27-r1",
      baseline: { goalsPerTeam: 1.55 },
      homeAdvantage: 0.12
    },
    match: { homeTeamId: "ARS", awayTeamId: "CHE" }
  },
  snapshot: {
    teams: {
      ARS: { rating: 1900, attack: 1.2, defense: 0.9 },
      CHE: { rating: 1850, attack: 1.1, defense: 1.0 }
    }
  },
  evidenceAudit: { status: "passed", dataConfidence: "high", accepted: [] }
};

test("90分钟概率归一且保留主客顺序", () => {
  const prediction = predict90(input);

  assert.equal(prediction.resultScope, "90min");
  assert.equal(prediction.homeTeamId, "ARS");
  assert.equal(prediction.awayTeamId, "CHE");
  assert.ok(Math.abs(prediction.homeWinProb + prediction.drawProb + prediction.awayWinProb - 1) < 1e-6);
});

test("比分矩阵完整归一且不把主客镜像", () => {
  const prediction = predict90(input);
  const probabilityTotal = prediction.scoreMatrix.reduce((total, item) => total + item.probability, 0);

  assert.equal(prediction.scoreMatrix.length, 64);
  assert.ok(Math.abs(probabilityTotal - 1) < 1e-10);
  assert.notEqual(prediction.expectedGoals.home, prediction.expectedGoals.away);
  assert.notEqual(prediction.scoreMatrix.find((item) => item.homeGoals === 1 && item.awayGoals === 0).probability,
    prediction.scoreMatrix.find((item) => item.homeGoals === 0 && item.awayGoals === 1).probability);
});

test("低置信只降低标签，不伪造补充事实", () => {
  const prediction = predict90({
    ...input,
    evidenceAudit: { status: "degraded_low_confidence", dataConfidence: "low", accepted: [] }
  });

  assert.equal(prediction.confidence.level, "low");
  assert.equal(prediction.adjustments.length, 0);
});

test("失败审计会在读取已接受调整前拒绝预测", () => {
  assert.throws(() => predict90({
    ...input,
    evidenceAudit: {
      status: "failed",
      dataConfidence: "high",
      accepted: [{
        claimId: "forged-adjustment",
        deterministicAdjustment: { homeLambdaDelta: 3 }
      }]
    }
  }), /审计失败/);
});

test("通过审计只接受有效的高或中等置信标签", () => {
  assert.throws(() => predict90({
    ...input,
    evidenceAudit: { status: "passed", dataConfidence: "low", accepted: [] }
  }), /通过审计/);

  const prediction = predict90({
    ...input,
    evidenceAudit: { status: "passed", dataConfidence: { level: "medium" }, accepted: [] }
  });
  assert.equal(prediction.confidence.level, "medium");
  assert.equal(prediction.trace.dataConfidence, "medium");
});

test("降级审计强制在结果和追溯中使用低置信", () => {
  const prediction = predict90({
    ...input,
    evidenceAudit: { status: "degraded_low_confidence", dataConfidence: "high", accepted: [] }
  });

  assert.equal(prediction.confidence.level, "low");
  assert.equal(prediction.confidence.dataConfidence, "low");
  assert.equal(prediction.trace.dataConfidence, "low");
});

test("仅已接受的确定性调整可入模，候选首发仍保持报告用途", () => {
  const prediction = predict90({
    ...input,
    evidenceAudit: {
      ...input.evidenceAudit,
      accepted: [
        {
          claimId: "tactics-confirmed",
          topic: "tactics",
          deterministicAdjustment: { homeLambdaDelta: 0.1 }
        },
        {
          claimId: "candidate-lineup",
          topic: "lineup",
          lineupStatus: "candidate",
          deterministicAdjustment: { homeLambdaDelta: 0.8 }
        }
      ]
    }
  });

  assert.deepEqual(prediction.adjustments, [
    { claimId: "tactics-confirmed", homeLambdaDelta: 0.1, awayLambdaDelta: 0 }
  ]);
});

test("结果不产生非90分钟或未确认首发的扩展字段", () => {
  const prediction = predict90(input);

  assert.equal("advancement" in prediction, false);
  assert.equal("marketFusion" in prediction, false);
  assert.equal("corners" in prediction, false);
  assert.equal("lineupAdjustments" in prediction, false);
  assert.equal(prediction.trace.baselineVersion, "eng-pl-2026-27-r1");
  assert.match(prediction.trace.inputHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(prediction.trace.scoreMatrix, { minGoals: 0, maxGoals: 7, truncated: true });
});
