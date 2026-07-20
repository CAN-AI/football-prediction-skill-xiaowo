# Task 6 RED/GREEN 报告

基线：`5fd985c fix: bind postmatch facts to audited values`

## 实现范围

- 新增 `runPrematchPipeline({ input, outDir })` 与严格定稿门禁 `finalizeManifest(manifest)`。
- 固定执行顺序：输入加载 → manifest/profile 校验 → 证据审计 → 审计快照 → `predict90` → 同源 Markdown/HTML → PNG 与渲染审计 → SHA-256 → 最终清单。
- 每次运行写入 `<out-dir>/<runId>/`；运行目录已存在时拒绝覆写。
- 正式定稿必须具有审计快照、预测、Markdown、HTML、PNG、渲染审计六项产物及各自 64 位 SHA-256。
- `degraded_low_confidence` 必须具有非空 `missing` 或 `conflicts`；渲染审计存在任一错误时拒绝定稿。
- Task5 兼容：无独立 ledger 时，仅用旧 `evidenceAudit.accepted/rejected` 重建账本并重新审计；预测与报告只绑定新审计结果。

## RED 记录

命令：

```bash
node --test skills/football-prediction-skill-xiaowo/tests/pipeline.test.mjs
```

依次观察到以下预期失败，再分别写最小实现：

1. `ERR_MODULE_NOT_FOUND`：`core/pipeline.mjs` 不存在。
2. 缺失 `report-long.html` 时未抛异常。
3. `prediction.json` 使用非法 SHA-256 时未抛异常。
4. `degraded_low_confidence` 的 `missing/conflicts` 都为空时未抛异常。
5. `render-audit.json` 标记未通过时未抛异常。
6. 完整清单定稿后缺少 `finalizedAt`。
7. 模块未导出 `runPrematchPipeline`。
8. CLI 脚本不存在，子进程以 `MODULE_NOT_FOUND` 退出。
9. 只有 Task5 `evidenceAudit`、没有独立 ledger 时，接受事实及确定性调整丢失。

## GREEN 记录

流水线专项测试：

```text
node --test skills/football-prediction-skill-xiaowo/tests/pipeline.test.mjs
tests 10, pass 10, fail 0
```

简报指定 CLI：

```bash
node skills/football-prediction-skill-xiaowo/scripts/run-pipeline.mjs \
  --input skills/football-prediction-skill-xiaowo/assets/sample-data/club-league-snapshot.json \
  --out-dir .tmp-v3-pipeline
```

验证结果：生成一个独立 `runId` 目录；六项必需产物实际 SHA-256 全部与 `run-manifest.json` 匹配；PNG 存在；水平溢出为 false；表格溢出为 0；替换字符为 false；页面高度有效。

全量 v3 回归：

```text
npm run test:v3
tests 61, pass 61, fail 0
```

附加检查：

```text
node --check core/pipeline.mjs                 PASS
node --check scripts/run-pipeline.mjs          PASS
package.json JSON 解析                         PASS
git diff --check                               PASS
```
