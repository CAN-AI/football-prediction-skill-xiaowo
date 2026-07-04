import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

export function poisson(lambda, k) {
  let factorial = 1;
  for (let i = 2; i <= k; i += 1) factorial *= i;
  return (Math.E ** -lambda * lambda ** k) / factorial;
}

export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

export function contentHash(value, length = 16) {
  return createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, length);
}

export function safeFileName(value) {
  return String(value).replace(/[^A-Za-z0-9._-]/g, "_");
}

export function dataVersionFromSources(sourceVersions, strengthSnapshotVersion) {
  return `xiaowo-${contentHash({ sourceVersions, strengthSnapshotVersion })}`;
}

export function snapshotContentHash(snapshot, length = 16) {
  return contentHash({
    teams: snapshot?.teams ?? [],
    matchStates: snapshot?.matchStates ?? [],
    contextAdjustments: snapshot?.contextAdjustments ?? [],
    officialFacts: snapshot?.officialFacts ?? []
  }, length);
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeText(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}

export function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

export function requireArg(args, key, usage) {
  if (args[key] === undefined || args[key] === true || args[key] === "") {
    throw new Error(`${usage}\nMissing required argument: --${key}`);
  }
  return args[key];
}

export function outcomeFromScore(score) {
  if (score.home > score.away) return "home";
  if (score.home < score.away) return "away";
  return "draw";
}

export function outcomeLabel(outcome) {
  return outcome === "home" ? "主胜" : outcome === "away" ? "客胜" : "平局";
}

export function formatPercent(value, digits = 1) {
  return `${round(value * 100, digits)}%`;
}

export function asNumber(value, fallback = undefined) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
