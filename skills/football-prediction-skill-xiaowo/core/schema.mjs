import { randomUUID } from "node:crypto";
import { V3_SKILL_VERSION, SUPPORTED_COMPETITION_FAMILIES } from "./constants.mjs";

const EMPTY_ARTIFACTS = Object.freeze({
  evidenceLedger: null,
  audit: null,
  inputSnapshot: null,
  prediction: null,
  record: null,
  reportMarkdown: null,
  reportHtml: null,
  reportPng: null,
  renderAudit: null
});

const ARTIFACT_NAMES = Object.freeze(Object.keys(EMPTY_ARTIFACTS));

function cloneAndFreeze(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map(cloneAndFreeze));

  const clone = {};
  for (const [key, item] of Object.entries(value)) {
    clone[key] = cloneAndFreeze(item);
  }
  return Object.freeze(clone);
}

function createFrozenArtifacts(artifacts = EMPTY_ARTIFACTS) {
  const target = {};
  for (const name of ARTIFACT_NAMES) {
    const artifact = artifacts[name];
    target[name] = artifact === null ? null : cloneAndFreeze(artifact);
  }
  Object.freeze(target);

  return new Proxy(target, {
    set() {
      throw new Error("产物台账不可直接修改，请使用 appendArtifact。");
    }
  });
}

function freezeManifest(manifest) {
  const target = {};
  for (const [key, value] of Object.entries(manifest)) {
    target[key] = key === "artifacts" ? createFrozenArtifacts(value) : cloneAndFreeze(value);
  }
  Object.freeze(target);

  return new Proxy(target, {
    set() {
      throw new Error("运行清单不可直接修改，请创建新的运行清单。");
    }
  });
}

function assertArtifact(artifact) {
  if (!artifact || typeof artifact !== "object" || typeof artifact.path !== "string" || !artifact.path.trim()) {
    throw new Error("产物必须包含非空路径。");
  }
  if (typeof artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(artifact.sha256)) {
    throw new Error("产物哈希必须是 64 位 SHA-256 十六进制字符串。");
  }
  if (!Number.isInteger(artifact.byteLength) || artifact.byteLength <= 0) {
    throw new Error("产物必须包含大于 0 的 byteLength 字节数。");
  }
}

export function validateCompetitionProfile(profile) {
  const regulation = profile?.regulation ?? {};
  const baseline = profile?.baseline ?? {};
  const sampleWindow = baseline.sampleWindow;
  const errors = [];
  const invalidTwoLegged = regulation.twoLegged === true
    && (regulation.extraTime !== true || regulation.penalties !== true);

  if (!SUPPORTED_COMPETITION_FAMILIES.includes(profile?.family)) {
    errors.push("赛事类别不受支持。");
  }
  if (!profile?.competitionId) errors.push("赛事标识不能为空。");
  if (!profile?.season) errors.push("赛事画像 season 赛季不能为空。");
  if (!profile?.level) errors.push("赛事画像 level 级别不能为空。");
  if (!profile?.baselineVersion) errors.push("基线版本不能为空。");
  if (!Number.isFinite(baseline.goalsPerTeam) || baseline.goalsPerTeam <= 0) {
    errors.push("赛事画像 baseline.goalsPerTeam 进球基线必须是正数。");
  }
  if (!sampleWindow || typeof sampleWindow !== "object"
    || typeof sampleWindow.from !== "string" || !sampleWindow.from
    || typeof sampleWindow.to !== "string" || !sampleWindow.to
    || !Number.isInteger(sampleWindow.matchCount) || sampleWindow.matchCount <= 0) {
    errors.push("赛事画像 baseline.sampleWindow 样本窗口必须包含 from、to 和正整数 matchCount。");
  }
  if (!Array.isArray(baseline.evidenceClaimIds)
    || baseline.evidenceClaimIds.length === 0
    || baseline.evidenceClaimIds.some((claimId) => typeof claimId !== "string" || !claimId.trim())) {
    errors.push("赛事画像 baseline.evidenceClaimIds 必须绑定至少一条基线证据。");
  }
  if (typeof regulation.neutralVenue !== "boolean") {
    errors.push("赛事画像 regulation.neutralVenue 中立场规则必须显式声明。");
  }
  for (const field of ["twoLegged", "extraTime", "penalties"]) {
    if (typeof regulation[field] !== "boolean") errors.push(`赛事画像 regulation.${field} 必须显式声明。`);
  }
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

  return freezeManifest({
    runId,
    skillVersion: input.skillVersion ?? V3_SKILL_VERSION,
    modelVersion: input.modelVersion ?? null,
    createdAt: input.createdAt ?? new Date().toISOString(),
    dataCutoffAt: input.dataCutoffAt,
    mode: input.mode,
    competitionProfile: input.competitionProfile,
    match: assertMatchOrientation(input.match),
    artifacts: { ...EMPTY_ARTIFACTS },
    parentRunId: input.parentRunId ?? null,
    finalizedAt: null
  });
}

export function appendArtifact(manifest, artifactName, artifact) {
  if (!ARTIFACT_NAMES.includes(artifactName)) {
    throw new Error("产物名称不受支持。");
  }
  if (manifest?.finalizedAt) {
    throw new Error("运行清单已经定稿，不能继续追加产物。");
  }
  if (manifest?.artifacts?.[artifactName] !== null) {
    throw new Error("该产物已经登记，不能重复追加。");
  }
  assertArtifact(artifact);

  return freezeManifest({
    ...manifest,
    artifacts: { ...manifest.artifacts, [artifactName]: artifact }
  });
}

export function finalizeRunManifest(manifest) {
  if (manifest?.finalizedAt) {
    throw new Error("运行清单已经定稿。");
  }

  return freezeManifest({ ...manifest, finalizedAt: new Date().toISOString() });
}
