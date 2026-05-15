# @jshookmcp/jshook

[![License: AGPLv3](https://img.shields.io/badge/License-AGPLv3-red.svg)](LICENSE)
[![Node.js 22.12+](https://img.shields.io/badge/node-22.12%2B-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-current-8A2BE2.svg)](https://modelcontextprotocol.io/)
[![pnpm](https://img.shields.io/badge/pnpm-10.x-F69220.svg)](https://pnpm.io/)

[English](./README.md) | 中文

为 AI 赋予 **36 个技术域、402 个原子工具** 的 JavaScript 分析与安全研究 MCP 服务器——浏览器自动化、CDP 调试、网络拦截、JS Hook、LLM 代码分析、进程/内存取证、WASM 逆向、Source Map 重建、AST 变换与复合工作流，一应俱全。

## 快速导航

- **[📖 官方文档](https://vmoranv.github.io/jshookmcp/)** · **[🚀 快速开始](https://vmoranv.github.io/jshookmcp/guide/getting-started.html)** · **[⚙️ 配置指南](https://vmoranv.github.io/jshookmcp/guide/configuration.html)** · **[📚 工具参考](https://vmoranv.github.io/jshookmcp/reference/)**

## 🚀 快速接入

无需全局安装，添加到 MCP 客户端配置即可使用：

**Claude Desktop / Cursor (`claude_desktop_config.json`)**：

```json
{
  "mcpServers": {
    "jshook": {
      "command": "npx",
      "args": ["-y", "@jshookmcp/jshook@latest"],
      "env": { "JSHOOK_BASE_PROFILE": "search" }
    }
  }
}
```

*(Windows 用户：若找不到 `npx`，请使用 `npx.cmd` 绝对路径)*

## 🌟 核心亮点

- 🤖 **AI 智能分析** — LLM 驱动的 JS 反混淆、加密识别、AST 深度理解
- ⚡ **搜索优先** — `search` 档 ≈ 3K tokens vs `full` 档 ≈ 40K+ tokens，按需加载
- 🎯 **渐进分层** — `search` → `workflow` → `full`，按需激活
- 🌐 **全栈浏览器自动化** — Chromium/Camoufox + CDP + 反检测 + CAPTCHA 处理
- 📡 **网络拦截** — HTTP/2 帧构造、MiTM 捕获、GraphQL、Burp Suite 桥接
- 🛠️ **全能逆向工具链** — WASM 反编译、二进制分析、Frida、Ghidra/IDA 桥接
- 🧰 **进程与内存取证** — 原生 FFI 扫描、硬件断点、PE 内省
- 🧩 **动态热插拔** — 热重载插件、声明式工作流、自发现域

## 架构

- **运行时注册表** — 域通过 `manifest.ts` 自发现；新增域只需创建一个文件
- **延迟初始化** — Handler 在首次调用时实例化，而非启动时预加载
- **BM25 + 向量搜索** — `search_tools` 混合排序 + 自适应权重
- **MCP ToolAnnotations** — 每个工具携带 `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`

## 注册表快照

下面的内置能力快照由运行时 registry 动态生成，并在 CI 中校验。

<!-- metadata-sync:start -->
- 包版本：`0.3.0`
- 内置工具数：`402`
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
