# v3 数据契约

## 运行清单

每次运行以 `run-manifest.json` 为根对象。它包含 `runId`、`skillVersion`、`modelVersion`、`createdAt`、`dataCutoffAt`、`mode`、`competitionProfile`、`match`、`artifacts` 和 `parentRunId`。

- `mode` 只能为 `prematch` 或 `postmatch`。
- `dataCutoffAt` 是本次运行采用资料的截止时间，必须原样保留。
- `parentRunId` 仅能关联先前运行，不能等于当前 `runId`。
- `match.homeTeamId` 与 `match.awayTeamId` 必填且必须不同。主客方向是运行事实，不能镜像或交换。

## 赛事画像

`competitionProfile` 必须包含受支持的 `family`、`competitionId`、`season`、`level`、`baselineVersion`、`baseline.goalsPerTeam`、`baseline.sampleWindow`、`baseline.evidenceClaimIds`，以及显式的 `regulation.twoLegged/extraTime/penalties/neutralVenue`。支持的赛事类别为 `league`、`domestic_cup`、`continental_club`、`national_tournament` 和 `friendly`。

当 `regulation.twoLegged` 为 `true` 时，`regulation.extraTime` 与 `regulation.penalties` 也必须为 `true`，以明确两回合淘汰赛的口径。

## 产物台账

`createRunManifest` 返回冻结的根清单和冻结的 `artifacts` 映射。对 JSON 兼容的输入数据，清单会深克隆并递归冻结 `match`、`competitionProfile`（包括 `regulation`、`baseline`）和产物内容，不保留调用方的可变引用。`appendArtifact` 与 `finalizeRunManifest` 也返回同样独立的深冻结清单。新建运行清单时，下列字段均为 `null`：

- `evidenceLedger`
- `audit`
- `inputSnapshot`
- `prediction`
- `reportMarkdown`
- `reportHtml`
- `reportPng`
- `renderAudit`

产物生成后，只能通过 `appendArtifact(manifest, artifactName, artifact)` 在清单定稿前将已知槽位从 `null` 追加为 `{ "path": "固定相对路径", "sha256": "64 位十六进制 SHA-256", "byteLength": 123 }`。证据账本与独立审计必须分别落盘为 `evidence-ledger.json` 和 `audit.json`，并与快照、预测、报告、长图及渲染审计一起校验路径、字节数和哈希。该函数返回新的冻结清单，不改写输入清单；同名产物不得重复登记。直接写入 `artifacts` 会被拒绝。

`finalizeRunManifest(manifest)` 返回带有非空 `finalizedAt` 的新冻结清单。它只锁定台账，不验证所有必需产物；完整发布校验由流水线负责。定稿后的清单不得追加产物。

## 内容哈希

`contentHash(value)` 对规范化后的 JSON 内容计算完整 SHA-256 十六进制哈希；对象键顺序不影响结果。它用于证明同一结构化内容未被静默改写。
