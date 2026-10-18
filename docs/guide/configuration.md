# 配置参考

jshookmcp 的所有参数都有内建默认值，大多数用户无需额外配置。如需覆盖，根据安装方式选择：

## 配置传入方式

### npx / MCP 用户（无需 `.env` 文件）

在 MCP 客户端配置的 `env` 字段中传入环境变量：

```json
{
  "mcpServers": {
    "jshook": {
      "command": "npx",
      "args": ["-y", "@jshookmcp/jshook@latest"],
      "env": {
        "MCP_TOOL_PROFILE": "workflow",
        "npm_config_omit": "optional",
        "PUPPETEER_HEADLESS": "true"
      }
    }
  }
}
```

需要可选的 ONNX、Z3、Binaryen、Camoufox 或 Playwright 运行时时，移除
`npm_config_omit`。

### 源码开发者

Clone 仓库后，在项目根目录创建 `.env` 文件（参考 `.env.example`）。运行时自动加载，未设置的变量回退到 `src/utils/config.ts` 中的内建默认值。

> `.env.example` 只是模板，不会被运行时加载。实际读取的是仓库根目录的 `.env`。

## 配置项总表

当前运行时配置以 `src/utils/config.ts` 为准。仓库当前不读取 `DEFAULT_LLM_PROVIDER`、`OPENAI_*`、`ANTHROPIC_*` 这些历史文档里出现过的变量。

### 1. 浏览器与 Puppeteer

| 变量                         | 作用                                       | 默认值 / 典型值                                |
| ---------------------------- | ------------------------------------------ | ---------------------------------------------- |
| `PUPPETEER_HEADLESS`         | 是否以无头模式启动浏览器。                 | 代码默认 `false` |
| `PUPPETEER_TIMEOUT`          | Puppeteer 默认超时（毫秒）。               | `30000`                                        |
| `PUPPETEER_EXECUTABLE_PATH`  | 显式指定浏览器可执行文件路径。             | 无默认值                                       |
| `CHROME_PATH`                | 作为浏览器路径的备用变量。                 | 无默认值                                       |
| `BROWSER_EXECUTABLE_PATH`    | 再一个浏览器路径备用变量。                 | 无默认值                                       |
| `BROWSER_IDLE_TIMEOUT_MS`    | 浏览器空闲后关闭 jshook 启动的实例，或断开外部 attach；`0` 表示禁用。 | `300000` |
| `CAPTCHA_SCREENSHOT_DIR`     | CAPTCHA 识别失败时的截图落盘目录。         | `./screenshots/captcha`                        |
| `MCP_SCREENSHOT_DIR`         | 常规截图输出根目录（仍受项目根路径约束）。 | `./screenshots`                                |
| `MCP_DEBUGGER_SESSIONS_DIR`  | debugger session 存储目录。                | `./debugger-sessions`                          |
| `MCP_EXTENSION_REGISTRY_DIR` | extension registry 持久化目录。            | `./artifacts/extension-registry`               |
| `MCP_TLS_KEYLOG_DIR`         | TLS key log 文件目录。                     | `./artifacts/tmp`                              |
| `MCP_REGISTRY_CACHE_DIR`     | 远端扩展 registry 的本地缓存目录。         | `~/.jshookmcp/cache`                           |
| `CAPTCHA_PROVIDER`           | 自动验证码求解的默认 provider。            | `manual`                                       |
| `CAPTCHA_API_KEY`            | 自动验证码求解 provider 的 API Key。       | 无默认值                                       |
| `CAPTCHA_SOLVER_BASE_URL`    | 外部验证码求解服务基址。                   | 无默认值                                       |
| `CAPTCHA_2CAPTCHA_BASE_URL`  | 2Captcha 兼容求解服务备用基址。            | 无默认值                                       |
| `CAPTCHA_ANTICAPTCHA_BASE_URL` | Anti-Captcha JSON Task API 基址。        | 无默认值                                       |
| `CAPTCHA_CAPSOLVER_BASE_URL`   | CapSolver JSON Task API 基址。           | 无默认值                                       |
| `CAPTCHA_DEFAULT_TIMEOUT_MS` | CAPTCHA 默认等待超时。                     | `180000`                                       |
| `CAPTCHA_MIN_TIMEOUT_MS`     | CAPTCHA 最小等待超时。                     | `5000`                                         |
| `CAPTCHA_MAX_TIMEOUT_MS`     | CAPTCHA 最大等待超时。                     | `600000`                                       |
| `CAPTCHA_MAX_RETRIES`        | CAPTCHA 最大求解重试次数。                 | `5`                                            |
| `CAPTCHA_DEFAULT_RETRIES`    | CAPTCHA 默认求解重试次数。                 | `2`                                            |

> `captcha_vision_solve` 和 `widget_challenge_solve` 现在采用显式参数模式。自动化调用时应显式提供 `taskKind`、`siteKey`、`imageBase64`、`callbackName`、`responseSelector`，而不是依赖页面特征自动探测。

### 2. 主程序身份与日志

| 变量                      | 作用                             | 默认值 / 典型值   |
| ------------------------- | -------------------------------- | ----------------- |
| `MCP_SERVER_NAME`         | 进程对外公布的服务名。           | `jshookmcp`       |
| `MCP_SERVER_VERSION`      | 进程对外公布的服务版本。         | `0.1.8`（示例值） |
| `LOG_LEVEL`               | 日志级别。                       | `info`            |
| `RUNTIME_ERROR_WINDOW_MS` | 运行时错误恢复窗口长度（毫秒）。 | `60000`           |
| `RUNTIME_ERROR_THRESHOLD` | 恢复窗口内允许的可恢复错误阈值。 | `8`               |
| `SHUTDOWN_TIMEOUT_MS`     | 优雅关闭超时（毫秒）。           | `20000`           |
| `JSHOOK_INSTANCE_WARN_AT` | 检测到多少个存活 jshook 进程时告警。 | `2`            |
| `JSHOOK_MAX_INSTANCES`    | 存活服务进程硬上限；`0` 表示禁用。 | `0`             |

### 3. 档位、搜索与工具选择

| 变量                                      | 作用                                                  | 默认值 / 典型值           |
| ----------------------------------------- | ----------------------------------------------------- | ------------------------- |
| `MCP_TOOL_PROFILE`                        | 选择工具档位：`search` / `workflow` / `full`。`search` 启动时只注册 8 个元工具，其余域通过 `activate_domain` / `call_tool` 按需启用。 | 默认：`search`            |
| `MCP_TOOL_DOMAINS`                        | 手动指定启用域；设置后优先级高于 `MCP_TOOL_PROFILE`。 | 无默认值                  |
| `SEARCH_INTENT_TOOL_BOOST_RULES_JSON`     | 用 JSON 自定义”意图 -> 工具”加权规则。                | 无默认值                  |
| `MCP_DEFAULT_PLUGIN_BOOST_TIER`           | plugin 在 boost 时自动注册的默认档位。                | `full`                    |
| `SEARCH_AUTO_ACTIVATE_DOMAINS`            | 搜索到某域的工具时自动激活该域。                      | `true`                    |
| `SEARCH_VECTOR_ENABLED`                   | 向量搜索信号总开关（默认使用静态轻量模型）。所有传输下默认开启；模型按需加载、worker 空闲即释放，代价是一次有界的冷启动而非常驻内存。只需词法搜索时设为 `false`。 | `true` |
| `SEARCH_VECTOR_MODEL_ID`                  | Model2Vec 兼容的 HuggingFace 静态嵌入模型 ID。         | `minishlab/potion-code-16M-v2` |
| `SEARCH_VECTOR_COSINE_WEIGHT`             | 向量余弦信号在 RRF 融合中的初始权重。                 | `0.53`                    |
| `SEARCH_VECTOR_DYNAMIC_WEIGHT`            | 根据工具调用反馈自动调节向量权重。                    | `true`                    |
| `SEARCH_VECTOR_LEARN_UP`                  | 选中工具在向量 top-N 内时的权重上调步长。             | `0.13`                    |
| `SEARCH_VECTOR_LEARN_DOWN`                | 选中工具在向量 top-N 外时的权重下调步长。             | `0.02`                    |
| `SEARCH_VECTOR_LEARN_TOP_N`               | 区分向量"命中"与"未命中"的排名阈值。                  | `3`                       |
| `SEARCH_VECTOR_PREWARM`                   | 搜索引擎启动时是否立即加载 embedding 模型；共享 daemon 默认按需加载。 | `false`              |
| `SEARCH_VECTOR_WORKER_IDLE_MS`            | embedding worker 空闲多久后释放；`0` 表示常驻。          | stdio：`15000`；HTTP：`300000` |
| `SEARCH_VECTOR_FETCH_TIMEOUT_MS`          | 静态模型/tokenizer 单次下载请求超时。                    | `15000`                 |
| `JSHOOK_OBSERVABILITY_EXPORTER`          | 遥测后端：`none`（零开销 no-op）/ `memory`（进程内缓冲）/ `otlp`（标准 OTLP/HTTP 导出，任意 collector 式端点可接）。 | `none` |
| `JSHOOK_OBSERVABILITY_MAX_SPANS`         | `memory` 后端的 span 窗口上限。                          | `500`                   |
| `JSHOOK_OTLP_QUERY_TEXT`                 | `search.query` span 的查询文本采集策略：`off` / `truncated`（前 64 字符+溢出标记）/ `full`（逆向查询可能内嵌敏感信息，慎用 full）。 | `truncated` |
| `SEARCH_VECTOR_RETRY_COOLDOWN_MS`         | embedding 加载失败后的重试冷却时间。                     | `60000`                 |
| `SEARCH_VECTOR_CACHE_ENABLED`             | 是否将工具目录 embedding 持久化到磁盘。                  | `true`                  |
| `JSHOOK_EMBEDDING_CACHE_DIR`              | embedding 磁盘缓存目录覆盖值。                            | `~/.jshookmcp/cache/embeddings` |
| `JSHOOK_EMBEDDING_MODEL_CACHE_DIR`        | 下载的 tokenizer 和模型文件缓存目录覆盖值。              | `~/.jshookmcp/cache/models` |

### 4. 传输、HTTP 与安全

| 变量                              | 作用                                                   | 默认值 / 典型值    |
| --------------------------------- | ------------------------------------------------------ | ------------------ |
| `MCP_TRANSPORT`                   | 选择传输模式：`stdio` 或 `http`。                      | `stdio`            |
| `MCP_HOST`                        | HTTP 模式监听地址。                                    | `127.0.0.1`        |
| `MCP_PORT`                        | HTTP 模式监听端口。                                    | `3000`             |
| `MCP_AUTH_TOKEN`                  | 开启 Bearer Token 认证。                               | 无默认值           |
| `MCP_ALLOW_INSECURE`              | 当绑定非 localhost 时，是否允许无 token 的不安全模式。 | 默认关闭           |
| `MCP_MAX_BODY_BYTES`              | HTTP JSON 请求体大小上限。                             | `10 * 1024 * 1024` |
| `MCP_RATE_LIMIT_WINDOW_MS`        | HTTP 限流窗口时长。                                    | `60000`            |
| `MCP_RATE_LIMIT_MAX`              | HTTP 限流窗口内最大请求数。                            | `60`               |
| `MCP_HTTP_REQUEST_TIMEOUT_MS`     | HTTP 请求超时。                                        | `30000`            |
| `MCP_HTTP_HEADERS_TIMEOUT_MS`     | HTTP headers 超时。                                    | `10000`            |
| `MCP_HTTP_KEEPALIVE_TIMEOUT_MS`   | HTTP keep-alive 超时。                                 | `60000`            |
| `MCP_HTTP_FORCE_CLOSE_TIMEOUT_MS` | 连接强制关闭前的等待时间。                             | `5000`             |
| `MCP_RATE_LIMIT_ENABLED`          | 设为 `false` / `0` 可关闭 HTTP 限流。                  | 默认开启           |
| `MCP_TRUST_PROXY`                 | 设为 `true` / `1` 信任 `X-Forwarded-For` 头。          | 默认关闭           |
| `MCP_HEALTH_VERBOSE`              | 设为 `true` / `1` 启用详细 health-check 输出。         | 默认关闭           |

多个 Agent 共用一个进程时，先运行 `pnpm build && pnpm daemon`，再让所有 MCP 客户端连接
`http://127.0.0.1:3000/mcp`。HTTP transport 会按 `Mcp-Session-Id` 分离请求和响应路由，
同时共享 embedding、缓存与浏览器运行时。仅在 localhost 使用时可以不设 token；绑定到其他
地址前必须配置 `MCP_AUTH_TOKEN`。

#### 浏览器 session 与 worker

以下配置控制单个 server 进程中的浏览器请求上限：

| 变量 | 作用 | 默认值 |
| --- | --- | --- |
| `MCP_BROWSER_SESSION_QUEUE_MAX_PENDING` | 当前进程最多排队的浏览器请求数。 | `256` |
| `MCP_BROWSER_SESSION_QUEUE_MAX_PENDING_PER_SESSION` | 单个 session 最多排队的请求数。 | `16` |
| `MCP_BROWSER_SESSION_QUEUE_WAIT_TIMEOUT_MS` | 请求最长排队时间，单位毫秒。 | `180000` |
| `MCP_BROWSER_SESSION_SCHEDULER_QUANTUM_MS` | 调度时间片，单位毫秒。 | `250` |
| `MCP_BROWSER_SESSION_SCHEDULER_AGING_MS` | 排队 session 提升优先级前的等待时间。 | `15000` |
| `MCP_BROWSER_SESSION_EXPECTED_CONCURRENCY` | 预期同时活跃的 session 数。 | `10` |
| `MCP_BROWSER_SESSION_RESERVED_PENDING_PER_SESSION` | 为每个预期 session 保留的排队槽位。 | `1` |
| `MCP_BROWSER_SESSION_COST_EWMA_ALPHA` | 耗时估算更新系数，取值大于 `0` 且不超过 `1`。 | `0.2` |

运行多个 browser worker 时使用以下配置：

| 变量 | 作用 | 默认值 |
| --- | --- | --- |
| `MCP_BROWSER_FLEET_WORKER_ID` | 当前 worker 的 ID。 | `local` |
| `MCP_BROWSER_FLEET_WORKERS_JSON` | 包含全部 worker 的 JSON 数组。 | `[{"id":"local"}]` |
| `MCP_BROWSER_FLEET_VIRTUAL_NODES` | 每单位 worker 权重使用的路由条目数。 | `128` |
| `MCP_BROWSER_FLEET_LEASE_TTL_MS` | session 分配有效期，必须大于请求最长排队时间。 | `600000` |
| `MCP_BROWSER_FLEET_MAX_LOCAL_LEASES` | 当前 worker 最多保留的 session 与 session 资源数。 | `4096` |

每个进程使用相同的 worker 数组，并分别设置自己的 worker ID：

```dotenv
# worker-a
MCP_BROWSER_FLEET_WORKER_ID=worker-a
MCP_BROWSER_FLEET_WORKERS_JSON=[{"id":"worker-a","endpoint":"http://10.0.0.11:3000"},{"id":"worker-b","endpoint":"http://10.0.0.12:3000"}]
```

需要停止向某个 worker 分配新 session 时，将它的 `accepting` 设为 `false`。多 worker 模式还需要
在 server 启动前通过 `@jshookmcp/jshook/fleet-api` 注册共享 store；单 worker 模式不需要额外配置。

### 5. 扩展目录、签名与 registry

| 变量                            | 作用                                                                       | 默认值 / 典型值                                                                |
| ------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `MCP_PLUGIN_ROOTS`              | 逗号分隔的 plugin 根目录列表。                                             | 常见示例：`./plugins,./dist/plugins`                                           |
| `MCP_WORKFLOW_ROOTS`            | 逗号分隔的 workflow 根目录列表。                                           | 常见示例：`./workflows`                                                        |
| `MCP_PLUGIN_ALLOWED_DIGESTS`    | plugin 预导入 SHA-256 allowlist。                                          | 无默认值                                                                       |
| `MCP_PLUGIN_SIGNATURE_REQUIRED` | 是否强制要求 plugin 签名。                                                 | 生产环境默认趋严                                                               |
| `MCP_PLUGIN_STRICT_LOAD`        | 是否启用严格扩展加载策略。                                                 | 生产环境默认趋严                                                               |
| `EXTENSION_REGISTRY_BASE_URL`   | `browse_extension_registry` / `install_extension` 用的扩展 registry 基址。 | 无默认值；未设置时这两个工具直接报错，须显式配置                               |

### 6. 外部桥接与平台端点

| 变量                    | 作用                                   | 默认值 / 典型值                     |
| ----------------------- | -------------------------------------- | ----------------------------------- |
| `BURP_MCP_SSE_URL`      | Burp 官方 MCP SSE bridge 地址。        | `http://127.0.0.1:9876/sse`         |
| `GHIDRA_BRIDGE_URL`     | Ghidra REST bridge 端点。              | `http://127.0.0.1:18080`            |
| `IDA_BRIDGE_URL`        | IDA Pro bridge 端点。                  | `http://127.0.0.1:18081`            |
| `DEFAULT_DEBUG_PORT`    | 默认调试端口。                         | `9222`                              |

### 7. 缓存、Token 预算与性能

| 变量                                  | 作用                         | 默认值 / 典型值                   |
| ------------------------------------- | ---------------------------- | --------------------------------- |
| `ENABLE_CACHE`                        | 是否启用磁盘缓存。           | 代码默认 `false` |
| `CACHE_DIR`                           | 缓存目录。                   | `.cache`                          |
| `CACHE_TTL`                           | 缓存 TTL（秒）。             | `3600`                            |
| `CACHE_GLOBAL_MAX_SIZE_BYTES`         | 全局缓存大小上限。           | `524288000`                       |
| `TOKEN_BUDGET_MAX_TOKENS`             | Token 预算总上限。           | `200000`                          |
| `DETAILED_DATA_DEFAULT_TTL_MS`        | 详细数据默认 TTL。           | `1800000`                         |
| `DETAILED_DATA_MAX_TTL_MS`            | 详细数据最大 TTL。           | `3600000`                         |
| `DETAILED_DATA_SMART_THRESHOLD_BYTES` | 详细数据自动摘要阈值。       | `51200`                           |
| `MAX_CONCURRENT_ANALYSIS`             | 最大并发分析数。             | `3`                               |
| `MAX_CODE_SIZE_MB`                    | 分析阶段允许的最大代码体积。 | `10`                              |
| `jshook_IO_CONCURRENCY`               | I/O 并发上限。               | `4`                               |
| `jshook_CPU_CONCURRENCY`              | CPU 并发上限。               | `2`                               |
| `jshook_CDP_CONCURRENCY`              | CDP 并发上限。               | `2`                               |

### 8. Worker 池与并发调度

| 变量                             | 作用                      | 默认值 / 典型值 |
| -------------------------------- | ------------------------- | --------------- |
| `WORKER_POOL_MIN_WORKERS`        | Worker 池最小 worker 数。 | `2`             |
| `WORKER_POOL_MAX_WORKERS`        | Worker 池最大 worker 数。 | `4`             |
| `WORKER_POOL_IDLE_TIMEOUT_MS`    | Worker 空闲回收超时。     | `30000`         |
| `WORKER_POOL_JOB_TIMEOUT_MS`     | Worker 单任务超时。       | `15000`         |
| `PARALLEL_DEFAULT_CONCURRENCY`   | 默认并发执行数量。        | `3`             |
| `PARALLEL_DEFAULT_TIMEOUT_MS`    | 默认并发任务超时。        | `60000`         |
| `PARALLEL_DEFAULT_MAX_RETRIES`   | 默认并发重试次数。        | `2`             |
| `PARALLEL_RETRY_BACKOFF_BASE_MS` | 默认并发重试退避基数。    | `1000`          |

### 9. 外部工具 / 沙箱 / 符号执行

| 变量                                | 作用                          | 默认值 / 典型值 |
| ----------------------------------- | ----------------------------- | --------------- |
| `EXTERNAL_TOOL_TIMEOUT_MS`          | 外部工具执行总超时。          | `30000`         |
| `EXTERNAL_TOOL_PROBE_TIMEOUT_MS`    | 外部工具探测超时。            | `5000`          |
| `EXTERNAL_TOOL_PROBE_CACHE_TTL_MS`  | 外部工具探测缓存 TTL。        | `60000`         |
| `EXTERNAL_TOOL_FORCE_KILL_GRACE_MS` | 外部工具强杀前的 grace 时间。 | `2000`          |
| `EXTERNAL_TOOL_MAX_STDOUT_BYTES`    | 外部工具 stdout 最大字节数。  | `10485760`      |
| `EXTERNAL_TOOL_MAX_STDERR_BYTES`    | 外部工具 stderr 最大字节数。  | `1048576`       |
| `SANDBOX_EXEC_TIMEOUT_MS`           | 沙箱执行超时。                | `5000`          |
| `SANDBOX_MEMORY_LIMIT_MB`           | 沙箱内存上限。                | `128`           |
| `SANDBOX_STACK_SIZE_MB`             | 沙箱栈大小。                  | `4`             |
| `SANDBOX_TERMINATE_GRACE_MS`        | 沙箱终止前的 grace 时间。     | `2000`          |
| `SYMBOLIC_EXEC_MAX_PATHS`           | 符号执行最大路径数。          | `100`           |
| `SYMBOLIC_EXEC_MAX_DEPTH`           | 符号执行最大深度。            | `50`            |
| `SYMBOLIC_EXEC_TIMEOUT_MS`          | 符号执行超时。                | `30000`         |
| `PACKER_SANDBOX_TIMEOUT_MS`         | Packer 沙箱超时。             | `3000`          |

### 10. LLM token 与反混淆调优

| 变量                           | 作用                        | 默认值 / 典型值 |
| ------------------------------ | --------------------------- | --------------- |
| `ADV_DEOBF_LLM_MAX_TOKENS`     | 高级反混淆 LLM token 上限。 | `3000`          |
| `VM_DEOBF_LLM_MAX_TOKENS`      | VM 反混淆 LLM token 上限。  | `4000`          |
| `DEOBF_LLM_MAX_TOKENS`         | 通用反混淆 LLM token 上限。 | `2000`          |
| `CRYPTO_DETECT_LLM_MAX_TOKENS` | 加密检测 LLM token 上限。   | `2000`          |

### 11. Workflow 批处理与 bundle 缓存

| 变量                              | 作用                              | 默认值 / 典型值 |
| --------------------------------- | --------------------------------- | --------------- |
| `WORKFLOW_BATCH_MAX_RETRIES`      | workflow 批处理默认最大重试次数。 | `3`             |
| `WORKFLOW_BATCH_MAX_TIMEOUT_MS`   | workflow 批处理默认最大超时。     | `300000`        |
| `WORKFLOW_BUNDLE_CACHE_TTL_MS`    | workflow bundle 缓存 TTL。        | `300000`        |
| `WORKFLOW_BUNDLE_CACHE_MAX_BYTES` | workflow bundle 缓存大小上限。    | `104857600`     |

### 12. 内存操作

| 变量                                 | 作用                          | 默认值 / 典型值 |
| ------------------------------------ | ----------------------------- | --------------- |
| `MEMORY_READ_TIMEOUT_MS`             | 内存读取超时。                | `10000`         |
| `MEMORY_MAX_READ_BYTES`              | 单次内存读取最大字节数。      | `16777216`      |
| `MEMORY_WRITE_TIMEOUT_MS`            | 内存写入超时。                | `10000`         |
| `MEMORY_MAX_WRITE_BYTES`             | 单次内存写入最大字节数。      | `16384`         |
| `MEMORY_DUMP_TIMEOUT_MS`             | 内存 dump 超时。              | `60000`         |
| `MEMORY_SCAN_TIMEOUT_MS`             | 内存扫描超时。                | `120000`        |
| `MEMORY_SCAN_MAX_BUFFER_BYTES`       | 内存扫描时允许的最大缓冲区。  | `52428800`      |
| `MEMORY_SCAN_MAX_RESULTS`            | 内存扫描最大结果数。          | `10000`         |
| `MEMORY_SCAN_MAX_REGIONS`            | 内存扫描最大 region 数。      | `50000`         |
| `MEMORY_SCAN_REGION_MAX_BYTES`       | 单个扫描 region 最大字节数。  | `16777216`      |
| `MEMORY_INJECT_TIMEOUT_MS`           | 注入操作超时。                | `30000`         |
| `MEMORY_MONITOR_INTERVAL_MS`         | 内存监控轮询间隔。            | `1000`          |
| `MEMORY_VMMAP_TIMEOUT_MS`            | 内存映射查询超时。            | `15000`         |
| `MEMORY_PROTECTION_QUERY_TIMEOUT_MS` | 内存保护属性查询超时。        | `15000`         |
| `MEMORY_PROTECTION_PWSH_TIMEOUT_MS`  | PowerShell 保护属性查询超时。 | `30000`         |
| `NATIVE_ADMIN_CHECK_TIMEOUT_MS`      | 管理员权限检查超时。          | `5000`          |
| `NATIVE_SCAN_MAX_RESULTS`            | Native 扫描最大结果数。       | `10000`         |
| `PROCESS_LAUNCH_WAIT_MS`             | 启动调试进程后的等待时间。    | `2000`          |
| `WIN_DEBUG_PORT_POLL_ATTEMPTS`       | Windows 调试端口轮询次数。                | `20`            |
| `WIN_DEBUG_PORT_POLL_INTERVAL_MS`    | Windows 调试端口轮询间隔。                | `500`           |

### 13. ADB 桥接与二进制插桩

| 变量                            | 作用                                      | 默认值 / 典型值  |
| ------------------------------- | ----------------------------------------- | ---------------- |
| `ADB_PATH`                      | `adb` 可执行文件路径。                    | `adb`（从 PATH） |
| `ADB_DEFAULT_TIMEOUT_MS`        | ADB 命令默认超时。                        | `30000`          |
| `ADB_SHELL_TIMEOUT_MS`          | ADB shell 命令超时。                      | `60000`          |
| `ADB_WEBVIEW_HTTP_TIMEOUT_MS`   | ADB WebView HTTP 超时。                   | `5000`           |
| `ADB_WEBVIEW_WS_TIMEOUT_MS`     | ADB WebSocket 超时。                      | `10000`          |
| `ADB_VERSION_CHECK_TIMEOUT_MS`  | ADB 版本检查超时。                        | `5000`           |
| `UNIDBG_JAR`                    | Unidbg JAR 文件路径。                     | 无默认值         |
| `JAVA_HOME`                     | Java 运行时路径（Unidbg/Ghidra 使用）。   | 无默认值         |
| `FRIDA_TIMEOUT_MS`              | Frida 插桩超时。                          | `15000`          |
| `GHIDRA_TIMEOUT_MS`             | Ghidra 分析超时。                         | `120000`         |
| `UNIDBG_TIMEOUT_MS`             | Unidbg 模拟超时。                         | `60000`          |

### 14. 域专用调优

| 变量                                 | 作用                                  | 默认值 / 典型值 |
| ------------------------------------ | ------------------------------------- | --------------- |
| `GRAPHQL_MAX_PREVIEW_CHARS`          | GraphQL 响应最大预览字符数。          | `4000`          |
| `GRAPHQL_MAX_SCHEMA_CHARS`           | GraphQL introspection 最大 schema。   | `120000`        |
| `GRAPHQL_MAX_QUERY_CHARS`            | GraphQL 最大查询长度。                | `12000`         |
| `NETWORK_REPLAY_TIMEOUT_MS`          | 网络请求重放超时。                    | `30000`         |
| `NETWORK_REPLAY_MAX_BODY_BYTES`      | 重放请求最大 body 大小。              | `512000`        |
| `NETWORK_REPLAY_MAX_REDIRECTS`       | 重放请求最大重定向次数。              | `5`             |
| `NETWORK_BODY_CACHE_MAX_ENTRIES`     | 响应体缓存最大条目数。                 | `200`           |
| `NETWORK_BODY_CACHE_MAX_BODY_BYTES`  | 单个响应体缓存字节上限。               | `1048576`       |
| `NETWORK_BODY_CACHE_MAX_TOTAL_BYTES` | 响应体缓存总字节预算。                 | `67108864`      |
| `WASM_TOOL_TIMEOUT_MS`               | WASM 工具通用超时。                   | `60000`         |
| `WASM_OFFLINE_RUN_TIMEOUT_MS`        | WASM 离线运行超时。                   | `10000`         |
| `WASM_OPTIMIZE_TIMEOUT_MS`           | WASM 优化超时。                       | `120000`        |
| `EMULATOR_FETCH_GOTO_TIMEOUT_MS`     | 模拟器页面导航超时。                  | `30000`         |
| `DEBUGGER_WAIT_FOR_PAUSED_TIMEOUT_MS`| 等待调试器暂停状态的超时。            | `30000`         |
| `WATCH_EVAL_TIMEOUT_MS`              | Watch 表达式求值超时。                | `5000`          |

### 15. 平台、安全与 Schema

| 变量                       | 作用                                              | 默认值 / 典型值       |
| -------------------------- | ------------------------------------------------- | --------------------- |
| `JSHOOK_REGISTRY_PLATFORM` | 覆盖平台检测（`win32`/`linux`/`darwin`）。        | 自动检测              |
| `JSHOOK_REDACTION_LEVEL`   | 输出脱敏级别（`none`/`standard`/`strict`）。      | `standard`            |
| `JSHOOK_ENABLE_MOJO_IPC`   | 启用 Chromium Mojo IPC 监控。                     | 默认关闭              |
| `JSHOOK_FORCE_LINUX_FALLBACK` | 强制 Linux 浏览器回退行为。                     | 默认关闭              |
| `ALLOW_LOCAL_SSRF`         | 允许本地网络 SSRF 目标。                          | 默认关闭              |
| `MCP_COMPACT_SCHEMA`       | 使用紧凑工具 schema 输出。                        | `true`                |
| `DISCOVERY_STRICT`         | 域 manifest 发现的严格模式。                      | 默认关闭              |
| `JSHOOK_CONNECT_TIMEOUT_MS`| 浏览器连接超时。                                  | `60000`               |
