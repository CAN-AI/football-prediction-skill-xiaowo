# 足球预测 Skill v3 验证记录（2026-07-20）

## 结论

- legacy 单元测试通过：12/12。
- v3 测试通过：86/86。
- 俱乐部联赛样例完成端到端生成；Markdown、HTML、PNG、审计、预测、审计快照和运行清单均非空。
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
| legacy `test:unit` | 12 | 12 | 0 | 481.7364 ms |
| v3 `test:v3` | 86 | 86 | 0 | 8633.2286 ms |

Task 9 严格 TDD 证据：

1. 首个 RED：测试因 `pipeline.mjs` 未导出 `validatePublishedRun` 而失败。
2. 首轮 GREEN：水平溢出门禁加入后，定向测试 12/12。
3. 第二个 RED：缺失 Markdown/PNG 哈希时实际返回 `true`，断言失败。
4. 第二轮 GREEN：非空哈希门禁加入后，定向测试 13/13。
5. 第三个 RED：缺失渲染审计时实际返回 `true`，断言失败。
6. 第三轮 GREEN：缺失审计、表格溢出和替换字符门禁加入后，定向测试 14/14。

## 端到端流水线与渲染审计

```powershell
node skills/football-prediction-skill-xiaowo/scripts/run-pipeline.mjs `
  --input skills/football-prediction-skill-xiaowo/assets/sample-data/club-league-snapshot.json `
  --out-dir .tmp-v3-final
```

退出码：`0`。运行 ID：`c31f62be-730d-43df-a8df-a1ffc559392e`。

| 产物 | 字节数 |
|---|---:|
| `audited-snapshot.json` | 1,669 |
| `prediction.json` | 7,245 |
| `render-audit.json` | 566 |
| `report.md` | 2,077 |
| `report-long.html` | 8,189 |
| `report-long.png` | 185,975 |
| `run-manifest.json` | 1,962 |

渲染审计的关键原始值：

```json
{
  "renderer": { "browserName": "chromium", "version": "149.0.7827.55" },
  "viewport": { "width": 430, "height": 932 },
  "documentHeight": 2683,
  "documentWidth": 430,
  "viewportWidth": 430,
  "pageHeightValid": true,
  "horizontalOverflow": false,
  "tableOverflow": [],
  "replacementCharacterDetected": false,
  "png": { "byteLength": 185975, "present": true }
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

加入 `package.json#files` 白名单后的最终路径清单如下；最终 dry-run 应为 87 个条目，禁止目录命中数为 0：

```text
bin/football-xiaowo.mjs
bin/worldcup-xiaowo.mjs
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

重点核验计数：v3 `core/` 10、`scripts/` 7、`assets/` 6、`references/` 8；禁止路径 0。
