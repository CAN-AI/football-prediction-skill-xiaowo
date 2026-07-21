#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { recordPostmatch } from "../core/postmatch.mjs";

const FLAGS = Object.freeze(["--manifest", "--prediction", "--facts", "--out"]);
const USAGE = "用法：node record-result.mjs --manifest <run-manifest.json> --prediction <prediction.json> --facts <facts.json> --out <record.json>";

function parseArguments(argumentsList) {
  if (argumentsList.length !== FLAGS.length * 2) return null;
  const values = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const flag = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!FLAGS.includes(flag) || !value || values[flag]) return null;
    values[flag] = value;
  }
  return FLAGS.every((flag) => values[flag]) ? values : null;
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (!options) throw new Error(USAGE);
  const [manifestText, predictionBytes, factsText] = await Promise.all([
    readFile(options["--manifest"], "utf8"),
    readFile(options["--prediction"]),
    readFile(options["--facts"], "utf8")
  ]);
  const manifest = JSON.parse(manifestText);
  const facts = JSON.parse(factsText);
  const predictionSha256 = createHash("sha256").update(predictionBytes).digest("hex");
  if (predictionSha256 !== manifest?.artifacts?.prediction?.sha256) {
    throw new Error("prediction 文件原始字节 SHA-256 与 manifest 不匹配。");
  }
  if (predictionSha256 !== facts?.predictionSha256) {
    throw new Error("prediction 文件原始字节 SHA-256 与 facts.predictionSha256 不匹配。");
  }
  const prediction = JSON.parse(predictionBytes.toString("utf8"));
  const record = recordPostmatch({ manifest, prediction, facts });
  await writeFile(options["--out"], `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  console.log(`赛后记录已写入：${options["--out"]}`);
} catch (error) {
  console.error(`赛后记录失败：${error.message}`);
  process.exitCode = 1;
}
