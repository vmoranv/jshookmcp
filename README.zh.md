# @jshookmcp/jshook

[![License: AGPLv3](https://img.shields.io/badge/License-AGPLv3-red.svg)](LICENSE)
[![Node.js 20.19+ or 22.12+](https://img.shields.io/badge/node-20.19%2B%20%7C%2022.12%2B-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-current-8A2BE2.svg)](https://modelcontextprotocol.io/)
[![pnpm](https://img.shields.io/badge/pnpm-10.x-F69220.svg)](https://pnpm.io/)

[English](./README.md) | 中文

面向 AI 辅助 JavaScript 分析与安全分析的 MCP（模型上下文协议）服务器，内置工具面来自运行时 registry，而不是手写清单。它将浏览器自动化、Chrome DevTools Protocol 调试、网络监控、JavaScript Hook、LLM 驱动代码分析、进程与内存检查、WASM 工具链、Source Map 重建、AST 变换与复合工作流整合到同一服务中。

## 文档与快速导航

- **[📖 阅读官方文档](https://vmoranv.github.io/jshookmcp/)**
- **[🚀 快速开始](https://vmoranv.github.io/jshookmcp/guide/getting-started.html)**
- **[⚙️ 配置指南](https://vmoranv.github.io/jshookmcp/guide/configuration.html)**
- **[📚 API 与工具参考](https://vmoranv.github.io/jshookmcp/reference/)**
## 🚀 快速接入 (Quick Start)

无需全局安装任何环境，使用 `npx` 即可让 Claude Desktop 或 Cursor 瞬间获得强大的全双工安全分析能力。

**Claude Desktop 配置 (`claude_desktop_config.json`)**:
```json
{
  "mcpServers": {
    "jshook": {
      "command": "npx",
      "args": ["-y", "@jshookmcp/jshook@latest"],
      "env": {
        "JSHOOK_BASE_PROFILE": "search"
      }
    }
  }
}
```
*(Windows 用户注意: 若报错找不到 npx，请指定为绝对路径 `npx.cmd`)*

## 🌟 核心亮点

- 🤖 **AI 智能分析**：结合大语言模型实现 JavaScript 语义级反混淆、加密算法识别与深度 AST 结构理解。
- ⚡ **搜索优先的上下文效率**：BM25 驱动的 `search_tools` 配合动态加权，可将 jshook 内置配置档位中的“工具 schema 增量初始化上下文”从 `full` 档约 ~40.0K+ tokens 降至 `search` 档约 ~3.0K（Claude 服务端计数；不含 Claude Code 基线提示词）。
- 🎯 **渐进式能力分层**：内置三档配置（`search`/`workflow`/`full`），默认从 `search` 基座档启动，按需升级能力范围。
- 🌐 **全链路自动化**：将浏览器环境（Chromium/Camoufox）、CDP 底层调试与网络拦截无缝整合为原子操作。
- 🛡️ **高级反反调试**：内置强大的指纹伪装与检测绕过补丁，轻松应对各类反爬与调试器对抗保护。
- 🧩 **动态热插拔扩展**：支持从本地目录动态加载插件与高层工作流，无需重新编译主服务即可无限横向拓展能力。
- 🔧 **零胶水扩展性**：通过 `manifest.ts` 自动发现域、懒加载处理器实例化、B-Skeleton 契约驱动的插件/工作流架构。
- 🛠️ **全能逆向工具链**：集成 WASM 反编译、二进制漏洞/熵分析、实时内存扫描，并原生提供 Burp Suite 与 Ghidra/IDA Pro 桥接。

## 🛡️ 核心能力矩阵

JSHookMCP 跨 36 个技术域提供了 **360+ 个内置原子工具**，赋予 AI 前所未有的能力栈：

- 🕸️ **浏览器自动化与逆向**：零配置注入 Chromium/Camoufox，接管 CDP (Chrome DevTools Protocol) 编排，支持 iframe 跨域突破。
- 📡 **网络拦截与流量嗅探**：深度 HTTP/2 帧构造、中间人 (MiTM) 流量捕获、GraphQL 内省嗅探以及 Burp Suite 无缝桥接。
- 🧠 **AST 与语义分析**：大模型驱动的代码反混淆、WebAssembly (WASM) 实时反编译、Source Map 重建以及二进制熵值可视化。
- 🧰 **进程与内存剖析**：系统级 Frida hook 注入、内存地址扫描挖掘、指针解引用以及严苛的反反调试 (Anti-Debug) 对抗。
- 🔌 **动态扩展性引擎**：支持热重载的 B-Skeleton 插件系统与声明式 `WorkflowContract` 业务流管线。

> **[查看完整的 36 个能力域与工具参考 ↗](https://vmoranv.github.io/jshookmcp/reference/)**

## 架构与性能

> [!TIP]
> **上下文效率基准 (Context Efficiency Benchmark)**：基于 Claude 服务端实测，“Schema 初始化 Context 增量” —— `search` 档 ≈ 3.0K tokens vs `full` 档 ≈ 40.0K+ tokens。

- **渐进式工具发现**：`search_tools` 元工具（BM25 排序）+ `activate_tools` / `activate_domain` + 配置档位升级（`boost_profile`）
- **search 档行为说明**：`search_tools` 只负责检索与排序，不会自动 `activate_tools`，也不会自动 `boost_profile`；推荐链路是 `search_tools -> activate_tools / activate_domain -> （确有需要时）boost_profile`
- **单工具不必先升档**：`activate_tools` 可跨当前基座档精确启用单个工具；只有在你接下来会反复使用一整组相关能力时，`boost_profile` 才更合适
- **域延迟初始化**：处理器类通过 Proxy 在首次调用时实例化，而非启动时预加载
- **域自发现架构**：运行时扫描 `domains/*/manifest.ts` 替代硬编码导入；新增域只需创建一个 manifest 文件
- **B-Skeleton 契约**：插件（`PluginContract`）、工作流（`WorkflowContract`）、可观测性（`InstrumentationContract`）的扩展性契约
- **MCP ToolAnnotations**：每个工具均带有语义标注（`readOnlyHint`、`destructiveHint`、`idempotentHint`、`openWorldHint`），使 AI 协调器能在调用前推理工具安全性与副作用

## 注册表快照

下面的内置能力快照由运行时 registry 动态生成，并在 CI 中校验。

<!-- metadata-sync:start -->
- 包版本：`0.2.8`
- 内置工具数：`363`
- 域列表：`adb-bridge`, `antidebug`, `binary-instrument`, `boringssl-inspector`, `browser`, `canvas`, `coordination`, `core`, `cross-domain`, `debugger`, `encoding`, `evidence`, `extension-registry`, `graphql`, `hooks`, `instrumentation`, `macro`, `maintenance`, `memory`, `mojo-ipc`, `network`, `platform`, `process`, `protocol-analysis`, `proxy`, `sandbox`, `shared-state-board`, `skia-capture`, `sourcemap`, `streaming`, `syscall-hook`, `trace`, `transform`, `v8-inspector`, `wasm`, `workflow`
- 说明：以上数据由运行时 registry 动态生成，不要手改计数。
<!-- metadata-sync:end -->

> **[查看完整工具参考 ↗](https://vmoranv.github.io/jshookmcp/reference/)**

## 项目统计

<div align="center">

<a href="https://www.star-history.com/?repos=vmoranv%2Fjshookmcp&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=vmoranv/jshookmcp&type=date&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=vmoranv/jshookmcp&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=vmoranv/jshookmcp&type=date&legend=top-left" />
 </picture>
</a>

![Activity](https://repobeats.axiom.co/api/embed/83c000c790b1c665ff2686d2d02605412a0b8805.svg 'Repobeats analytics image')

</div>
