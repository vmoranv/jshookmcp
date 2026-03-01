# jshhookmcp

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-current-8A2BE2.svg)](https://modelcontextprotocol.io/)
[![pnpm](https://img.shields.io/badge/pnpm-10.x-F69220.svg)](https://pnpm.io/)

[English](./README.md) | 中文

面向 AI 辅助 JavaScript 逆向工程的 MCP（模型上下文协议）服务器，提供 **16 个域 224 个工具**。集成浏览器自动化、Chrome DevTools Protocol 调试、网络监控、智能 JavaScript Hook、LLM 驱动代码分析、进程/内存操作、WASM 工具链、二进制编码、反反调试、GraphQL 发现、Source Map 重建、AST 变换、加密重构、平台包分析及高层复合工作流编排。

## 功能特性

- **浏览器自动化** — 启动 Chromium/Camoufox、页面导航、DOM 交互、截图、Cookie 与存储管理
- **CDP 调试器** — 断点设置、单步执行、作用域变量检查、监视表达式、会话保存/恢复
- **网络监控** — 请求/响应捕获、URL/方法过滤、响应体获取、`offset+limit` 分页访问
- **性能追踪** — Chrome Performance Trace 录制、CPU Profile、堆分配采样（CDP Tracing/Profiler 域）
- **JS 堆搜索** — 浏览器运行时 CE（Cheat Engine）等价工具：快照 V8 堆并按模式搜索字符串值
- **Auth 提取** — 自动扫描已捕获请求的 Authorization 头、Bearer/JWT 令牌、Cookie 和查询参数凭据，带置信度评分
- **HAR 导出 / 请求重放** — 导出 HAR 1.2 流量；重放任意请求，支持请求头/Body/方法覆盖，内置 SSRF 安全防护
- **Tab 工作流** — 多标签页协调：命名别名绑定、跨标签共享 KV 上下文
- **复合工作流** — 单次调用编排工具（`web_api_capture_session`、`register_account_flow`、`api_probe_batch`、`js_bundle_search`），将导航、DOM 操作、网络捕获和 Auth 提取链式合并为原子操作
- **脚本库** — 命名可复用 JS 片段（`page_script_register` / `page_script_run`），内置 RE 预设
- **渐进工具发现** — 基于 BM25 的 `search_tools` 元工具可按关键字搜索全部 224 个工具；`activate_tools` / `deactivate_tools` 按名激活/停用单个工具；`activate_domain` 批量激活整个域；`boost_profile` / `unboost_profile` 档位级升降级，支持 TTL 自动过期
- **JavaScript Hook** — AI 生成任意函数 Hook，20+ 内置预设（eval、crypto、atob、WebAssembly 等）
- **代码分析** — 反混淆（JScrambler、JSVMP、Packer）、加密算法检测、LLM 驱动代码理解
- **WASM 工具链** — 通过 wabt/binaryen/wasmtime 实现 WebAssembly 模块的 Dump、反汇编、反编译、检查、优化与离线执行
- **WebSocket 与 SSE 监控** — 实时帧捕获、连接追踪、SSE 事件拦截
- **二进制编码** — 格式检测、熵分析、Protobuf 原始解码、MessagePack 解码、base64/hex/URL 编解码
- **反反调试** — 绕过 debugger 语句、定时检测、堆栈跟踪检测、console 开发者工具检测
- **GraphQL** — 内省查询、网络流量 Query 提取、操作重放
- **调用图分析** — 从页面内追踪记录生成运行时函数调用图
- **脚本替换** — 通过 CDP 请求拦截实现持久脚本响应替换
- **Source Map** — 自动发现、VLQ 解码（纯 TS，无 npm 依赖）、项目树重建
- **Chrome 扩展** — 列出已安装扩展、在扩展 Background 上下文执行代码
- **AST 变换** — 常量折叠、字符串解密、死代码删除、控制流展开、变量重命名（纯正则，无 babel）
- **加密重构** — 提取独立加密函数、worker_threads 沙箱测试、实现对比
- **平台工具** — 小程序包扫描/解包/分析、Electron ASAR 提取、Electron 应用检查
- **外部工具桥接** — Frida 脚本生成与 Jadx 反编译集成（桥接模式，用户自行安装外部工具）
- **CAPTCHA 处理** — AI 视觉检测、手动验证流程、可配置轮询
- **隐身注入** — 针对无头浏览器指纹识别的反检测补丁
- **进程与内存** — 跨平台进程枚举、内存读写/扫描、DLL/Shellcode 注入（Windows）、Electron 应用附加
- **性能优化** — 智能缓存、Token 预算管理、代码覆盖率、渐进工具披露与按域懒初始化、BM25 搜索发现（search 档位初始化仅约 800 token，full 档位约 18K token）
- **安全防护** — Bearer 令牌认证（`MCP_AUTH_TOKEN`）、Origin CSRF 防护、逐跳 SSRF 校验、symlink 安全路径处理、PowerShell 注入防护、外部工具安全执行

## 架构

基于 `@modelcontextprotocol/sdk` v1.27+ 的 **McpServer 高层 API** 构建：

- 所有工具通过 `server.registerTool()` 注册，无手动请求处理
- 工具 Schema 从 JSON Schema 动态构建（输入由各域 handler 验证）
- **五种工具档位**：`search`（BM25 搜索发现）、`minimal`（快速启动）、`workflow`（端到端逆向）、`full`（全部域）、`reverse`（逆向专注）
- **渐进发现**：`search` 档位仅暴露 6 个维护工具 + 4 个搜索/激活元工具（约 800 token）；LLM 通过 `search_tools` 发现工具，通过 `activate_tools` 按需启用
- **按域懒初始化**：handler 类在首次工具调用时实例化，不在 init 阶段创建
- **过滤绑定**：`createToolHandlerMap` 仅为已选工具绑定 resolver
- 两种传输模式：**stdio**（默认）和 **Streamable HTTP**（MCP 当前修订版）
- 能力声明：`{ tools: { listChanged: true }, logging: {} }`

## 环境要求

- Node.js >= 20
- pnpm

## 安装

### 默认安装（仅 Puppeteer）

```bash
pnpm install
pnpm build
```

### Full 安装（Puppeteer + Camoufox）

```bash
pnpm run install:full
pnpm build
```

`install:full` 已包含 `pnpm exec camoufox-js fetch`。

### 缓存清理（可选）

```bash
# Puppeteer 浏览器缓存
rm -rf ~/.cache/puppeteer

# Camoufox 浏览器缓存
rm -rf ~/.cache/camoufox
```

Windows 常见缓存路径：

- `%USERPROFILE%\.cache\puppeteer`
- `%LOCALAPPDATA%\camoufox`

## 配置

将 `.env.example` 复制为 `.env` 并填写：

```bash
cp .env.example .env
```

主要配置项：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DEFAULT_LLM_PROVIDER` | `openai` 或 `anthropic` | `openai` |
| `OPENAI_API_KEY` | OpenAI（或兼容接口）API Key | — |
| `OPENAI_BASE_URL` | OpenAI 兼容接口 Base URL | `https://api.openai.com/v1` |
| `OPENAI_MODEL` | 模型名称 | `gpt-4-turbo-preview` |
| `ANTHROPIC_API_KEY` | Anthropic API Key | — |
| `PUPPETEER_HEADLESS` | 无头模式 | `false` |
| `PUPPETEER_EXECUTABLE_PATH` | 可选浏览器路径 | Puppeteer 管理 |
| `LOG_LEVEL` | 日志级别（`debug`/`info`/`warn`/`error`） | `info` |
| `MCP_TRANSPORT` | 传输模式：`stdio` 或 `http` | `stdio` |
| `MCP_PORT` | HTTP 端口（`MCP_TRANSPORT=http` 时生效） | `3000` |
| `MCP_HOST` | HTTP 绑定地址 | `127.0.0.1` |
| `MCP_TOOL_PROFILE` | 工具档位：`search`/`minimal`/`full`/`workflow`/`reverse` | stdio: `minimal` / http: `workflow` |
| `MCP_TOOL_DOMAINS` | 逗号分隔域覆盖 | — |
| `MCP_AUTH_TOKEN` | HTTP 传输 Bearer 令牌认证 | — |
| `MCP_MAX_BODY_BYTES` | HTTP 请求体大小限制（字节） | `10485760`（10 MB） |
| `MCP_ALLOW_INSECURE` | 允许非 localhost HTTP 无认证 | `false` |
| `MCP_SCREENSHOT_DIR` | 截图基础目录（归一化至项目根） | `screenshots/manual` |

### 档位规则

| 档位 | 包含域 | 工具数 | 用途 |
|------|--------|--------|------|
| `search` | maintenance | 6 + 6 元工具 | 超轻量初始化（约 800 token）；BM25 搜索发现并按需激活工具 |
| `minimal` | browser, maintenance | 61 | 快速启动，基本自动化 |
| `workflow` | browser, network, workflow, maintenance, core, debugger, streaming, encoding, graphql | 159 | 端到端逆向工程流程 |
| `full` | 全部 16 个域 | 224 | 完整工具集 |
| `reverse` | core, browser, debugger, network, hooks, wasm, streaming, encoding, antidebug, sourcemap, transform, platform | 182 | 逆向工程专注 |

> 若设置了 `MCP_TOOL_DOMAINS`，优先级高于 `MCP_TOOL_PROFILE`。

示例：

```bash
# 基于搜索的渐进发现（推荐用于上下文受限的 LLM）
MCP_TOOL_PROFILE=search node dist/index.js

# 本地轻量模式
MCP_TOOL_PROFILE=minimal node dist/index.js

# 端到端逆向流程
MCP_TOOL_PROFILE=workflow node dist/index.js

# 逆向专注模式
MCP_TOOL_PROFILE=reverse node dist/index.js

# 只启用浏览器+维护工具
MCP_TOOL_DOMAINS=browser,maintenance node dist/index.js

# HTTP 模式 + 认证
MCP_TRANSPORT=http MCP_AUTH_TOKEN=mysecret node dist/index.js
```

## MCP 客户端配置

### stdio（默认 — 本地 MCP 客户端）

```json
{
  "mcpServers": {
    "jshhookmcp": {
      "command": "node",
      "args": ["path/to/jshhookmcp/dist/index.js"],
      "env": {
        "OPENAI_API_KEY": "your-key",
        "OPENAI_BASE_URL": "https://api.openai.com/v1",
        "OPENAI_MODEL": "gpt-4-turbo-preview"
      }
    }
  }
}
```

### Streamable HTTP（远程 / MCP 当前修订版）

```bash
MCP_TRANSPORT=http MCP_PORT=3000 node dist/index.js
```

连接至 `http://localhost:3000/mcp`。服务器支持：

- `POST /mcp` — 发送 JSON-RPC 请求（返回 JSON 或 SSE 流）
- `GET /mcp` — 开启 SSE 流
- `DELETE /mcp` — 关闭会话

会话 ID 通过 `Mcp-Session-Id` 响应头下发。

## 工具域（224 个工具）

### 核心 / 分析（13 个工具）

<details>
<summary>LLM 驱动的代码收集、反混淆、加密检测、webpack/source-map 分析</summary>

| # | 工具 | 说明 |
|---|------|------|
| 1 | `collect_code` | 从目标网站收集 JavaScript（摘要/优先级/增量/全量模式） |
| 2 | `search_in_scripts` | 按关键字或正则搜索已收集脚本 |
| 3 | `extract_function_tree` | 提取函数及其完整依赖树 |
| 4 | `deobfuscate` | LLM 辅助 JavaScript 反混淆 |
| 5 | `understand_code` | 语义代码分析（结构、行为、风险） |
| 6 | `detect_crypto` | 识别加密算法与使用模式 |
| 7 | `manage_hooks` | 创建、查看、清除运行时 Hook |
| 8 | `detect_obfuscation` | 识别 JavaScript 混淆技术 |
| 9 | `advanced_deobfuscate` | 高级反混淆（含 VM 导向策略） |
| 10 | `clear_collected_data` | 清理收集数据、缓存和内存索引 |
| 11 | `get_collection_stats` | 获取收集/缓存/压缩统计 |
| 12 | `webpack_enumerate` | 枚举当前页面 webpack 模块；可选关键字搜索 |
| 13 | `source_map_extract` | 提取并解析 JavaScript Source Map 还原源码 |

</details>

### 浏览器（55 个工具）

<details>
<summary>浏览器控制、DOM 交互、隐身注入、CAPTCHA、存储、框架工具、JS 堆搜索、多标签工作流</summary>

| # | 工具 | 说明 |
|---|------|------|
| 1 | `get_detailed_data` | 通过 `detailId` 令牌获取大数据结果（超出上下文限制时返回） |
| 2 | `browser_launch` | 启动浏览器（`chrome` 或 `camoufox` 反检测 Firefox） |
| 3 | `camoufox_server_launch` | 启动 Camoufox WebSocket 服务（多进程/远程连接） |
| 4 | `camoufox_server_close` | 关闭 Camoufox WebSocket 服务 |
| 5 | `camoufox_server_status` | 获取 Camoufox WebSocket 服务状态 |
| 6 | `browser_attach` | 通过 CDP WebSocket URL 附加已有浏览器 |
| 7 | `browser_close` | 关闭浏览器实例 |
| 8 | `browser_status` | 获取浏览器状态（运行中、页面数、版本） |
| 9 | `browser_list_tabs` | 列出所有打开的标签页 |
| 10 | `browser_select_tab` | 按索引或 URL/标题模式切换标签页 |
| 11 | `page_navigate` | 导航至 URL（自动 CAPTCHA 检测 + 可选网络监控） |
| 12 | `page_reload` | 刷新当前页面 |
| 13 | `page_back` | 浏览器后退 |
| 14 | `page_forward` | 浏览器前进 |
| 15 | `dom_query_selector` | 查询单个 DOM 元素 |
| 16 | `dom_query_all` | 查询所有匹配 DOM 元素 |
| 17 | `dom_get_structure` | 获取页面 DOM 结构（超大 DOM 自动返回摘要 + `detailId`） |
| 18 | `dom_find_clickable` | 查找所有可点击元素（按钮、链接） |
| 19 | `dom_get_computed_style` | 获取元素计算样式 |
| 20 | `dom_find_by_text` | 按文本内容查找元素 |
| 21 | `dom_get_xpath` | 获取元素 XPath |
| 22 | `dom_is_in_viewport` | 检查元素是否在视口内 |
| 23 | `page_click` | 点击元素 |
| 24 | `page_type` | 输入文本 |
| 25 | `page_select` | 选择 `<select>` 下拉选项 |
| 26 | `page_hover` | 悬停元素 |
| 27 | `page_scroll` | 滚动页面 |
| 28 | `page_press_key` | 键盘按键 |
| 29 | `page_wait_for_selector` | 等待元素出现 |
| 30 | `page_evaluate` | 在页面上下文执行 JavaScript（大结果返回摘要 + `detailId`） |
| 31 | `page_screenshot` | 截取当前页面 |
| 32 | `page_get_performance` | 获取页面性能指标 |
| 33 | `page_inject_script` | 向页面注入 JavaScript |
| 34 | `page_set_cookies` | 设置页面 Cookie |
| 35 | `page_get_cookies` | 获取所有 Cookie |
| 36 | `page_clear_cookies` | 清空所有 Cookie |
| 37 | `page_set_viewport` | 设置视口大小 |
| 38 | `page_emulate_device` | 模拟移动设备（iPhone、iPad、Android） |
| 39 | `page_get_local_storage` | 获取所有 `localStorage` |
| 40 | `page_set_local_storage` | 设置 `localStorage` 项 |
| 41 | `page_get_all_links` | 获取页面所有链接 |
| 42 | `get_all_scripts` | 获取已加载脚本列表（含 `maxScripts` 上限） |
| 43 | `get_script_source` | 获取脚本源码（大脚本返回摘要 + `detailId`） |
| 44 | `console_enable` | 启用控制台监控 |
| 45 | `console_get_logs` | 获取捕获的控制台日志 |
| 46 | `console_execute` | 在控制台上下文执行 JavaScript |
| 47 | `captcha_detect` | AI 视觉检测 CAPTCHA |
| 48 | `captcha_wait` | 等待手动通过 CAPTCHA |
| 49 | `captcha_config` | 配置 CAPTCHA 检测行为 |
| 50 | `stealth_inject` | 注入反检测脚本绕过 Bot 检测 |
| 51 | `stealth_set_user_agent` | 设置真实 User-Agent 与浏览器指纹 |
| 52 | `framework_state_extract` | 提取 React/Vue 组件实时状态 |
| 53 | `indexeddb_dump` | 导出所有 IndexedDB 数据库 |
| 54 | `js_heap_search` | 搜索 V8 堆中匹配模式的字符串（浏览器 CE 等价工具） |
| 55 | `tab_workflow` | 多标签协调（别名绑定、跨标签导航、KV 共享上下文） |

</details>

### 调试器（37 个工具）

<details>
<summary>CDP 调试器控制、断点、监视、XHR/事件断点、会话持久化、脚本黑盒</summary>

| # | 工具 | 说明 |
|---|------|------|
| 1 | `debugger_enable` | 启用 CDP 调试器 |
| 2 | `debugger_disable` | 关闭调试器并清除所有断点 |
| 3 | `debugger_pause` | 在下一条语句暂停执行 |
| 4 | `debugger_resume` | 恢复执行 |
| 5 | `debugger_step_into` | 步入函数调用 |
| 6 | `debugger_step_over` | 步过函数调用 |
| 7 | `debugger_step_out` | 步出当前函数 |
| 8 | `debugger_wait_for_paused` | 等待调试器暂停 |
| 9 | `debugger_get_paused_state` | 获取当前暂停状态 |
| 10 | `debugger_evaluate` | 在当前调用帧求值 |
| 11 | `debugger_evaluate_global` | 在全局上下文求值 |
| 12 | `debugger_save_session` | 保存调试会话到 JSON 文件 |
| 13 | `debugger_load_session` | 加载已保存的调试会话 |
| 14 | `debugger_export_session` | 导出会话 JSON 用于分享 |
| 15 | `debugger_list_sessions` | 列出所有已保存的调试会话 |
| 16 | `breakpoint_set` | 设置断点（URL 或 scriptId，可选条件） |
| 17 | `breakpoint_remove` | 按 ID 移除断点 |
| 18 | `breakpoint_list` | 列出所有活跃断点 |
| 19 | `breakpoint_set_on_exception` | 异常中断 — 全部或仅未捕获 |
| 20 | `get_call_stack` | 获取调用栈（暂停时） |
| 21 | `get_object_properties` | 按 `objectId` 获取对象所有属性 |
| 22 | `get_scope_variables_enhanced` | 增强作用域变量检查（深度对象遍历） |
| 23 | `watch_add` | 添加监视表达式 |
| 24 | `watch_remove` | 移除监视表达式 |
| 25 | `watch_list` | 列出所有监视表达式 |
| 26 | `watch_evaluate_all` | 评估所有启用的监视 |
| 27 | `watch_clear_all` | 清空所有监视 |
| 28 | `xhr_breakpoint_set` | 设置 XHR/Fetch 断点 |
| 29 | `xhr_breakpoint_remove` | 移除 XHR 断点 |
| 30 | `xhr_breakpoint_list` | 列出所有 XHR 断点 |
| 31 | `event_breakpoint_set` | 设置事件监听器断点 |
| 32 | `event_breakpoint_set_category` | 按事件类别批量设置断点 |
| 33 | `event_breakpoint_remove` | 移除事件断点 |
| 34 | `event_breakpoint_list` | 列出所有事件断点 |
| 35 | `blackbox_add` | 按 URL 模式黑盒脚本 |
| 36 | `blackbox_add_common` | 一键黑盒所有常见库 |
| 37 | `blackbox_list` | 列出所有黑盒 URL 模式 |

</details>

### 网络（26 个工具）

<details>
<summary>CDP 网络监控、性能追踪、CPU/堆 Profile、Auth 提取、HAR 导出、请求重放、控制台注入</summary>

| # | 工具 | 说明 |
|---|------|------|
| 1 | `network_enable` | 启用网络请求监控 |
| 2 | `network_disable` | 关闭网络请求监控 |
| 3 | `network_get_status` | 获取网络监控状态 |
| 4 | `network_get_requests` | 获取捕获的请求（`offset+limit` 分页；URL 不区分大小写过滤） |
| 5 | `network_get_response_body` | 获取指定请求的响应体 |
| 6 | `network_get_stats` | 获取网络统计 |
| 7 | `network_extract_auth` | 扫描所有已捕获请求的 Auth 凭据（置信度评分） |
| 8 | `network_export_har` | 导出 HAR 1.2 流量 |
| 9 | `network_replay_request` | 重放已捕获请求（支持覆盖；逐跳 DNS 校验 SSRF 防护） |
| 10 | `performance_get_metrics` | 获取页面 Web Vitals |
| 11 | `performance_start_coverage` | 开始 JS/CSS 代码覆盖率记录 |
| 12 | `performance_stop_coverage` | 停止覆盖率记录并返回报告 |
| 13 | `performance_take_heap_snapshot` | 拍摄 V8 堆内存快照 |
| 14 | `performance_trace_start` | 开始 Chrome Performance Trace 录制（CDP Tracing 域） |
| 15 | `performance_trace_stop` | 停止 Performance Trace 并保存 trace 文件 |
| 16 | `profiler_cpu_start` | 开始 CDP CPU 性能分析 |
| 17 | `profiler_cpu_stop` | 停止 CPU 分析并返回热点函数 |
| 18 | `profiler_heap_sampling_start` | 开始 V8 堆分配采样 |
| 19 | `profiler_heap_sampling_stop` | 停止堆采样并返回 Top 分配源 |
| 20 | `console_get_exceptions` | 获取捕获的未处理异常 |
| 21 | `console_inject_script_monitor` | 注入动态 `<script>` 元素监控器 |
| 22 | `console_inject_xhr_interceptor` | 注入 XHR 拦截器捕获 AJAX 请求/响应 |
| 23 | `console_inject_fetch_interceptor` | 注入 Fetch API 拦截器；自动持久化 URL 至 `localStorage.__capturedAPIs` |
| 24 | `console_clear_injected_buffers` | 清理注入的页面内缓冲区 |
| 25 | `console_reset_injected_interceptors` | 重置拦截器以便重新注入 |
| 26 | `console_inject_function_tracer` | 注入基于 Proxy 的函数追踪器 |

</details>

### Hook（8 个工具）

<details>
<summary>AI 生成的 JavaScript Hook 和 20+ 内置预设</summary>

| # | 工具 | 说明 |
|---|------|------|
| 1 | `ai_hook_generate` | 为函数、API 或对象方法生成 Hook 代码 |
| 2 | `ai_hook_inject` | 将已生成的 Hook 注入页面 |
| 3 | `ai_hook_get_data` | 获取活跃 Hook 的捕获数据 |
| 4 | `ai_hook_list` | 列出所有活跃 Hook |
| 5 | `ai_hook_clear` | 清除一个或全部 Hook |
| 6 | `ai_hook_toggle` | 启用或禁用 Hook |
| 7 | `ai_hook_export` | 导出 Hook 捕获数据（JSON/CSV） |
| 8 | `hook_preset` | 安装 20+ 预设 Hook |

**内置预设：** `eval`、`function-constructor`、`atob-btoa`、`crypto-subtle`、`json-stringify`、`object-defineproperty`、`settimeout`、`setinterval`、`addeventlistener`、`postmessage`、`webassembly`、`proxy`、`reflect`、`history-pushstate`、`location-href`、`navigator-useragent`、`eventsource`、`window-open`、`mutationobserver`、`formdata`、`anti-debug-bypass`、`crypto-key-capture`、`webassembly-full`

</details>

### 维护（6 个工具）

<details>
<summary>Token 预算追踪与缓存管理</summary>

| # | 工具 | 说明 |
|---|------|------|
| 1 | `get_token_budget_stats` | 获取 Token 预算使用统计 |
| 2 | `manual_token_cleanup` | 手动触发 Token 预算清理 |
| 3 | `reset_token_budget` | 重置所有 Token 预算计数器 |
| 4 | `get_cache_stats` | 获取所有内部缓存统计 |
| 5 | `smart_cache_cleanup` | 智能清理缓存，保留热数据 |
| 6 | `clear_all_caches` | 清空所有内部缓存 |

</details>

### 进程 / 内存 / Electron（25 个工具）

<details>
<summary>进程枚举、内存操作、DLL/Shellcode 注入、Electron 附加</summary>

| # | 工具 | 说明 |
|---|------|------|
| 1 | `process_find` | 按名称模式查找进程 |
| 2 | `process_list` | 列出所有运行进程 |
| 3 | `process_get` | 获取特定进程详情 |
| 4 | `process_windows` | 获取进程的所有窗口句柄 |
| 5 | `process_find_chromium` | 查找 Chromium 系浏览器进程 |
| 6 | `process_check_debug_port` | 检查进程是否启用了调试端口 |
| 7 | `process_launch_debug` | 以远程调试端口启动可执行文件 |
| 8 | `process_kill` | 按 PID 结束进程 |
| 9 | `memory_read` | 读取进程指定地址的内存 |
| 10 | `memory_write` | 写入进程内存 |
| 11 | `memory_scan` | 按 hex/值模式扫描进程内存 |
| 12 | `memory_check_protection` | 检查内存保护标志（R/W/X） |
| 13 | `memory_protect` | 修改内存保护标志（仅 Windows） |
| 14 | `memory_scan_filtered` | 在已过滤地址集中二次扫描 |
| 15 | `memory_batch_write` | 批量写入多个内存补丁 |
| 16 | `memory_dump_region` | 将内存区域转储为二进制文件 |
| 17 | `memory_list_regions` | 列出所有内存区域及保护标志 |
| 18 | `inject_dll` | 向目标进程注入 DLL（仅 Windows） |
| 19 | `module_inject_dll` | `inject_dll` 别名 |
| 20 | `inject_shellcode` | 注入并执行 Shellcode（仅 Windows） |
| 21 | `module_inject_shellcode` | `inject_shellcode` 别名 |
| 22 | `check_debug_port` | 检查进程是否被调试 |
| 23 | `enumerate_modules` | 列出所有已加载模块（DLL）及基址 |
| 24 | `module_list` | `enumerate_modules` 别名 |
| 25 | `electron_attach` | 通过 CDP 连接运行中的 Electron 应用 |

> **平台说明：** 内存读写/扫描/转储支持 **Windows**（原生 API）和 **macOS**（lldb + vmmap）。注入工具需要 Windows 提权权限。

</details>

### 工作流 / 复合（6 个工具）

<details>
<summary>全链路逆向工程高层编排</summary>

| # | 工具 | 说明 |
|---|------|------|
| 1 | `web_api_capture_session` | 导航 + 操作 + 收集请求 + Auth 提取 + HAR 导出 — 一次调用完成 |
| 2 | `register_account_flow` | 自动化注册：填表、提交、收集 Token、可选邮箱验证标签页 |
| 3 | `api_probe_batch` | 在浏览器上下文批量 fetch 探测多个 API（自动注入 Bearer） |
| 4 | `js_bundle_search` | 服务端 fetch + 缓存远程 JS Bundle；多正则搜索 + 噪音过滤 |
| 5 | `page_script_register` | 注册命名可复用 JavaScript 片段到会话脚本库 |
| 6 | `page_script_run` | 执行脚本库中的命名脚本（支持运行时 `__params__` 注入） |

**内置脚本库预设**（无需注册即可通过 `page_script_run` 使用）：
`auth_extract`、`bundle_search`、`react_fill_form`、`dom_find_upgrade_buttons`

</details>

### WASM（8 个工具）

<details>
<summary>WebAssembly Dump、反汇编、反编译、检查、优化、离线执行、VMP 追踪</summary>

| # | 工具 | 说明 |
|---|------|------|
| 1 | `wasm_dump` | 从当前浏览器页面 Dump WebAssembly 模块 |
| 2 | `wasm_disassemble` | 使用 wasm2wat 反汇编 .wasm 为 WAT（需 wabt） |
| 3 | `wasm_decompile` | 使用 wasm-decompile 反编译 .wasm 为类 C 伪代码（需 wabt） |
| 4 | `wasm_inspect_sections` | 使用 wasm-objdump 检查段和元数据（需 wabt） |
| 5 | `wasm_offline_run` | 通过 wasmtime/wasmer 离线执行 WASM 导出函数 |
| 6 | `wasm_optimize` | 通过 binaryen wasm-opt 优化 .wasm |
| 7 | `wasm_vmp_trace` | 追踪 WASM VMP opcode 执行（增强插桩） |
| 8 | `wasm_memory_inspect` | 检查 WebAssembly.Memory 线性内存内容 |

> **外部依赖：** wabt（`wasm2wat`、`wasm-objdump`、`wasm-decompile`）、binaryen（`wasm-opt`）、wasmtime 或 wasmer。均为可选 — 工具在不可用时会优雅提示。

</details>

### 流式监控（6 个工具）

<details>
<summary>WebSocket 帧捕获与 SSE 事件拦截</summary>

| # | 工具 | 说明 |
|---|------|------|
| 1 | `ws_monitor_enable` | 通过 CDP Network 事件启用 WebSocket 帧捕获 |
| 2 | `ws_monitor_disable` | 关闭 WebSocket 监控并返回捕获摘要 |
| 3 | `ws_get_frames` | 获取捕获的 WebSocket 帧（分页 + 正则过滤） |
| 4 | `ws_get_connections` | 获取追踪的 WebSocket 连接及帧计数 |
| 5 | `sse_monitor_enable` | 通过 EventSource 构造器拦截启用 SSE 监控 |
| 6 | `sse_get_events` | 获取捕获的 SSE 事件（支持过滤与分页） |

</details>

### 编码（5 个工具）

<details>
<summary>二进制格式检测、熵分析、Protobuf/MessagePack 解码、编解码</summary>

| # | 工具 | 说明 |
|---|------|------|
| 1 | `binary_detect_format` | 通过魔数、编码启发式和 Shannon 熵检测二进制格式 |
| 2 | `binary_decode` | 解码二进制 payload（base64/hex/url/protobuf/msgpack） |
| 3 | `binary_encode` | 将 utf8/hex/json 输入编码为 base64/hex/url 输出 |
| 4 | `binary_entropy_analysis` | 计算 Shannon 熵 + 字节频率分布 |
| 5 | `protobuf_decode_raw` | 无 Schema 解码 base64 protobuf 字节（线类型感知递归解析器） |

</details>

### 反调试（6 个工具）

<details>
<summary>绕过反调试保护与检测保护技术</summary>

| # | 工具 | 说明 |
|---|------|------|
| 1 | `antidebug_bypass_all` | 注入所有反反调试绕过脚本（双注入：evaluateOnNewDocument + evaluate） |
| 2 | `antidebug_bypass_debugger_statement` | 通过 Patch Function 构造器绕过 debugger 语句保护 |
| 3 | `antidebug_bypass_timing` | 通过稳定 performance.now / Date.now 绕过定时检测 |
| 4 | `antidebug_bypass_stack_trace` | 通过过滤可疑堆栈帧绕过 Error.stack 检测 |
| 5 | `antidebug_bypass_console_detect` | 绕过基于 console 的开发者工具检测 |
| 6 | `antidebug_detect_protections` | 检测反调试保护并返回绕过建议 |

</details>

### GraphQL / 调用图（5 个工具）

<details>
<summary>GraphQL 内省、Query 提取、操作重放、运行时调用图分析、脚本替换</summary>

| # | 工具 | 说明 |
|---|------|------|
| 1 | `call_graph_analyze` | 从页面内追踪记录分析运行时函数调用图 |
| 2 | `script_replace_persist` | 通过 CDP 请求拦截持久替换脚本响应 |
| 3 | `graphql_introspect` | 对目标端点执行 GraphQL 内省查询 |
| 4 | `graphql_extract_queries` | 从已捕获网络流量中提取 GraphQL 查询/变更 |
| 5 | `graphql_replay` | 重放 GraphQL 操作（可选 variables 和 headers） |

</details>

### 平台（7 个工具）

<details>
<summary>小程序包工具、Electron ASAR 提取/检查、Frida/Jadx 桥接</summary>

| # | 工具 | 说明 |
|---|------|------|
| 1 | `miniapp_pkg_scan` | 扫描本地小程序缓存目录查找包文件 |
| 2 | `miniapp_pkg_unpack` | 解包小程序包文件（外部 CLI 或纯 Node.js 降级） |
| 3 | `miniapp_pkg_analyze` | 分析解包后小程序结构（页面、子包、组件） |
| 4 | `asar_extract` | 提取 Electron app.asar（纯 Node.js，无 @electron/asar 依赖） |
| 5 | `electron_inspect_app` | 分析 Electron 应用结构（package.json、main、preload、依赖） |
| 6 | `frida_bridge` | Frida 集成桥接：环境检测、脚本模板生成、使用指南（需外部 frida-tools） |
| 7 | `jadx_bridge` | Jadx 集成桥接：环境检测、APK/DEX/AAR 反编译、使用指南（需外部 jadx CLI） |

> **外部依赖：** `unveilr`（小程序解包器）、`frida`（pip install frida-tools）、`jadx`（Java 反编译器）。均为可选 — 工具在依赖缺失时会优雅处理。

</details>

### Source Map / 扩展（5 个工具）

<details>
<summary>Source Map 发现、VLQ 解码、项目树重建、Chrome 扩展交互</summary>

| # | 工具 | 说明 |
|---|------|------|
| 1 | `sourcemap_discover` | 通过 CDP Debugger.scriptParsed 事件自动发现页面 Source Map |
| 2 | `sourcemap_fetch_and_parse` | 获取并解析 SourceMap v3（纯 TS VLQ 解码器，无 source-map npm 依赖） |
| 3 | `sourcemap_reconstruct_tree` | 从 SourceMap sources + sourcesContent 重建原始项目文件树 |
| 4 | `extension_list_installed` | 通过 CDP Target.getTargets 列出已安装的 Chrome 扩展 |
| 5 | `extension_execute_in_context` | 通过 Target.attachToTarget 在 Chrome 扩展 Background 上下文执行代码 |

</details>

### 变换 / 加密（6 个工具）

<details>
<summary>AST 风格变换（纯正则）、加密函数提取、沙箱测试、实现对比</summary>

| # | 工具 | 说明 |
|---|------|------|
| 1 | `ast_transform_preview` | 预览轻量变换（常量折叠、字符串解密、死代码删除等），带 diff |
| 2 | `ast_transform_chain` | 创建并存储内存中的命名变换链 |
| 3 | `ast_transform_apply` | 对代码或活动页面 scriptId 应用变换 |
| 4 | `crypto_extract_standalone` | 从页面提取加密/签名/加密函数为独立可运行代码 |
| 5 | `crypto_test_harness` | 在 worker_threads + vm 沙箱中用测试输入运行提取的加密代码 |
| 6 | `crypto_compare` | 使用相同测试向量比较两个加密实现 |

</details>

### 元工具（6 个工具）

| # | 工具 | 说明 |
|---|------|------|
| 1 | `search_tools` | *(元工具)* BM25 关键字搜索全部 224 个工具；返回排序结果（含域、描述、激活状态） |
| 2 | `activate_tools` | *(元工具)* 按名称动态注册指定工具（来自搜索结果） |
| 3 | `deactivate_tools` | *(元工具)* 移除先前激活的工具以释放上下文 |
| 4 | `activate_domain` | *(元工具)* 一次激活整个域的所有工具（如 `debugger`、`network`） |
| 5 | `boost_profile` | *(元工具)* 升级至更高档位（search → min → workflow → full）；TTL 自动过期 |
| 6 | `unboost_profile` | *(元工具)* 降级至更低档位并移除 boost 添加的工具 |

## 生成产物与清理

| 产物 | 默认位置 | 生成工具 |
|------|----------|---------|
| HAR 流量 | `artifacts/har/jshhook-capture-<timestamp>.har` | `web_api_capture_session`、`network_export_har` |
| Workflow Markdown 报告 | `artifacts/reports/web-api-capture-<timestamp>.md` | `web_api_capture_session` |
| 截图 | `screenshots/manual/` | `page_screenshot` |
| CAPTCHA 截图 | `screenshots/` | `page_navigate` CAPTCHA 检测 |
| 调试会话 | `sessions/` | `debugger_save_session` / `debugger_export_session` |
| WASM 产物 | `artifacts/wasm/` | `wasm_dump`、`wasm_disassemble`、`wasm_decompile`、`wasm_optimize` |
| Source Map 树 | `artifacts/sourcemap/` | `sourcemap_reconstruct_tree` |
| 小程序解包 | `artifacts/miniapp-unpack/` | `miniapp_pkg_unpack` |
| Jadx 反编译 | `artifacts/jadx-decompile/` | `jadx_bridge` |
| 性能 Trace | `artifacts/trace/` | `performance_trace_stop` |
| CPU Profile | `artifacts/profile/` | `profiler_cpu_stop` |
| 堆采样 | `artifacts/heap/` | `profiler_heap_sampling_stop` |

所有路径均已在 `.gitignore` 中配置。

```bash
# 一键清理
rm -rf artifacts/ screenshots/ sessions/
```

## 安全

- **认证**：设置 `MCP_AUTH_TOKEN` 启用 HTTP 传输 Bearer 令牌认证
- **CSRF 防护**：Origin 校验阻断无认证的跨域浏览器请求
- **SSRF 防御**：`network_replay_request` 和 `safeFetch` 使用 `redirect: 'manual'` + 逐跳 DNS pinning
- **路径穿越**：HAR 导出和调试会话使用 `fs.realpath` + symlink 检测进行路径校验
- **注入防护**：所有 PowerShell 操作使用 `execFile` + 输入净化
- **外部工具安全**：`ExternalToolRunner` 使用仅限白名单的工具注册 + `shell: false` 执行

## License

MIT
