# Reference Overview

当前内置域共 **35** 个，域工具总数 **424**。

## 推荐阅读路径

1. 先看 `browser / network / workflow`，建立日常使用路径。
2. 再看 `debugger / hooks / streaming`，理解运行时分析面。
3. 最后看 `core / sourcemap / transform / wasm / process / platform`，覆盖更深入的逆向面。

## 域矩阵

| 域 | 标题 | 工具数 | 适用 profile | 典型场景 |
| --- | --- | ---: | --- | --- |
| `adb-bridge` | ADB Bridge | 6 | workflow, full | Android Debug Bridge 集成域，用于设备管理、应用分析和远程调试。 |
| `antidebug` | AntiDebug | 6 | full | 反反调试域，集中提供检测与绕过浏览器端反调试脚本的工具。 |
| `binary-instrument` | Binary Instrument | 19 | workflow, full | 二进制插桩域，提供二进制分析和运行时插桩能力。 |
| `boringssl-inspector` | BoringSSL Inspector | 17 | workflow, full | BoringSSL/TLS 检查域，支持 TLS 流量分析和证书检查。 |
| `browser` | Browser | 63 | workflow, full | 浏览器控制与 DOM 交互主域，也是大多数工作流的入口。 |
| `canvas` | Canvas | 4 | workflow, full | 游戏引擎 Canvas 逆向分析域，支持 Laya/Pixi/Phaser/Cocos/Unity 等主流游戏引擎的指纹识别、场景树导出和对象拾取。 |
| `coordination` | Coordination | 7 | workflow, full | 用于会话洞察记录与 MCP Task Handoff 的协调域，衔接大语言模型的规划与执行。 |
| `core` | Core | 14 | workflow, full | 核心静态/半静态分析域，覆盖脚本采集、反混淆、语义理解、webpack/source map 与加密识别。 |
| `cross-domain` | Cross-Domain | 6 | workflow, full | 跨域关联域，将多个域的分析结果进行交叉关联，支持自动化工作流编排与证据图桥接。 |
| `debugger` | Debugger | 37 | workflow, full | 基于 CDP 的断点、单步、调用栈、watch 与调试会话管理域。 |
| `encoding` | Encoding | 5 | workflow, full | 二进制格式检测、编码转换、熵分析与 protobuf 原始解码。 |
| `evidence` | Evidence | 6 | workflow, full | 逆向证据图域，用图结构串联 URL、脚本、函数、Hook 与捕获产物之间的溯源关系。 |
| `extension-registry` | Extension Registry | 9 | workflow, full | 扩展注册域，管理和发现社区扩展。 |
| `graphql` | GraphQL | 5 | workflow, full | GraphQL 发现、提取、重放与 introspection 能力。 |
| `hooks` | Hooks | 7 | workflow, full | AI Hook 生成、注入、数据导出，以及内置/自定义 preset 管理。 |
| `instrumentation` | Instrumentation | 10 | workflow, full | 统一仪器化会话域，将 Hook、拦截、Trace 与产物记录收束到可查询的 session 中。 |
| `macro` | Macro | 2 | full | 子代理宏编排域，将多步工具调用组合为可复用的宏流程。 |
| `maintenance` | Maintenance | 12 | search, workflow, full | 运维与维护域，覆盖缓存、token 预算、环境诊断、产物清理与扩展管理。 |
| `memory` | Memory | 41 | workflow, full | 面向原生内存扫描、指针链分析、结构体推断与断点观测的内存分析域。 |
| `mojo-ipc` | Mojo IPC | 5 | workflow, full | Mojo IPC 监控域，用于 Chromium 内部进程间通信分析。 |
| `network` | Network | 29 | workflow, full | 请求捕获、响应体读取、HAR 导出、请求重放与性能追踪。 |
| `platform` | Platform | 15 | full | 宿主平台与包格式分析域，覆盖 miniapp、asar、Electron。 |
| `process` | Process | 26 | full | 进程、模块、内存诊断与受控注入域，适合宿主级分析、故障排查与 Windows 进程实验场景。 |
| `protocol-analysis` | Protocol Analysis | 6 | workflow, full | 自定义协议分析域，支持协议模式定义、自动字段检测、状态机推断和可视化。 |
| `sandbox` | Sandbox | 1 | full | 基于 QuickJS WASM 的安全沙箱域，支持执行自定义脚本并调用 MCP 工具。 |
| `shared-state-board` | Shared State Board | 10 | workflow, full | 跨 Agent 状态同步域，提供全局共享的状态板用于多 Agent 协作。 |
| `skia-capture` | Skia Capture | 3 | workflow, full | Skia 渲染引擎捕获域，用于 UI 渲染分析和可视化。 |
| `sourcemap` | SourceMap | 3 | workflow, full | SourceMap 发现、抓取、解析与源码树重建。 |
| `streaming` | Streaming | 6 | workflow, full | WebSocket 与 SSE 监控域。 |
| `syscall-hook` | Syscall Hook | 6 | workflow, full | 系统调用挂钩域，提供系统调用监控和映射能力。 |
| `trace` | Trace | 7 | workflow, full | 时间旅行调试域，录制 CDP 事件并写入 SQLite，支持 SQL 查询与堆快照对比。 |
| `transform` | Transform | 6 | workflow, full | AST/字符串变换与加密实现抽取、测试、对比域。 |
| `v8-inspector` | V8 Inspector | 8 | workflow, full | V8 检查器域，提供堆快照分析、CPU 分析和内存检查。 |
| `wasm` | WASM | 8 | full | WebAssembly dump、反汇编、反编译、优化与离线执行域。 |
| `workflow` | Workflow | 9 | workflow, full | 复合工作流与脚本库域，是 built-in 高层编排入口。 |

## 重点高层入口

- `web_api_capture_session`：一键抓请求、提取 auth、导出 HAR/报告
- `register_account_flow`：注册 + 邮箱验证流程
- `api_probe_batch`：批量探测 OpenAPI / Swagger / API 端点
- `js_bundle_search`：远程抓取 bundle 并做多模式匹配
- `doctor_environment`：环境依赖与 bridge 健康检查
- `cleanup_artifacts`：按 retention / size 规则清理产物
