import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { auditEvidenceLedger } from "../core/evidence.mjs";

function readArguments(argumentsList) {
  const values = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const flag = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!['--ledger', '--out'].includes(flag) || !value) return null;
    values[flag.slice(2)] = value;
  }
  return values.ledger && values.out ? values : null;
}

const argumentsValue = readArguments(process.argv.slice(2));
if (!argumentsValue) {
  console.error("用法：node audit-evidence.mjs --ledger <账本.json> --out <审计结果.json>");
  process.exitCode = 1;
} else {
  try {
    const source = JSON.parse(await readFile(resolve(argumentsValue.ledger), "utf8"));
    const audit = auditEvidenceLedger({
      ledger: source.ledger,
      match: source.match,
      cutoffAt: source.cutoffAt
    });
    const outputPath = resolve(argumentsValue.out);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
    console.log(`审计完成：${audit.status}；数据置信度：${audit.dataConfidence.level}`);
  } catch (error) {
    console.error(`审计失败：${error.message}`);
    process.exitCode = 1;
  }
}
