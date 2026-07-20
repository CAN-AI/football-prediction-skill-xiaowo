import test from "node:test";
import assert from "node:assert/strict";
import {
  assertMatchOrientation,
  createRunManifest,
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
