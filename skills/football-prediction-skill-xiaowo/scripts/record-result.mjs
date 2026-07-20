#!/usr/bin/env node

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

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (!options) throw new Error(USAGE);
  const [manifest, prediction, facts] = await Promise.all([
    readJson(options["--manifest"]),
    readJson(options["--prediction"]),
    readJson(options["--facts"])
  ]);
  const record = recordPostmatch({ manifest, prediction, facts });
  await writeFile(options["--out"], `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  console.log(`赛后记录已写入：${options["--out"]}`);
} catch (error) {
  console.error(`赛后记录失败：${error.message}`);
  process.exitCode = 1;
}
