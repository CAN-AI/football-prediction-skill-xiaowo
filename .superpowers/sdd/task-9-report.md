# Task 9 实施报告

## 交付

- 新增 `validatePublishedRun(run)`，以结构化 `{ ok, errors }` 结果验证真实 artifact 的 path/64hex SHA-256，以及嵌套 `renderAudit.metadata` 的完整渲染门禁。
- 将 `validatePublishedRun` 接入 `finalizeManifest`，并让实际 pipeline 在写最终 manifest 前记录完整渲染审计 metadata。
- `package.json` 增加发布白名单，保留 v1/v2、v3、CLI、示例和 Task 9 验证记录，排除报告、临时目录及 Superpowers 过程文件。
- README 增加 v3 验证与打包入口。
- 新增 `docs/v3/validation-2026-07-20.md`，记录测试、渲染、MiniMax 与 npm pack 的可复现证据。

## TDD 记录

1. 未导出 `validatePublishedRun`：定向测试 RED；最小水平溢出门禁后 GREEN。
2. 缺失 Markdown/PNG 哈希：断言得到 `true !== false`；最小哈希存在性门禁后 GREEN。
3. 缺失/不洁渲染审计：断言得到 `true !== false`；最小审计门禁后 GREEN。

P1 独立审查后追加三轮 TDD：

1. 真实 artifact path/64hex：RED 1/16，GREEN 16/16。
2. nested metadata 完整性与坏标志：RED 3/17，GREEN 17/17。
3. `finalizeManifest` 生产接线和真实 pipeline metadata：RED 2/18，GREEN 18/18。

残留 P1/P2 复审后追加两轮 TDD：

1. 六项固定相对文件名与逐项 64hex SHA：RED 2/19，GREEN 19/19。
2. `renderAudit.metadata.errors` 必须为空数组：RED 1/20，GREEN 20/20。

最终定向测试：20/20。

## 验证

- `npm run test:unit`：12/12，通过。
- `npm run test:v3`：92/92，通过。
- v3 端到端流水线：退出码 0，生成 7 个非空产物；PNG 185,975 字节。
- Chromium 149.0.7827.55 审计：`pageHeightValid=true`、`horizontalOverflow=false`、`tableOverflow=[]`、`replacementCharacterDetected=false`。
- `mmx auth status`：退出码 0，认证来源为本地配置；未记录密钥。
- MiniMax 非交互 JSON 文本调用：退出码 1，`code=6`、`Network request failed.`；外部兼容性未通过，按外部网络限制如实记录。
- `npm pack --dry-run --json`：初始发现 21 个不应发布条目；白名单后禁止路径命中 0，v3 core/scripts/assets/references 均在包内。

## P1 根因与兼容处理

- 根因：旧 validator 错把真实 artifact 描述对象当成原始 `render-audit.json`，从 `artifacts.renderAudit` 顶层读取审计标志；同时生产发布路径未调用它。
- 修复：从 `artifacts.renderAudit.metadata` 读取并强制校验全部发布标志，随后由 `finalizeManifest` 统一调用。
- 兼容：公共函数签名、返回值和 artifact 的既有字段不变；metadata 只增补 `horizontalOverflow`、`tableOverflow`、`replacementCharacterDetected`、`pageHeightValid`。旧的不完整发布清单会被拒绝，避免继续放行不可审计运行。
- 残留路径修复：六项 artifact 共享固定 tuple，path 必须精确等于对应相对文件名且各自带 64hex SHA；输入字段名保持 `inputSnapshot`，文件名收紧为 `input-snapshot.json`。
- 残留审计修复：`metadata.errors` 必须显式为空数组，避免 `passed=true` 与非空错误清单同时发布。

## 范围控制

- 未修改 `skills/worldcup-prediction-skill-xiaowo/` 或其他 v1/v2 文件。
- 未暂存 `.tmp-v3-*`、`docs/superpowers/` 或 `docs/v3/read-audit-2026-07-20.md`。
- 仅提交 Task 9 的源码、测试、README、package 配置、验证记录与本报告。
