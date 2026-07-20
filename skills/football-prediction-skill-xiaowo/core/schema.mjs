import { randomUUID } from "node:crypto";
import { V3_SKILL_VERSION, SUPPORTED_COMPETITION_FAMILIES } from "./constants.mjs";

const EMPTY_ARTIFACTS = Object.freeze({
  evidenceLedger: null,
  audit: null,
  inputSnapshot: null,
  prediction: null,
  reportMarkdown: null,
  reportHtml: null,
  reportPng: null,
  renderAudit: null
});

export function validateCompetitionProfile(profile) {
  const regulation = profile?.regulation ?? {};
  const errors = [];
  const invalidTwoLegged = regulation.twoLegged === true
    && (regulation.extraTime !== true || regulation.penalties !== true);

  if (!SUPPORTED_COMPETITION_FAMILIES.includes(profile?.family)) {
    errors.push("赛事类别不受支持。");
  }
  if (!profile?.competitionId) errors.push("赛事标识不能为空。");
  if (!profile?.baselineVersion) errors.push("基线版本不能为空。");
  if (invalidTwoLegged) errors.push("两回合淘汰赛必须声明加时和点球规则。");

  return { ok: errors.length === 0, errors };
}

export function assertMatchOrientation(match) {
  if (!match?.homeTeamId || !match?.awayTeamId || match.homeTeamId === match.awayTeamId) {
    throw new Error("比赛必须有不同的主队和客队。");
  }
  return match;
}

export function createRunManifest(input) {
  const profileResult = validateCompetitionProfile(input?.competitionProfile);
  if (!profileResult.ok) throw new Error(profileResult.errors.join(""));
  if (!input?.dataCutoffAt) throw new Error("数据截止时间不能为空。");
  if (!['prematch', 'postmatch'].includes(input?.mode)) throw new Error("运行模式必须是赛前或赛后。");

  const runId = input.runId ?? randomUUID();
  if (input.parentRunId === runId) throw new Error("父运行不能关联自身。");

  return {
    runId,
    skillVersion: input.skillVersion ?? V3_SKILL_VERSION,
    modelVersion: input.modelVersion ?? null,
    createdAt: input.createdAt ?? new Date().toISOString(),
    dataCutoffAt: input.dataCutoffAt,
    mode: input.mode,
    competitionProfile: input.competitionProfile,
    match: assertMatchOrientation(input.match),
    artifacts: { ...EMPTY_ARTIFACTS },
    parentRunId: input.parentRunId ?? null
  };
}
