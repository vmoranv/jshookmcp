---
layout: home

hero:
  name: JSHookMCP
  text: 检索优先跨域逆向工程工作区
  tagline: "专为 AI Agent 设计的 735 个工具 × 36 个能力域：从网络数据包、DOM、V8/WASM 到原生内存、Unicorn JNI 仿真与内核系统调用，全链路因果证据图与 3K Token 检索梯队。"
  image:
    src: /favicon.png
    alt: JSHookMCP
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: 36 域工具参考
      link: /reference/

features:
  - title: 检索优先 3K 梯队
    icon: ⚡
    details: "彻底解决 735 个工具导致的大模型上下文爆炸。初始仅加载 ~3K tokens 元基座，通过 BM25 + 本地 ONNX 向量微模型 + RRF 动态按需激活。"
  - title: 跨域全链路因果图
    icon: 🌐
    details: "首创 7 层执行堆栈因果图谱，从 HTTP/2 网络包穿透至 DOM、JS AST、V8 Turbofan、WASM、Native 内存、Unicorn JNI 与系统调用。"
  - title: 无设备 Android JNI 仿真
    icon: 📱
    details: "内置基于 Unicorn 的 ARM/ARM64 CPU 仿真器（nemu），无需任何真机或模拟器，宿主进程内直接执行 .so 并自动化 Mock Java JNI 环境。"
  - title: Flutter & Dart AOT 内省
    icon: 🎯
    details: "专治现代 Flutter 静态分析难题，自动化解析 Dart Snapshot Header，转储 Object Pool，执行 SMI 扫描与 PC Descriptors 映射。"
  - title: Chromium Mojo IPC 嗅探
    icon: 🔬
    details: "直连 Chromium 内部多进程通信总线，嗅探、解析与 Mock 浏览器底层 IPC 消息通道。"
  - title: 专业级底层内存取证
    icon: 🛡️
    details: "Cheat Engine / ReClass 级原生能力：AOB 字节特征码扫描、多级指针链收敛、虚表/RTTI 解析与硬件断点。"
---

## ⚡ 极速接入

只需将以下配置添加到你的 MCP 客户端（如 Claude Desktop、Cursor、Claude Code 或 Windsurf）即可完成接入：

```json
{
  "mcpServers": {
    "jshook": {
      "command": "npx",
      "args": ["-y", "@jshookmcp/jshook"]
    }
  }
}
```

::: tip 生产环境 Profile 分层
默认通过 `MCP_TOOL_PROFILE=search` 运行，仅占用约 3,000 tokens 上下文空间，Agent 在需要时会通过内置的 `search_tools` / `route_tool` / `activate_tools` 自动按需激活能力。
:::

---

## 核心架构与技术差异点

现代复杂的对抗型应用（Web SPA、Electron 桌面端、混合型 Android App）往往将逻辑分散在网络协议混淆、V8 JIT 优化、WebAssembly 虚拟机、Native `.so` 动态库及底层系统调用中。传统工具往往单点孤立，导致 AI Agent 无法穿透上下文边界。

JSHookMCP 为 AI Agent 提供了**端到端闭环的跨域因果证据图谱**：

```text
[网络层: HTTP/2 / gRPC / Protobuf / TLS Keylog]
       ↓
[DOM / UI 交互层: Camoufox CDP / Canvas / WebGL]
       ↓
[JS / 运行时层: AST 控制流平坦化还原 / V8 Turbofan JIT / 堆差异]
       ↓
[WASM 虚拟机层: Wasm2C 反编译 / VMP 追踪 / 动态插桩]
       ↓
[底层通信: Chromium Mojo IPC 消息嗅探与 Mock]
       ↓
[Native 内存层: AOB 特征扫描 / 多级指针链 / 虚表 RTTI]
       ↓
[无设备 JNI 仿真: Unicorn ARM64 / Java JNI 环境自动 Mock]
       ↓
[操作系统内核: POSIX Syscall / Mach Trap / Win32 VEH / eBPF]
```

### 与单一领域工具对比

| 能力对比 | 基础浏览器 MCP (Playwright/Puppeteer) | 单点二进制 MCP (Ghidra/IDA) | 传统动态工具 (Frida/CheatEngine) | **JSHookMCP** |
| :--- | :---: | :---: | :---: | :---: |
| **工具总数与能力域** | ~10-20 工具 | ~10-30 工具 | 散装脚本 | **735 工具 × 36 能力域** |
| **大模型上下文占用** | 几千 tokens | 几万 tokens (易溢出) | 无原生封装 | **检索优先 3K 梯队 (动态激活)** |
| **全链路跨域因果图** | ❌ 仅限 DOM/Network | ❌ 仅限单个可执行文件 | ❌ 需人工手工拼接 | **✅ 自动跨域因果推导与证据归档** |
| **无设备 Android JNI 仿真** | ❌ 无 | ❌ 无 | ❌ 必须真机/模拟器 | **✅ 内置 Unicorn ARM64 无头仿真** |
| **Flutter / Dart AOT 快照解析**| ❌ 无 | ❌ 极差 | ❌ 极难逆向 | **✅ AOT 快照转储、SMI与调用图** |
| **Chromium Mojo IPC 拦截** | ❌ 无 | ❌ 无 | ❌ 无 | **✅ 内部 IPC 消息解析与 Mock** |
| **底层内存 AOB 扫描与指针收敛** | ❌ 无 | ❌ 静态分析 | ⚠️ 仅本地客户端 | **✅ 完整暴露给 Agent 驱动执行** |

---

## 36 个能力域概览

| 域分类 | 包含能力域 | 典型核心工具 |
| :--- | :--- | :--- |
| **跨域因果与分析** | `cross-domain`, `core`, `trace`, `session` | 跨域证据链图谱、执行追踪录制、意图路由、覆盖率计算 |
| **无头仿真与移动端** | `native-emulator` (`nemu`), `dart-inspector`, `adb-bridge` | Unicorn ARM64 JNI 仿真、Flutter AOT 快照转储、ADB 冷启动抓取 |
| **浏览器与运行时内省** | `browser`, `v8-inspector`, `mojo-ipc`, `canvas`, `webgpu` | Camoufox 反指纹 CDP、V8 Turbofan JIT 观察、Mojo IPC 拦截 |
| **二进制插桩与内存取证**| `memory`, `process`, `binary-instrument`, `native-bridge` | AOB 扫描、指针地图收敛、Frida 动态拦截、Ghidra/IDA 符号同步 |
| **逆向反编译与语法分析**| `wasm`, `transform`, `sourcemap`, `platform` | Wasm2C 反编译、控制流平坦化还原、SourceMap 语法树重建 |
| **网络全栈与密钥取证** | `network`, `tls-inspector`, `proxy`, `streaming`, `protocol-analysis`, `graphql` | NSS TLS 密钥日志、gRPC/Protobuf 编解码、中间人代理、WebSocket 实时监控 |
| **漏洞利用与内核监控** | `syscall-hook`, `exploit-dev`, `encoding` | 系统调用监控、eBPF 追踪、ROP 链自动搜寻、原始 Protobuf 解码 |
| **工程化编排与运维扩展**| `workflow`, `coordination`, `extension-registry`, `tasks`, `maintenance`, `instrumentation` | 多 Agent 协作状态板、异步任务队列、热重载插件、Token 预算监控 |

完整 735 个工具详细参数说明见 [工具参考](/reference/)。

---

## 运行平台与环境支持

- **Windows**: Win32 API 模块、VEH 硬件断点与 PE 深度解析。
- **macOS**: Mach trap 端口、反汇编与 Apple Silicon / Intel 双架构支持。
- **Linux**: POSIX syscall 直接追踪与 eBPF 内核探测。

---

## 快速导航

- [快速开始](/guide/getting-started) — 从安装、启动到抓取首批交互
- [工具选择策略](/guide/tool-selection) — 按逆向任务从 735 个工具中快速定域
- [最佳实践](/guide/best-practices) — 检索优先模式与 Agent 调用规范
- [配置说明](/guide/configuration) — `.env` 变量与 Profile 梯队设置
- [运维与诊断](/operations/doctor-and-artifacts) — 系统健康检查与产物持久化
- [贡献指南](/contributing) — 构建、测试与提交流程
