# 足球预测 Skill v3 验证记录（2026-07-20）

## 结论

- legacy 单元测试通过：12/12。
- v3 测试通过：115/115。
- 俱乐部联赛样例完成赛前、赛后端到端生成；赛前八项 artifact、赛后九项 artifact 均已登记固定路径、字节数和 SHA-256，并已定稿。
- Chromium 渲染审计通过：无水平溢出、无表格溢出、无替换字符，PNG 非空。
- MiniMax 本地认证状态有效，但独立文本调用因网络请求失败而退出；外部兼容性**未通过**，记录为外部网络限制。
- npm dry-run 包含 v3 源码、脚本、资产和参考资料；不包含 `reports/`、`.tmp*`、`.superpowers/` 或 `docs/superpowers/`。

## 可复现命令与测试证据

工作目录：`C:\Users\Administrator\Documents\琐碎\.worktrees\football-prediction-v3`

验证起点：`791a2ce`（`docs: add portable v3 skill guide and workflow diagrams`）。

```powershell
npm run test:unit
npm run test:v3
```

结果：

| 套件 | tests | pass | fail | duration |
|---|---:|---:|---:|---:|
| legacy `test:unit` | 12 | 12 | 0 | 573.3919 ms |
| v3 `test:v3` | 115 | 115 | 0 | 13985.7019 ms |

Task 9 严格 TDD 证据：

1. 首个 RED：测试因 `pipeline.mjs` 未导出 `validatePublishedRun` 而失败。
2. 首轮 GREEN：水平溢出门禁加入后，定向测试 12/12。
3. 第二个 RED：缺失 Markdown/PNG 哈希时实际返回 `true`，断言失败。
4. 第二轮 GREEN：非空哈希门禁加入后，定向测试 13/13。
5. 第三个 RED：缺失渲染审计时实际返回 `true`，断言失败。
6. 第三轮 GREEN：缺失审计、表格溢出和替换字符门禁加入后，定向测试 14/14。

### P1 发布门禁修复（2026-07-21）

独立审查复现了真实 manifest 形状下的缺口：`renderAudit.metadata.passed=false` 时，旧实现仍返回 `{ "ok": true, "errors": [] }`，而且 `validatePublishedRun` 没有生产调用点。

修复继续采用三轮 RED/GREEN：

1. artifact path/64hex RED：1 个失败、15 个通过；统一验证 `report.md`、`report-long.png`、`render-audit.json` 的真实 `{path,sha256}` 后，GREEN 16/16。
2. nested metadata RED：3 个失败、14 个通过；要求 metadata 存在，并显式满足 `passed=true`、无水平/表格溢出、无替换字符、页面高度有效后，GREEN 17/17。
3. 生产接线 RED：`finalizeManifest` 未拒绝不洁 metadata，且实际 pipeline 只写 `{passed,errors}`，共 2 个失败、16 个通过；接入统一 validator 并写入完整审计 metadata 后，GREEN 18/18。

兼容边界：`validatePublishedRun(run)`、`finalizeManifest(manifest)` 和 `runPrematchPipeline(options)` 的签名与返回结构不变；实际 `renderAudit` artifact 的 metadata 在原 `{passed,errors}` 基础上增补四个审计字段。旧的不完整 metadata 现在不能发布，这是有意的安全收紧。

### 历史中间门禁：路径与错误清单修复（2026-07-21）

复审进一步确认旧门禁会同时放行绝对路径、`..` 目录穿越、错误/重复 artifact 映射以及 `passed=true` 但 `metadata.errors` 非空的矛盾审计。

修复采用两轮 RED/GREEN：

1. 固定 tuple 路径与六项哈希 RED：2 个失败、17 个通过；validator 改为遍历同一权威 tuple，要求六项 `path` 精确等于固定相对文件名、每项 SHA-256 均为 64hex，GREEN 19/19。
2. errors 一致性 RED：1 个失败、19 个通过；要求 `renderAudit.metadata.errors` 必须是空数组，GREEN 20/20。

这一轮当时只覆盖六项报告 tuple；它随后被独立证据账本、独立审计及赛后记录门禁取代。当前权威 artifact 集合见下一节。

当时六项 tuple 为：

```plaintext
inputSnapshot  input-snapshot.json
prediction     prediction.json
reportMarkdown report.md
reportHtml     report-long.html
reportPng      report-long.png
renderAudit    render-audit.json
```

精确文件名相等同时拒绝绝对路径、任意路径分隔符、`..` 路径段、错误文件名和重复映射。输入 artifact 字段名仍为 `inputSnapshot`；落盘文件名由旧的 `audited-snapshot.json` 收紧为 `input-snapshot.json`。

### 最终安全门禁与当前 artifact 集合（2026-07-21）

最终复审发现并关闭了三个等价绕过：

1. `homeAdvantage` 现在必须是 `[0, 1]` 内的有限数值，中立场必须为 `0`，并与本次审计接受的同赛事基线 claim 中 `value.homeAdvantage` 严格同值；缺失、极端值、中立场非零或账本异值均在建模前拒绝。
2. 公开 `report` 不再接受可编辑 postmatch fixture。赛后报告只能由 `run-postmatch-pipeline.mjs` 发布；根命令仅能用 `--run-dir` 与 `--prematch-run-dir` 复验定稿父子运行，重建 Markdown/HTML、临时重渲染 PNG 并逐字节比较，不会生成或覆盖正式报告。
3. 公开 `calibrate` 不再读取 records 数组。`--runs` 只提供父子运行目录定位；每个样本都会按当前 schema 重新验证赛事画像与比赛身份，并复验 `finalizedAt`、固定 artifact 路径、逐文件 SHA-256/字节数、父子 ID、内外层 snapshot manifest、父运行模型输入证据绑定、重算预测、证据账本重审计、`audit.json` 以及从父预测和原始赛果证据重新计算的 `record.json`。`competitionProfileKey` v2 同时包含 `baseline.goalsPerTeam` 与 `homeAdvantage`，不同 lambda 配置不能混入同组。

对应 RED/GREEN 证据包括：`homeAdvantage=999` 与中立场 `homeAdvantage=0.12` 曾被 schema 接受；画像 `0.13` 与 claim `0.12` 曾继续到 `outDir` 门禁；伪造未定稿 postmatch manifest 曾生成报告；旧 `--records` 曾直接接受可编辑聚合；画像键曾忽略进球基线与主场优势；清空父证据后同步重算 audit/manifest 曾仍获 `predictionLineageVerified: true`。修复后，定向测试与 115 项 v3 全量测试均通过；真实父子运行测试还覆盖 record SHA、`parentRunId`、内外层 snapshot manifest、“篡改证据后同步更新 manifest 哈希”、重哈希伪造 Markdown 与重哈希伪造 PNG。

PNG 采用同一渲染器重新生成后逐字节比较，因此复验环境必须固定 Playwright/Chromium、字体和运行时版本；跨环境差异可能造成保守拒绝，正式复验应在发布环境执行。

赛前八项固定 artifact：

```plaintext
evidenceLedger evidence-ledger.json
audit          audit.json
inputSnapshot  input-snapshot.json
prediction     prediction.json
reportMarkdown report.md
reportHtml     report-long.html
reportPng      report-long.png
renderAudit    render-audit.json
```

赛后九项在以上八项基础上增加：

```plaintext
record         record.json
```

## 端到端流水线与渲染审计

```powershell
node skills/football-prediction-skill-xiaowo/scripts/run-pipeline.mjs `
  --input skills/football-prediction-skill-xiaowo/assets/sample-data/club-league-snapshot.json `
  --out-dir .tmp-v3-pathgate
```

赛前与赛后命令退出码均为 `0`。赛前运行 ID：`d9dd044e-341b-4c8e-9d37-bec5b3f3635f`；赛后运行 ID：`ars-che-2026-08-01-postmatch-001`。两份 manifest 均已定稿，并通过逐文件复验。

| 产物 | 字节数 |
|---|---:|
| `evidence-ledger.json` | 2,138 |
| `audit.json` | 2,206 |
| `input-snapshot.json` | 1,763 |
| `prediction.json` | 7,245 |
| `report.md` | 2,453 |
| `report-long.html` | 8,862 |
| `report-long.png` | 200,445 |
| `render-audit.json` | 526 |

赛后九项 artifact 的新鲜字节数为：`evidence-ledger.json` 751、`audit.json` 819、`input-snapshot.json` 1,842、`prediction.json` 7,245、`record.json` 1,986、`report.md` 1,620、`report-long.html` 7,236、`report-long.png` 142,700、`render-audit.json` 522。

渲染审计的关键原始值：

```json
{
  "renderer": { "browserName": "chromium", "version": "149.0.7827.55" },
  "viewport": { "width": 430, "height": 932 },
  "documentHeight": 3020,
  "documentWidth": 430,
  "viewportWidth": 430,
  "pageHeightValid": true,
  "horizontalOverflow": false,
  "tableOverflow": [],
  "replacementCharacterDetected": false,
  "png": { "byteLength": 200445, "present": true }
}
```

最终 manifest 中的真实渲染 artifact 记录为：

```json
{
  "path": "render-audit.json",
  "sha256": "e2111cd9ce59a06d28e7ab93f196591dde183a124250686b703ff1f3e32c4582",
  "byteLength": 526,
  "metadata": {
    "passed": true,
    "errors": [],
    "horizontalOverflow": false,
    "tableOverflow": [],
    "replacementCharacterDetected": false,
    "pageHeightValid": true
  }
}
```

## MiniMax 独立试跑

认证检查：

```powershell
mmx auth status
```

退出码：`0`。安全记录：`method=api-key`、`source=config.json`。CLI 输出中出现的密钥遮罩字段未复制到本记录。

仅在认证成功后执行了通用、不含密钥、路径或私有报告的提示词：

```powershell
mmx text chat --non-interactive --quiet --output json --message "请按足球预测 Skill v3 的资料缺失降级规则，说明在没有正式首发时如何继续生成低置信赛前报告。"
```

退出码：`1`，耗时约 `61.7 s`。原始错误（不含任何凭据）：

```json
{
  "error": {
    "code": 6,
    "message": "Network request failed.",
    "hint": "Check your network connection.\nTo use a proxy: set HTTPS_PROXY env var, or run: mmx config set --key proxy --value http://HOST:PORT"
  }
}
```

判定：认证预检通过；外部文本兼容性未通过，限制来自本次环境的网络请求失败。不得把这一结果标记为 MiniMax 兼容性通过。

## npm 打包检查

命令：

```powershell
npm pack --dry-run --json
```

白名单加入前的 RED 结果为 133 个条目，并发现 21 个不应发布的条目：`.tmp-v3-final/` 7 个、`.tmp-v3-pipeline/` 7 个、`.tmp-v3-report/` 4 个、`docs/superpowers/` 2 个、`reports/.gitkeep` 1 个。

加入 `package.json#files` 白名单后的最终路径清单如下；2026-07-21 新鲜 dry-run 为 108 个条目，禁止目录命中数为 0：

```text
bin/football-xiaowo.mjs
bin/worldcup-xiaowo.mjs
docs/assets/complex-full-workflow.png
docs/assets/github-overview-flow.png
docs/assets/harness-layered-correction.png
docs/assets/multi-agent-v2-workflow.png
docs/audit-report.md
docs/cli-usage.md
docs/codex-history-audit.md
docs/data-lifecycle.md
docs/flowchart-final-spec.md
docs/github-overview.md
docs/github-skill-profile.md
docs/harness-layering-and-correction.md
docs/historical-sample-analysis.md
docs/image2-flowchart-prompts.md
docs/model-methodology.md
docs/open-source-review.md
docs/sample-generated-report.md
docs/v3/validation-2026-07-20.md
examples/collections/sample-arg-alg.collection.json
examples/records/README.md
examples/records/historical-sample-summary.json
examples/records/sample-arg-alg.record.json
examples/snapshots/sample-worldcup-snapshot.json
examples/snapshots/worldcup-2026-07-06-r16-snapshot.json
LICENSE
package.json
README.md
skills/football-prediction-skill-xiaowo/SKILL.md
skills/football-prediction-skill-xiaowo/agents/openai.yaml
skills/football-prediction-skill-xiaowo/assets/sample-data/club-league-snapshot.json
skills/football-prediction-skill-xiaowo/assets/sample-data/league-evidence.json
skills/football-prediction-skill-xiaowo/assets/sample-data/postmatch-input.json
skills/football-prediction-skill-xiaowo/assets/sample-data/postmatch-records.json
skills/football-prediction-skill-xiaowo/assets/v3-conflict-degrade-flow.png
skills/football-prediction-skill-xiaowo/assets/v3-lifecycle-flow.png
skills/football-prediction-skill-xiaowo/assets/v3-lineage-flow.png
skills/football-prediction-skill-xiaowo/core/constants.mjs
skills/football-prediction-skill-xiaowo/core/evidence.mjs
skills/football-prediction-skill-xiaowo/core/facts.mjs
skills/football-prediction-skill-xiaowo/core/model.mjs
skills/football-prediction-skill-xiaowo/core/pipeline.mjs
skills/football-prediction-skill-xiaowo/core/postmatch.mjs
skills/football-prediction-skill-xiaowo/core/render.mjs
skills/football-prediction-skill-xiaowo/core/report.mjs
skills/football-prediction-skill-xiaowo/core/schema.mjs
skills/football-prediction-skill-xiaowo/core/utils.mjs
skills/football-prediction-skill-xiaowo/references/agent-portability.md
skills/football-prediction-skill-xiaowo/references/competition-profile.md
skills/football-prediction-skill-xiaowo/references/data-contract.md
skills/football-prediction-skill-xiaowo/references/evidence-policy.md
skills/football-prediction-skill-xiaowo/references/missing-data-playbook.md
skills/football-prediction-skill-xiaowo/references/model-boundaries.md
skills/football-prediction-skill-xiaowo/references/postmatch-governance.md
skills/football-prediction-skill-xiaowo/references/report-layout.md
skills/football-prediction-skill-xiaowo/scripts/audit-evidence.mjs
skills/football-prediction-skill-xiaowo/scripts/generate-report.mjs
skills/football-prediction-skill-xiaowo/scripts/predict-match.mjs
skills/football-prediction-skill-xiaowo/scripts/propose-calibration.mjs
skills/football-prediction-skill-xiaowo/scripts/record-result.mjs
skills/football-prediction-skill-xiaowo/scripts/render-flowcharts.mjs
skills/football-prediction-skill-xiaowo/scripts/run-pipeline.mjs
skills/football-prediction-skill-xiaowo/scripts/run-postmatch-pipeline.mjs
skills/football-prediction-skill-xiaowo/tests/branch-p1-evidence.test.mjs
skills/football-prediction-skill-xiaowo/tests/branch-p1-postmatch.test.mjs
skills/football-prediction-skill-xiaowo/tests/evidence.test.mjs
skills/football-prediction-skill-xiaowo/tests/model.test.mjs
skills/football-prediction-skill-xiaowo/tests/package.test.mjs
skills/football-prediction-skill-xiaowo/tests/pipeline.test.mjs
skills/football-prediction-skill-xiaowo/tests/postmatch.test.mjs
skills/football-prediction-skill-xiaowo/tests/report.test.mjs
skills/football-prediction-skill-xiaowo/tests/schema.test.mjs
skills/football-prediction-skill-xiaowo/tests/skill-contract.test.mjs
skills/worldcup-prediction-skill-xiaowo/SKILL.md
skills/worldcup-prediction-skill-xiaowo/agents/auditor.md
skills/worldcup-prediction-skill-xiaowo/agents/collector.md
skills/worldcup-prediction-skill-xiaowo/agents/openai.yaml
skills/worldcup-prediction-skill-xiaowo/agents/orchestrator.md
skills/worldcup-prediction-skill-xiaowo/agents/predictor.md
skills/worldcup-prediction-skill-xiaowo/agents/reporter.md
skills/worldcup-prediction-skill-xiaowo/agents/reviser.md
skills/worldcup-prediction-skill-xiaowo/assets/sample-data/sample-worldcup-snapshot.json
skills/worldcup-prediction-skill-xiaowo/core/audit.mjs
skills/worldcup-prediction-skill-xiaowo/core/cli.mjs
skills/worldcup-prediction-skill-xiaowo/core/collection.mjs
skills/worldcup-prediction-skill-xiaowo/core/model.mjs
skills/worldcup-prediction-skill-xiaowo/core/record.mjs
skills/worldcup-prediction-skill-xiaowo/core/report.mjs
skills/worldcup-prediction-skill-xiaowo/core/revision.mjs
skills/worldcup-prediction-skill-xiaowo/core/utils.mjs
skills/worldcup-prediction-skill-xiaowo/references/article-reporting.md
skills/worldcup-prediction-skill-xiaowo/references/collection-schema.md
skills/worldcup-prediction-skill-xiaowo/references/data-schema.md
skills/worldcup-prediction-skill-xiaowo/references/harness-workflow.md
skills/worldcup-prediction-skill-xiaowo/references/model-methodology.md
skills/worldcup-prediction-skill-xiaowo/references/multi-agent-workflow.md
skills/worldcup-prediction-skill-xiaowo/references/revision-policy.md
skills/worldcup-prediction-skill-xiaowo/scripts/audit-collection.mjs
skills/worldcup-prediction-skill-xiaowo/scripts/audit-input.mjs
skills/worldcup-prediction-skill-xiaowo/scripts/collect-template.mjs
skills/worldcup-prediction-skill-xiaowo/scripts/generate-report.mjs
skills/worldcup-prediction-skill-xiaowo/scripts/generate-scenarios.mjs
skills/worldcup-prediction-skill-xiaowo/scripts/predict-batch.mjs
skills/worldcup-prediction-skill-xiaowo/scripts/predict-match.mjs
skills/worldcup-prediction-skill-xiaowo/scripts/propose-revision.mjs
skills/worldcup-prediction-skill-xiaowo/scripts/record-result.mjs
skills/worldcup-prediction-skill-xiaowo/scripts/run-pipeline.mjs
```

重点核验计数：总条目 108；v3 `core/` 10、`scripts/` 8、`assets/` 7、`references/` 8、`tests/` 10；禁止路径 0。
