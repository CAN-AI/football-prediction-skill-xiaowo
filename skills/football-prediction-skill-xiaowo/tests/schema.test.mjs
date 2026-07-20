import test from "node:test";
import assert from "node:assert/strict";
import {
  appendArtifact,
  assertMatchOrientation,
  createRunManifest,
  finalizeRunManifest,
  validateCompetitionProfile
} from "../core/schema.mjs";
import { contentHash } from "../core/utils.mjs";

const profile = {
  family: "league",
  competitionId: "ENG-PL",
  season: "2026-27",
  baselineVersion: "pl-26-27-r1",
  regulation: { extraTime: false, penalties: false, twoLegged: false }
};

const match = {
  matchId: "ARS-CHE-2026-08-01",
  homeTeamId: "ARS",
  awayTeamId: "CHE",
  kickoffAt: "2026-08-01T15:00:00Z"
};

test("赛事画像接受联赛并拒绝无效两回合规则", () => {
  assert.equal(validateCompetitionProfile(profile).ok, true);
  const invalid = {
    ...profile,
    family: "domestic_cup",
    regulation: { extraTime: false, penalties: false, twoLegged: true }
  };

  assert.equal(validateCompetitionProfile(invalid).ok, false);
});

test("运行清单固定主客和截止时间", () => {
  const manifest = createRunManifest({
    mode: "prematch",
    dataCutoffAt: "2026-08-01T10:00:00Z",
    competitionProfile: profile,
    match
  });

  assert.equal(manifest.match.homeTeamId, "ARS");
  assert.equal(manifest.match.awayTeamId, "CHE");
  assert.equal(manifest.dataCutoffAt, "2026-08-01T10:00:00Z");
  assert.equal(manifest.artifacts.reportPng, null);
  assert.equal(manifest.artifacts.evidenceLedger, null);
});

test("运行清单初始化全部产物为空且拒绝自关联父运行", () => {
  const manifest = createRunManifest({
    runId: "run-001",
    mode: "postmatch",
    dataCutoffAt: "2026-08-01T10:00:00Z",
    competitionProfile: profile,
    match
  });

  assert.deepEqual(manifest.artifacts, {
    evidenceLedger: null,
    audit: null,
    inputSnapshot: null,
    prediction: null,
    reportMarkdown: null,
    reportHtml: null,
    reportPng: null,
    renderAudit: null
  });
  assert.throws(
    () => createRunManifest({
      runId: "run-001",
      parentRunId: "run-001",
      mode: "prematch",
      dataCutoffAt: "2026-08-01T10:00:00Z",
      competitionProfile: profile,
      match
    }),
    /父运行/
  );
});

test("主客队必须完整且不同", () => {
  assert.equal(assertMatchOrientation(match), match);
  assert.throws(
    () => assertMatchOrientation({ ...match, awayTeamId: "ARS" }),
    /主队和客队/
  );
});

test("内容哈希不受对象键顺序影响", () => {
  assert.equal(contentHash({ b: 2, a: 1 }), contentHash({ a: 1, b: 2 }));
});

test("产物台账冻结并拒绝直接写入", () => {
  const manifest = createRunManifest({
    mode: "prematch",
    dataCutoffAt: "2026-08-01T10:00:00Z",
    competitionProfile: profile,
    match
  });

  assert.equal(Object.isFrozen(manifest), true);
  assert.equal(Object.isFrozen(manifest.artifacts), true);
  assert.throws(
    () => { manifest.artifacts = {}; },
    /运行清单不可直接修改/
  );
  assert.throws(
    () => { manifest.artifacts.prediction = { path: "prediction.json", sha256: "a".repeat(64) }; },
    /产物台账不可直接修改/
  );
});

test("产物只能追加一次且合法追加不改写原清单", () => {
  const manifest = createRunManifest({
    mode: "prematch",
    dataCutoffAt: "2026-08-01T10:00:00Z",
    competitionProfile: profile,
    match
  });
  const artifact = { path: "prediction.json", sha256: "a".repeat(64) };
  const appended = appendArtifact(manifest, "prediction", artifact);

  assert.equal(manifest.artifacts.prediction, null);
  assert.deepEqual(appended.artifacts.prediction, artifact);
  assert.equal(Object.isFrozen(appended), true);
  assert.throws(() => appendArtifact(appended, "prediction", artifact), /已经登记/);
  assert.throws(
    () => appendArtifact(manifest, "prediction", { path: "prediction.json", sha256: "错误哈希" }),
    /64 位/
  );
});

test("定稿后的清单拒绝继续追加产物", () => {
  const manifest = createRunManifest({
    mode: "prematch",
    dataCutoffAt: "2026-08-01T10:00:00Z",
    competitionProfile: profile,
    match
  });
  const finalized = finalizeRunManifest(manifest);

  assert.match(finalized.finalizedAt, /T/);
  assert.equal(Object.isFrozen(finalized), true);
  assert.throws(
    () => appendArtifact(finalized, "prediction", { path: "prediction.json", sha256: "a".repeat(64) }),
    /已经定稿/
  );
});

test("创建清单深克隆并冻结比赛和赛事画像", () => {
  const sourceProfile = {
    ...profile,
    baseline: { expectedGoals: 2.4 },
    regulation: { ...profile.regulation }
  };
  const sourceMatch = { ...match };
  const manifest = createRunManifest({
    mode: "prematch",
    dataCutoffAt: "2026-08-01T10:00:00Z",
    competitionProfile: sourceProfile,
    match: sourceMatch
  });

  sourceMatch.homeTeamId = "LIV";
  sourceProfile.regulation.twoLegged = true;
  sourceProfile.baseline.expectedGoals = 9.9;

  assert.equal(manifest.match.homeTeamId, "ARS");
  assert.equal(manifest.competitionProfile.regulation.twoLegged, false);
  assert.equal(manifest.competitionProfile.baseline.expectedGoals, 2.4);
  assert.throws(() => { manifest.match.homeTeamId = "LIV"; });
  assert.throws(() => { manifest.competitionProfile.regulation.twoLegged = true; });
});

test("追加和定稿深克隆清单及产物内容", () => {
  const manifest = createRunManifest({
    mode: "prematch",
    dataCutoffAt: "2026-08-01T10:00:00Z",
    competitionProfile: { ...profile, regulation: { ...profile.regulation } },
    match: { ...match }
  });
  const artifact = {
    path: "prediction.json",
    sha256: "a".repeat(64),
    metadata: { producer: "test" }
  };
  const appended = appendArtifact(manifest, "prediction", artifact);
  const finalized = finalizeRunManifest(appended);

  artifact.path = "changed.json";
  artifact.metadata.producer = "changed";

  assert.equal(appended.artifacts.prediction.path, "prediction.json");
  assert.equal(appended.artifacts.prediction.metadata.producer, "test");
  assert.notEqual(appended.match, manifest.match);
  assert.notEqual(appended.competitionProfile, manifest.competitionProfile);
  assert.notEqual(finalized.match, appended.match);
  assert.throws(() => { appended.artifacts.prediction.path = "changed.json"; });
  assert.equal(appended.artifacts.prediction.path, "prediction.json");
});
