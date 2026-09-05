<div align="center">

<img src="docs/public/favicon.png" width="96" alt="@jshookmcp/jshook" />

# @jshookmcp/jshook

[![License: AGPLv3](https://img.shields.io/badge/License-AGPLv3-red.svg)](LICENSE)
[![Node.js 22.22.2+](https://img.shields.io/badge/node-22.22.2%2B%20%7C%7C%2024.15%2B-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-current-8A2BE2.svg)](https://modelcontextprotocol.io/)
[![pnpm](https://img.shields.io/badge/pnpm-10.x-F69220.svg)](https://pnpm.io/)

**一个为 AI 智能体打造的搜索优先、档位可调的前端逆向工程工作台。**

[English](./README.md) · 中文

<p align="center">
  <a href="https://github.com/vmoranv/jshookmcp/stargazers">
    <img src="https://img.shields.io/github/stars/vmoranv/jshookmcp?style=for-the-badge" alt="Stars" />
  </a>
  <a href="https://github.com/vmoranv/jshookmcp/network/members">
    <img src="https://img.shields.io/github/forks/vmoranv/jshookmcp?style=for-the-badge" alt="Forks" />
  </a>
  <a href="https://github.com/vmoranv/jshookmcp/releases">
    <img src="https://img.shields.io/github/v/tag/vmoranv/jshookmcp?style=for-the-badge&sort=semver" alt="最新版本" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-AGPLv3-red?style=for-the-badge" alt="License" />
  </a>
</p>

<p align="center">
  <!-- npm badge: re-add once @jshookmcp/jshook is published -->
  <a href="https://nodejs.org/">
    <img src="https://img.shields.io/badge/node-22.22.2%2B-brightgreen?style=for-the-badge&logo=node.js" alt="Node.js 22.22.2+" />
  </a>
  <a href="https://www.typescriptlang.org/">
    <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript strict" />
  </a>
  <a href="https://modelcontextprotocol.io/">
    <img src="https://img.shields.io/badge/MCP-current-8A2BE2?style=for-the-badge" alt="MCP current" />
  </a>
</p>

<p align="center">
  <a href="#jshook-的不同之处">有什么不同</a> ·
  <a href="#能力概览">能力概览</a> ·
  <a href="#典型场景">典型场景</a> ·
  <a href="#亮点">亮点</a> ·
  <a href="#传输与部署">传输与部署</a> ·
  <a href="#注册表快照">注册表</a> ·
  <a href="#架构">架构</a> ·
  <a href="#从源码构建">构建</a>
</p>

<p align="center">
  <a href="https://vmoranv.github.io/jshookmcp/">官方文档</a> ·
  <a href="https://vmoranv.github.io/jshookmcp/guide/getting-started.html">快速开始</a> ·
  <a href="https://vmoranv.github.io/jshookmcp/guide/configuration.html">配置指南</a> ·
  <a href="https://vmoranv.github.io/jshookmcp/reference/">工具参考</a>
</p>

<p align="center">
  <a href="https://www.swiftproxy.net/?code=R6KSMPQZ5">
    <img src="docs/public/swiftproxy_sponsor.png" alt="赞助商 Swiftproxy" width="640" />
  </a>
</p>

<p align="center">
  <a href="https://www.swiftproxy.net/?code=R6KSMPQZ5">
    <b>赞助商：Swiftproxy</b>
  </a> — 高质量纯净住宅 IP 提供商 · 九折码：<code>PROXY90</code>
</p>

---

</div>

## jshook 的不同之处

大多数面向 JS 分析的 MCP 服务器只暴露少量手写工具，或者只封装一个浏览器引擎。jshook 更接近 **面向前端逆向工程的操作系统**——34 个自发现域、搜索优先的元工具控制 token 开销、以及能在页面崩溃和会话中断时恢复的运行时：

- **搜索优先、档位可调。** `search` 档加载约 3K token 的工具元数据；`full` 档一次性暴露全部 723 个工具，约 40K token。智能体按任务复杂度逐级提升：`search` → `workflow` → `full`，避免在第一轮就淹没在 schema 海洋里。
- **运行时恢复与会话隔离。** Streamable HTTP 会话在重连后恢复已激活域、浏览器 attach 状态、coverage 状态；浏览器侧会话状态按客户端隔离，两个智能体不会互相踩对方的 CDP 会话。
- **全栈浏览器自动化。** Chromium 与 Camoufox 通过 CDP 控制，内置反检测；显式输入驱动的 CAPTCHA 求解（不内置页面/特征探测）；按需生成自签名 HTTPS 拦截 CA；HTTP/2 帧级构造。
- **真正的逆向工程，不是字符串搜索。** Binaryen WASM 反汇编、Frida/Ghidra/IDA 桥接、原生 FFI 扫描、硬件断点、PE 内省、GraphQL/Burp Suite 代理桥接、AST 变换——而不是把单条正则塞进工具里。
- **动态可扩展。** 热重载插件、声明式工作流、自发现域让服务器不需要重启就能持续生长。

---

## 能力概览

下面是开箱即用能力的快速扫描。每一行都链向下方的 [能力概览](#能力概览)。

| 能力域 | 亮点 |
| --- | --- |
| **工具档位** | `search`（约 3K token，BM25 + 混合向量排序）· `workflow`（复合脚本）· `full`（全部 723 工具） |
| **浏览器自动化** | Chromium 与 Camoufox · CDP 附着已有目标 · 反检测预设 · 显式输入 CAPTCHA 求解 · 弹窗、下载、权限、协议拦截器 |
| **网络拦截** | HTTP/1.1 + HTTP/2 帧级构造 · MITM 代理自动生成 CA · WebSocket 抓包 · GraphQL 自省辅助 · Burp Suite 桥接 |
| **JS Hook 与分析** | LLM 驱动的反混淆 · 加密逻辑识别 · AST 深度理解 · Source Map 重建 · 脚本提取与回放 |
| **WASM 逆向工程** | Binaryen 反汇编 · 模块内省 · 导入/导出分析 · 交叉引用图谱 · 运行时插桩 |
| **进程与内存取证** | 原生 FFI 扫描 · 硬件断点 · PE 内省 · 活进程附着 · 带区域守卫的内存读写 |
| **二进制插桩** | Frida 桥接 · Ghidra 与 IDA 桥接 · 系统调用 hook · BoringSSL 检测器 · BoringSSL/Mojo IPC 分析 |
| **原生运行时** | 跨架构样本模拟器 · 平台内省 · Mojo IPC · Dart Inspector · ADB 桥接获取设备流量 |
| **编码与变换** | URL/Base64/Hex/JWT/Protobuf 编码器 · AST 变换 · 流式解码管线 |
| **协同** | 后台任务队列带进度、取消、异步模式 · 多智能体协同 · 覆盖率报告 |
| **Schema 优先元工具** | `describe_tool` · 带参数校验的 `call_tool` · `coverage_report` · `search_tools` |
| **可插拔扩展注册表** | 热重载插件 · 声明式工作流 · 自发现域 |

---

## 典型场景

| 场景 | 做法 | 涉及域 |
| --- | --- | --- |
| 审阅一个压缩后的 bundle | `search_tools` → `deobfuscate` → `format` → `extract-endpoints` | `transform`、`core` |
| 逆向 CAPTCHA 挑战 | 驱动 Camoufox 页面 → 截图 → 用显式输入求解 → 回放 | `browser`、`canvas` |
| 抓取并回放 OAuth 流程 | `proxy_start`（自动 CA）→ `network_capture` → `graph_dump` → 回放 | `proxy`、`network`、`graphql` |
| 逆向 WASM 加密逻辑 | `wasm_load` → `wasm_disassemble` → `binary-instrument.hook` → 内存 trace | `wasm`、`binary-instrument`、`memory` |
| 恢复中断的浏览器会话 | 重连 Streamable HTTP → 恢复已激活域与浏览器状态 | `browser`、`coordination` |
| 审计 Node 进程中的凭据 | `process.list` → `memory.scan` 敏感模式 → 导出 | `process`、`memory`、`encoding` |
| 构建自定义工作流 | `workflow.register` 写 YAML 步骤 → `workflow.run` | `workflow`、`extension-registry` |
| Hook 活进程里的函数 | Frida 脚本 → `binary-instrument.attach` → 断点 → 日志调用 | `binary-instrument`、`syscall-hook` |

---

## 快速接入

无需全局安装，添加到 MCP 客户端配置即可使用。

**Claude Desktop / Cursor（`claude_desktop_config.json`）：**

```json
{
  "mcpServers": {
    "jshook": {
      "command": "npx",
      "args": ["-y", "@jshookmcp/jshook@latest"],
      "env": {
        "MCP_TOOL_PROFILE": "search",
        "npm_config_omit": "optional"
      }
    }
  }
}
```

*（Windows 用户：若找不到 `npx`，请使用 `npx.cmd` 绝对路径。）*

该轻量配置会跳过可选的 ONNX、Z3、Binaryen、Camoufox 和 Playwright 包；需要这些完整档
运行时，移除 `npm_config_omit`。

### 多个 Agent 共用一个本地进程

默认 stdio 配置会让每个 MCP 宿主启动一份完整的 jshook。若要共享 embedding 模型、浏览器运行时和缓存，可以启动一个本地 Streamable HTTP daemon：

```bash
pnpm build
pnpm daemon
```

每客户端 stdio 进程默认关闭向量搜索；共享 HTTP daemon 默认按需开启。只需词法搜索时可设置 `SEARCH_VECTOR_ENABLED=false`。

然后在各 MCP 客户端的 HTTP/URL server 配置中统一指向 `http://127.0.0.1:3000/mcp`。每个客户端拥有独立的 MCP 会话和响应路由，重量级运行时资源只保留一份。建议保持默认的本机回环监听；如需对外暴露，必须先设置 `MCP_AUTH_TOKEN`。

### 随任务复杂度逐级提升档位

```jsonc
{
  "env": {
    "MCP_TOOL_PROFILE": "search"     // 从这里开始，约 3K token 元数据
  }
}
```

开始组合复合脚本时把 `MCP_TOOL_PROFILE` 切到 `workflow`；需要所有工具时切到 `full`。`coverage_report` 可随时查询当前激活集。

---

## 亮点

- **档位阶梯。** 从 `search`（约 3K token 元数据）起步；组合复合脚本时切到 `workflow`；确实需要全部工具才升到 `full`。`coverage_report` 随时告诉你现在激活的是什么。
- **元工具。** `describe_tool` 返回 JSON Schema；`call_tool` 在调用前校验参数；每个工具都带 `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`。
- **浏览器自动化。** Chromium 与 Camoufox 走 CDP，可附着已有目标，反检测预设，弹窗/下载/权限拦截器，显式输入 CAPTCHA 求解，三种文档时机的 JS/CSS 注入，coverage 跨重连持久化。
- **网络拦截。** 自动生成 HTTPS 拦截 CA、HTTP/1.1 + HTTP/2 帧级构造、WebSocket 抓包、GraphQL 辅助、Burp Suite 桥接——同一套 MCP 工具面。
- **逆向工程。** Binaryen WASM 反汇编、Frida/Ghidra/IDA 桥接、硬件断点、原生 FFI 扫描、PE 内省、系统调用 hook、AST 变换、Source Map 重建。
- **会话恢复。** Streamable HTTP 传输在重连后恢复已激活域、浏览器 attach 状态、coverage 状态；浏览器侧会话按客户端隔离。
- **插件和工作流。** 放进目录即获得一个域；写一段 YAML 就能当一个工具跑；注册表自发现。

---

## 传输与部署

服务器开箱支持两种传输。

| 传输 | 何时使用 | 说明 |
| --- | --- | --- |
| **stdio** | Claude Desktop、Cursor 等单宿主客户端默认 | 每个 MCP 宿主一个完整进程；建议使用轻量档位 |
| **Streamable HTTP** | 多个智能体共享 embedding 模型、浏览器运行时和缓存 | 默认本机回环监听；对外暴露前必须设置 `MCP_AUTH_TOKEN` |

两种传输暴露相同的工具面。`coverage_report` 展示每个会话已激活的域——长运行会话在重连后恢复浏览器 attach 状态、coverage 状态与工具激活。

生产部署请参考 [安全与生产指南](https://vmoranv.github.io/jshookmcp/operations/security-and-production.html)。

---

## 最近运行时变更

- HTTP 传输现在支持多路复用独立 MCP 会话，并在重连后恢复运行时状态。
- `proxy_start` 在需要时会自动生成本地 HTTPS 拦截 CA。
- Browser 域的 CAPTCHA 求解已改为显式参数驱动：按需传入 `taskKind`、`siteKey`、`imageBase64`、`callbackName`、`responseSelector`。不会再内置页面/组件特征探测。

---

## 注册表快照

下面的内置能力快照由运行时 registry 动态生成，并在 CI 中校验。

<!-- metadata-sync:start -->
- 包版本：`0.3.5`
- 内置工具数：`723`
- 域列表：`adb-bridge`, `binary-instrument`, `boringssl-inspector`, `browser`, `canvas`, `coordination`, `core`, `cross-domain`, `dart-inspector`, `debugger`, `encoding`, `exploit-dev`, `extension-registry`, `graphql`, `instrumentation`, `maintenance`, `memory`, `mojo-ipc`, `native-bridge`, `native-emulator`, `network`, `platform`, `process`, `protocol-analysis`, `proxy`, `sourcemap`, `streaming`, `syscall-hook`, `tasks`, `trace`, `transform`, `v8-inspector`, `wasm`, `webgpu`, `workflow`
- 说明：以上数据由运行时 registry 动态生成，不要手改计数。
<!-- metadata-sync:end -->

> **[查看完整工具参考 ↗](https://vmoranv.github.io/jshookmcp/reference/)**

---

## 架构

- **运行时注册表** — 域通过 `manifest.ts` 自发现；新增域只需创建一个文件。
- **延迟初始化** — Handler 在首次调用时实例化，而非启动时预加载。
- **BM25 + 向量搜索** — `search_tools` 混合排序 + 自适应权重。
- **MCP `ToolAnnotations`** — 每个工具携带 `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`。
- **档位阶梯** — `search`（约 3K token）→ `workflow`（复合脚本）→ `full`（全部 723 工具）。
- **传输对称** — stdio 与 Streamable HTTP 暴露相同工具面；按客户端隔离会话。

详见 [架构指南](https://vmoranv.github.io/jshookmcp/guide/best-practices.html) 与 [配置参考](https://vmoranv.github.io/jshookmcp/guide/configuration.html)。

---

## 从源码构建

环境要求：Node.js 22.12+、pnpm 10.x。

```bash
pnpm install
pnpm build
pnpm start           # 从 dist/ 启动构建后的服务
pnpm dev             # tsx watch 模式从源码启动
pnpm check           # metadata check + lint + format check + typecheck + 单元测试
pnpm test            # Vitest 单元套件
pnpm test:e2e        # 浏览器/工具端到端套件
pnpm daemon          # 构建后启动 Streamable HTTP daemon
```

原生辅助库通过 `pnpm build` 一并打包；首次运行时服务会按档位下载可选运行时
（ONNX、Z3、Binaryen、Camoufox、Playwright）。

---

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

---

## 许可证

[AGPLv3](./LICENSE)。
