# Tool-call trace: 采集 → 消费 → 标定

> 关联 change:`eval-trace-capture`(前置 `eval-pipeline-eacbd` 的 C 段续接)。
> 本文描述 L0 action-layer 证据的**完整链路**与阈值标定流程。

## 三条纪律(先读这个)

1. **默认 report-only**:`audit-tool-traces.mjs` 的观察值**从不**让构建失败,`--fail-on-severity` 是显式 opt-in。`trace:calibrate` 恒以 0 退出。
2. **缺 trace ≠ 坏证据**:没有 trace 目录时,cross-view 的 L0 列显示 `—`,不是失败,也不是"工具有问题"。
3. **fixture 数据不可标定**:单元测试起的 MCPServer 产生的 `tool_alpha`/`tool_beta` 流量会被显式标 `sourceKind=fixture`,**绝不能**当作真实 agent 流量用于阈值标定或质量结论。

## 链路总览

```text
真实 MCP 会话
  └─ ToolCallTraceRecorder (eventBus 'tool:called', in-memory)
       └─ closeServer() → flushToolTracesOnShutdown()
            └─ <MCP_TRACE_DIR>/<session>.jsonl   (机器本地, gitignored)
                 └─ audit-tool-traces.mjs --json --file <dir>   (workspace-wide combined)
                      └─ pnpm eval:trace → artifacts/benchmarks/trace-audit.json
                           ├─ pnpm eval:cross-view → cross-view.{md,json} (L0 × L2)
                           └─ pnpm trace:calibrate → 观察值 vs 阈值(只读)
```

## 目录隔离(避免污染)

| 变量 | 默认 | 用途 |
|---|---|---|
| `MCP_TRACE_DIR` | `.ccg/traces` | flush 目录;相对路径基于进程 cwd 解析 |
| `MCP_TRACE_DISABLE` | 关 | `1`/`true` 时完全不写盘 |

- **真实会话**:建议显式设 `MCP_TRACE_DIR` 到一个专用目录(例如 `MCP_TRACE_DIR=.ccg/traces/live`),与单元测试物理隔离。
- **单元测试**:`tests/setup.registry.ts` / `tests/setup.light.ts` 已设 `MCP_TRACE_DISABLE=1`,`pnpm test` 不会往真实目录追加 `tool_alpha`/`tool_beta`。
- 消费时用 `--file <真实目录>` 指向真实流量,别指向测试目录。

## 四步流程

### 1. 采集真实流量

用真实 agent 会话跑 MCP server(确保 `MCP_TRACE_DIR` 指向专用目录、`MCP_TRACE_DISABLE` 未开)。会话结束 `closeServer()` 会把有序 tool-call JSONL flush 到该目录。可随时检查:

```bash
ls -la "$MCP_TRACE_DIR"      # *.jsonl,每行一条 tool call
```

### 2. 落盘 L0 指标 + 生成 cross-view

```bash
pnpm eval:trace --file <真实目录>   # 产出 trace-audit.json(带 sourceKind/sourceDir)
pnpm eval:cross-view                # 产出 cross-view.{md,json}
```

检查 `cross-view.json`:

- `traceAvailable: true` — 第三跳接通;
- `sourceKind: "live"` — 来自真实会话;
- 若为 `"fixture"` → **停止**,这是 selftest 数据,不能用于标定(见纪律 3)。

### 3. 观察(只读,不 gate)

```bash
pnpm trace:calibrate
```

并排打印 `metric | observed | current threshold | delta`。固定附带:

> OBSERVATIONS ONLY — these are NOT compliance limits. A HUMAN must judge and edit `DEFAULT_THRESHOLDS` before `--fail-on-severity` is considered.

`DEFAULT_THRESHOLDS` 位于 `scripts/audit-tool-traces.mjs`,当前数值是"未经真实流量标定"的观察触发器,**不是**合规线。

### 4. 人工判断 → 才考虑 gate

只有积累足够**真实**会话、由人判断后,才在**同一个可审计 commit** 里:

- 编辑 `scripts/audit-tool-traces.mjs` 的 `DEFAULT_THRESHOLDS`(以及 `scripts/trace-calibrate.mjs` 的只读镜像快照 `DEFAULT_THRESHOLDS_SNAPSHOT`,保持同步);
- 讨论是否把 `--fail-on-severity` 纳入 CI(这是**另一个明确决策**,本 change 不做)。

**不要**用 `trace:calibrate` 的输出自动回填阈值——那等于让现状自证,和 `search-tune/{critic,holdout}.ts` 的防过拟合纪律相悖。

## 观测边界(推不到哪)

- `audit-tool-traces.mjs` 只算能从 trace 字段判定的 shape/效率型指标(repeated_call、orphan_failure、p99、plan_depth 近似)。
- A²E 的 `correct` / `safety` / reasoning / plan quality 是 LLM-as-judge 维度,需调用方 agent 的 chain-of-thought;**tool server 看不到 CoT**,本链路明确不测、不伪造。

## 相关文件

- 生产端:`src/server/observability/ToolCallTraceRecorder.ts`、`src/server/MCPServer.transport.ts`(`flushToolTracesOnShutdown` / `resolveTraceFlushDir`)
- 消费端:`scripts/audit-tool-traces.mjs`(默认语义未改)
- 第三跳:`scripts/capture-trace-audit.mjs`(`eval:trace`)、`scripts/generate-eval-cross-view.mjs`、 `scripts/lib/eval-cross-view.mjs`
- 标定:`scripts/trace-calibrate.mjs`
- 契约测试:`tests/server/benchmarks/trace-*.test.ts`、`tests/server/benchmarks/cross-view.pipeline.test.ts`
