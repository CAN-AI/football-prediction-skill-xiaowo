# v3 数据契约

## 运行清单

每次运行以 `run-manifest.json` 为根对象。它包含 `runId`、`skillVersion`、`modelVersion`、`createdAt`、`dataCutoffAt`、`mode`、`competitionProfile`、`match`、`artifacts` 和 `parentRunId`。

- `mode` 只能为 `prematch` 或 `postmatch`。
- `dataCutoffAt` 是本次运行采用资料的截止时间，必须原样保留。
- `parentRunId` 仅能关联先前运行，不能等于当前 `runId`。
- `match.homeTeamId` 与 `match.awayTeamId` 必填且必须不同。主客方向是运行事实，不能镜像或交换。

## 赛事画像

`competitionProfile` 必须包含受支持的 `family`、`competitionId` 和 `baselineVersion`。支持的赛事类别为 `league`、`domestic_cup`、`continental_club`、`national_tournament` 和 `friendly`。

当 `regulation.twoLegged` 为 `true` 时，`regulation.extraTime` 与 `regulation.penalties` 也必须为 `true`，以明确两回合淘汰赛的口径。

## 产物台账

新建运行清单时，下列字段均为 `null`：

- `evidenceLedger`
- `audit`
- `inputSnapshot`
- `prediction`
- `reportMarkdown`
- `reportHtml`
- `reportPng`
- `renderAudit`

产物生成后，只能在清单定稿前将对应字段从 `null` 追加为 `{ "path": "相对路径", "sha256": "64 位十六进制 SHA-256" }`。不得替换已写入的哈希，定稿后的清单不得修改。

## 内容哈希

`contentHash(value)` 对规范化后的 JSON 内容计算完整 SHA-256 十六进制哈希；对象键顺序不影响结果。它用于证明同一结构化内容未被静默改写。
