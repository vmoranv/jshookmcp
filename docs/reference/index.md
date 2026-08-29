# Reference Overview

当前包含以下工具域：

## 推荐阅读路径

1. 先看 `browser / network / workflow`，建立日常使用路径。
2. 再看 `debugger / instrumentation / streaming`，理解运行时分析面。
3. 最后看 `core / sourcemap / transform / wasm / process / platform`，覆盖更深入的逆向面。

## 域矩阵

| 域 | 标题 | 适用 profile | 典型场景 |
| --- | --- | --- | --- |
| `adb-bridge` | ADB 桥接 | full | Android Debug Bridge 集成域，用于设备管理、应用分析和远程调试。 |
| `binary-instrument` | 二进制插桩 | full | 二进制插桩域，提供二进制分析、运行时插桩、APK 加固识别与密钥候选扫描能力。 |
| `boringssl-inspector` | BoringSSL 检查 | workflow, full | BoringSSL/TLS 检查域，支持 TLS 流量分析和证书检查。 |
| `browser` | 浏览器 | workflow, full | 浏览器控制与 DOM 交互主域，也是大多数工作流的入口。 |
| `canvas` | 画布引擎 | workflow, full | 游戏引擎 Canvas 逆向分析域与 Skia 渲染引擎捕获域，支持 Laya/Pixi/Phaser/Cocos/Unity 等主流游戏引擎的指纹识别、场景树导出、对象拾取，以及 Skia GPU 后端检测与场景提取。 |
| `coordination` | 协调 | workflow, full | 用于会话洞察记录、MCP Task Handoff 与跨 Agent 共享状态板的协调域，衔接大语言模型的规划与执行。 |
| `core` | 核心 | workflow, full | 核心静态/半静态分析域，覆盖脚本采集、反混淆、语义理解、webpack/source map 与加密识别。 |
| `cross-domain` | 跨域关联 | full | 跨域关联域，将多个域的分析结果进行交叉关联，支持自动化工作流编排与证据图桥接。 |
| `dart-inspector` | Dart 检查 | full | 从 Flutter AOT libapp.so 中抽取并分类字符串、还原 Smi 整数常量，并使用开发者提供的混淆映射反查原始符号。 |
| `debugger` | 调试器 | workflow, full | 基于 CDP 的断点、单步、调用栈、watch、调试会话管理与反反调试域。 |
| `encoding` | 编码 | workflow, full | 二进制格式检测、编码转换、熵分析与 protobuf 原始解码。 |
| `exploit-dev` | 漏洞开发 | full | 二进制漏洞利用开发域，提供 ROP/JOP gadget 搜索、shellcode 编码、保护机制检测与偏移计算。 |
| `extension-registry` | 扩展注册 | full | 扩展注册域，管理和发现社区扩展。 |
| `graphql` | 图查询 | workflow, full | GraphQL 发现、提取、重放与 introspection 能力。 |
| `instrumentation` | 仪器化 | full | 统一仪器化会话域，将 Hook、拦截、Trace、证据图与产物记录收束到可查询的 session 中。 |
| `maintenance` | 维护 | workflow, full | 运维与维护域，覆盖缓存、token 预算、环境诊断、产物清理、扩展管理与安全沙箱执行。 |
| `memory` | 内存 | full | 面向原生内存扫描、指针链分析、结构体推断与断点观测的内存分析域。 |
| `mojo-ipc` | Mojo IPC | full | Mojo IPC 监控域，用于 Chromium 内部进程间通信分析。 |
| `native-bridge` | 原生桥接 | full | 原生分析工具桥接域，通过本地 loopback HTTP bridge 对接 Ghidra、IDA、Rizin/r2 与 Binary Ninja，用于函数枚举、反编译/反汇编、字符串搜索、交叉引用与符号同步。 |
| `native-emulator` | 原生仿真 | workflow, full | 进程内、零外部依赖的自研 ARM64 解释器，用于仿真执行 Android `.so`：加载共享库、注册模拟 Java 方法、调用导出函数或 `Java_*` JNI 入口，以还原签名/加密算法。无需真机、JVM 或 Frida。会话隔离且显式管理（create→…→destroy），空闲自动过期防泄漏。libapp.so（Flutter Dart AOT）不在此执行，应交给 Dart 层。 |
| `network` | 网络 | workflow, full | 请求捕获、响应体读取、HAR 导出、请求重放与性能追踪。 |
| `platform` | 平台 | full | 宿主平台与包格式分析域，覆盖 miniapp、asar、Electron。 |
| `process` | 进程 | full | 进程、模块、内存诊断与受控注入域，适合宿主级分析、故障排查与 Windows 进程实验场景。 |
| `protocol-analysis` | 协议分析 | full | 自定义协议分析域，支持协议模式定义、自动字段检测、状态机推断和可视化。 |
| `proxy` | 代理 | full | 全栈 HTTP/HTTPS 中间人代理域，提供系统级的流量拦截、篡改与应用级挂载配置。 |
| `sourcemap` | 源映射 | full | SourceMap 发现、抓取、解析与源码树重建。 |
| `streaming` | 流式 | workflow, full | WebSocket 与 SSE 监控域。 |
| `syscall-hook` | 系统调用挂钩 | full | 系统调用挂钩域，提供系统调用监控和映射能力。 |
| `tasks` | 后台任务 | workflow, full | MCP 2.0 Tasks 协议域：查询、轮询、取消由长耗时工具创建的后台任务。 |
| `trace` | 追踪 | full | 时间旅行调试域，录制 CDP 事件并写入 SQLite，支持 SQL 查询与堆快照对比。 |
| `transform` | 变换 | full | AST/字符串变换与加密实现抽取、测试、对比域。 |
| `v8-inspector` | V8 检查器 | workflow, full | V8 检查器域，提供堆快照分析、CPU 分析和内存检查。 |
| `wasm` | WASM | full | WebAssembly dump、反汇编、反编译、优化与离线执行域。 |
| `webgpu` | WebGPU | workflow, full | WebGPU 逆向分析域，支持 GPU 适配器信息、shader 编译反汇编、计时侧信道分析与内存布局检查。 |
| `workflow` | 工作流 | workflow, full | 复合工作流、脚本库与宏编排域，是 built-in 高层编排入口。 |

## 重点高层入口

- `api_probe_batch`：批量探测 OpenAPI / Swagger / API 端点
- `js_bundle_search`：远程抓取 bundle 并做多模式匹配
- `page_script_register` / `page_script_run`：复用页面内脚本完成定制化采集与自动化
- `doctor_environment`：环境依赖与 bridge 健康检查
- `cleanup_artifacts`：按 retention / size 规则清理产物
- `list_extension_workflows` / `run_extension_workflow`：发现并执行外置扩展工作流
