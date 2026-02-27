# jshhookmcp

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-current-8A2BE2.svg)](https://modelcontextprotocol.io/)
[![pnpm](https://img.shields.io/badge/pnpm-10.x-F69220.svg)](https://pnpm.io/)

[English](./README.md) | 中文

面向 AI 辅助 JavaScript 逆向工程的 MCP（模型上下文协议）服务器，提供 **175+ 个工具**。将浏览器自动化、Chrome DevTools Protocol 调试、网络监控、智能 JavaScript Hook、LLM 驱动代码分析、进程/内存操作及高层复合工作流编排集成于单一服务器。

## 功能特性

- **浏览器自动化** — 启动 Chromium/Camoufox、页面导航、DOM 交互、截图、Cookie 与存储管理
- **CDP 调试器** — 断点设置、单步执行、作用域变量检查、监视表达式、会话保存/恢复
- **网络监控** — 请求/响应捕获、按 URL 或方法过滤、响应体获取、`offset+limit` 分页访问
- **JS 堆搜索** — 浏览器运行时 CE（Cheat Engine）等价工具：快照 V8 堆并按模式搜索字符串值
- **Auth 提取** — 自动扫描已捕获请求的 Authorization 头、Bearer/JWT 令牌、Cookie 和查询参数凭据，带置信度评分
- **HAR 导出 / 请求重放** — 导出 HAR 1.2 流量；以可选覆盖重放任意请求，内置 SSRF 防护
- **Tab 工作流** — 多标签页协调：命名别名绑定、跨标签共享 KV 上下文
- **复合工作流** — 单次调用编排工具（`web_api_capture_session`、`register_account_flow`、`api_probe_batch`、`js_bundle_search`），将导航、DOM 操作、网络捕获和 Auth 提取链式合并
- **脚本库** — 命名可复用 JS 片段（`page_script_register` / `page_script_run`），内置 RE 预设
- **动态档位升级** — `boost_profile` / `unboost_profile` 元工具；无需重启动态加载调试器/Hook/分析工具；TTL 自动过期（默认 30 分钟）
- **JavaScript Hook** — AI 生成任意函数 Hook，20+ 内置预设（eval、crypto、atob、WebAssembly 等）
- **代码分析** — 反混淆（JScrambler、JSVMP、Packer）、加密算法检测、LLM 驱动理解
- **CAPTCHA 处理** — AI 视觉检测、手动验证流程、可配置轮询
- **隐身注入** — 针对无头浏览器指纹识别的反检测补丁
- **进程与内存** — 跨平台进程枚举、内存读写/扫描、DLL/Shellcode 注入（Windows）、Electron 应用附加
- **性能优化** — 智能缓存、Token 预算管理、代码覆盖率、渐进工具披露与按域懒初始化
- **安全防护** — Bearer 令牌认证（`MCP_AUTH_TOKEN`）、Origin CSRF 防护、逐跳 SSRF 校验、symlink 安全路径处理、PowerShell 注入防护

## 架构

基于 `@modelcontextprotocol/sdk` v1.27+ 的 **McpServer 高层 API** 构建：

- 所有工具通过 `server.tool()` 注册，无手动请求处理
- 工具 Schema 从 JSON Schema 动态构建（输入由各域 handler 验证）
- **三种工具档位**：`minimal`（快速启动）、`workflow`（端到端逆向）、`full`（全部域）
- **按域懒初始化**：handler 类在首次工具调用时实例化，不在 init 阶段创建
- **过滤绑定**：`createToolHandlerMap` 仅为已选工具绑定 resolver
- 两种传输模式：**stdio**（默认）和 **Streamable HTTP**（MCP 当前修订版）

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

Windows 常见缓存路径：`%USERPROFILE%\.cache\puppeteer`、`%LOCALAPPDATA%\camoufox`

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
| `MCP_PORT` | HTTP 端口 | `3000` |
| `MCP_HOST` | HTTP 绑定地址 | `127.0.0.1` |
| `MCP_TOOL_PROFILE` | 工具档位：`minimal`/`full`/`workflow` | stdio: `minimal` / http: `workflow` |
| `MCP_TOOL_DOMAINS` | 逗号分隔域覆盖 | — |
| `MCP_AUTH_TOKEN` | HTTP 传输 Bearer 令牌认证 | — |
| `MCP_MAX_BODY_BYTES` | HTTP 请求体大小限制（字节） | `10485760`（10 MB） |
| `MCP_ALLOW_INSECURE` | 允许非 localhost HTTP 无认证 | `false` |
| `MCP_SCREENSHOT_DIR` | 截图基础目录 | `screenshots/manual` |

### 档位规则

| 档位 | 包含域 | 用途 |
|------|--------|------|
| `minimal` | browser, debugger, network, maintenance | 快速启动，基本自动化 |
| `workflow` | browser, network, workflow, maintenance, core | 端到端逆向工程流程 |
| `full` | 全部域 | 完整工具集（含 hooks、process、debugger） |

> 若设置了 `MCP_TOOL_DOMAINS`，优先级高于 `MCP_TOOL_PROFILE`。

```bash
# 本地轻量模式
MCP_TOOL_PROFILE=minimal node dist/index.js

# 端到端逆向流程
MCP_TOOL_PROFILE=workflow node dist/index.js

# 只启用浏览器+维护工具
MCP_TOOL_DOMAINS=browser,maintenance node dist/index.js

# HTTP 模式 + 认证
MCP_TRANSPORT=http MCP_AUTH_TOKEN=mysecret node dist/index.js
```

## MCP 客户端配置

### stdio（默认）

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

连接至 `http://localhost:3000/mcp`：

- `POST /mcp` — 发送 JSON-RPC 请求
- `GET /mcp` — 开启 SSE 流
- `DELETE /mcp` — 关闭会话

## 工具域（175+ 工具）

### 分析（13 个工具）

<details>
<summary>LLM 驱动的代码收集、反混淆、加密检测、webpack/source-map 分析</summary>

| # | 工具 | 说明 |
|---|------|------|
| 1 | `collect_code` | 从目标网站收集 JavaScript（摘要/优先级/增量/全量） |
| 2 | `search_in_scripts` | 按关键字或正则搜索已收集脚本 |
| 3 | `extract_function_tree` | 提取函数及其依赖树 |
| 4 | `deobfuscate` | LLM 辅助反混淆 |
| 5 | `understand_code` | 语义代码分析（结构/行为/风险） |
| 6 | `detect_crypto` | 识别加密算法与使用模式 |
| 7 | `manage_hooks` | 创建/查看/清除运行时 Hook |
| 8 | `detect_obfuscation` | 识别混淆技术 |
| 9 | `advanced_deobfuscate` | 高级反混淆（含 VM 导向策略） |
| 10 | `clear_collected_data` | 清理收集数据与缓存 |
| 11 | `get_collection_stats` | 获取收集/缓存/压缩统计 |
| 12 | `webpack_enumerate` | 枚举 webpack 模块并按关键字搜索 |
| 13 | `source_map_extract` | 提取并解析 Source Map 还原源码 |

</details>

### 浏览器（59 个工具）

<details>
<summary>浏览器控制、DOM 交互、隐身注入、CAPTCHA、存储、框架工具、JS 堆搜索、多标签工作流</summary>

| # | 工具 | 说明 |
|---|------|------|
| 1 | `get_detailed_data` | 通过 `detailId` 获取大数据结果 |
| 2 | `browser_launch` | 启动浏览器（`chrome` 或 `camoufox`） |
| 3 | `camoufox_server_launch` | 启动 Camoufox WebSocket 服务 |
| 4 | `camoufox_server_close` | 关闭 Camoufox WebSocket 服务 |
| 5 | `camoufox_server_status` | 获取 Camoufox 服务状态 |
| 6 | `browser_attach` | 通过 CDP WebSocket 附加浏览器 |
| 7 | `browser_close` | 关闭浏览器 |
| 8 | `browser_status` | 获取浏览器状态 |
| 9 | `browser_list_tabs` | 列出标签页 |
| 10 | `browser_select_tab` | 切换标签页 |
| 11 | `page_navigate` | 导航（含 CAPTCHA 检测/网络监控） |
| 12 | `page_reload` | 刷新页面 |
| 13 | `page_back` | 后退 |
| 14 | `page_forward` | 前进 |
| 15 | `dom_query_selector` | 查询单个 DOM 元素 |
| 16 | `dom_query_all` | 查询所有匹配元素 |
| 17 | `dom_get_structure` | 获取 DOM 结构（超大自动摘要化） |
| 18 | `dom_find_clickable` | 查找可点击元素 |
| 19 | `dom_get_computed_style` | 获取计算样式 |
| 20 | `dom_find_by_text` | 按文本查找元素 |
| 21 | `dom_get_xpath` | 获取 XPath |
| 22 | `dom_is_in_viewport` | 判断是否在视口内 |
| 23 | `page_click` | 点击元素 |
| 24 | `page_type` | 输入文本 |
| 25 | `page_select` | 选择下拉选项 |
| 26 | `page_hover` | 悬停 |
| 27 | `page_scroll` | 滚动 |
| 28 | `page_press_key` | 键盘按键 |
| 29 | `page_wait_for_selector` | 等待元素出现 |
| 30 | `page_evaluate` | 执行 JavaScript（超大结果摘要化） |
| 31 | `page_screenshot` | 截图 |
| 32 | `page_get_performance` | 性能指标 |
| 33 | `page_inject_script` | 注入脚本 |
| 34 | `page_set_cookies` | 设置 Cookie |
| 35 | `page_get_cookies` | 获取 Cookie |
| 36 | `page_clear_cookies` | 清空 Cookie |
| 37 | `page_set_viewport` | 设置视口 |
| 38 | `page_emulate_device` | 模拟设备 |
| 39 | `page_get_local_storage` | 获取 localStorage |
| 40 | `page_set_local_storage` | 设置 localStorage |
| 41 | `page_get_all_links` | 获取页面链接 |
| 42 | `get_all_scripts` | 获取脚本列表（含 `maxScripts` 上限防 OOM） |
| 43 | `get_script_source` | 获取脚本源码（超大摘要化） |
| 44 | `console_enable` | 开启控制台监控 |
| 45 | `console_get_logs` | 获取控制台日志 |
| 46 | `console_execute` | 执行控制台表达式 |
| 47 | `captcha_detect` | AI 检测 CAPTCHA |
| 48 | `captcha_wait` | 等待手动通过 CAPTCHA |
| 49 | `captcha_config` | 配置 CAPTCHA 检测 |
| 50 | `stealth_inject` | 注入反检测脚本 |
| 51 | `stealth_set_user_agent` | 设置真实化 UA 与指纹 |
| 52 | `framework_state_extract` | 提取 React/Vue 组件状态 |
| 53 | `indexeddb_dump` | 导出 IndexedDB |
| 54 | `js_heap_search` | 搜索 V8 堆字符串（浏览器 CE 等价工具） |
| 55 | `tab_workflow` | 多标签协调（别名/导航/KV 共享） |

> 额外的浏览器工具（视口预设、设备目录等）通过配置动态注册。

</details>

### 调试器（39 个工具）

<details>
<summary>CDP 调试器、断点、监视、XHR/事件断点、会话持久化</summary>

| # | 工具 | 说明 |
|---|------|------|
| 1 | `debugger_enable` | 启用 CDP 调试器 |
| 2 | `debugger_disable` | 关闭调试器 |
| 3 | `debugger_pause` | 暂停执行 |
| 4 | `debugger_resume` | 恢复执行 |
| 5 | `debugger_step_into` | 步入 |
| 6 | `debugger_step_over` | 单步跳过 |
| 7 | `debugger_step_out` | 步出 |
| 8 | `debugger_wait_for_paused` | 等待暂停 |
| 9 | `debugger_get_paused_state` | 获取暂停状态 |
| 10 | `debugger_evaluate` | 调用帧求值 |
| 11 | `debugger_evaluate_global` | 全局上下文求值 |
| 12 | `debugger_save_session` | 保存调试会话 |
| 13 | `debugger_load_session` | 加载调试会话 |
| 14 | `debugger_export_session` | 导出会话 JSON |
| 15 | `debugger_list_sessions` | 列出已保存会话 |
| 16 | `breakpoint_set` | 设置断点 |
| 17 | `breakpoint_remove` | 移除断点 |
| 18 | `breakpoint_list` | 列出断点 |
| 19 | `breakpoint_set_on_exception` | 异常中断策略 |
| 20 | `get_call_stack` | 获取调用栈 |
| 21 | `get_object_properties` | 获取对象属性 |
| 22 | `get_scope_variables_enhanced` | 深度作用域变量 |
| 23 | `watch_add` | 添加监视 |
| 24 | `watch_remove` | 移除监视 |
| 25 | `watch_list` | 列出监视 |
| 26 | `watch_evaluate_all` | 评估全部监视 |
| 27 | `watch_clear_all` | 清空监视 |
| 28 | `xhr_breakpoint_set` | XHR 断点 |
| 29 | `xhr_breakpoint_remove` | 移除 XHR 断点 |
| 30 | `xhr_breakpoint_list` | 列出 XHR 断点 |
| 31 | `event_breakpoint_set` | 事件断点 |
| 32 | `event_breakpoint_set_category` | 按类别事件断点 |
| 33 | `event_breakpoint_remove` | 移除事件断点 |
| 34 | `event_breakpoint_list` | 列出事件断点 |
| 35 | `blackbox_add` | 黑盒脚本 |
| 36 | `blackbox_add_common` | 一键黑盒常见库 |
| 37 | `blackbox_list` | 列出黑盒规则 |

> 额外调试工具（高级单步、条件求值等）在 `full` 档位中可用。

</details>

### 网络（20 个工具）

<details>
<summary>CDP 网络监控、Auth 提取、HAR 导出、请求重放、控制台注入</summary>

| # | 工具 | 说明 |
|---|------|------|
| 1 | `network_enable` | 启用网络监控 |
| 2 | `network_disable` | 关闭网络监控 |
| 3 | `network_get_status` | 获取监控状态 |
| 4 | `network_get_requests` | 获取捕获请求（分页、URL 过滤不区分大小写、空结果返回 urlSamples） |
| 5 | `network_get_response_body` | 获取响应体 |
| 6 | `network_get_stats` | 网络统计 |
| 7 | `network_extract_auth` | 扫描 Auth 凭据（置信度评分+掩码） |
| 8 | `network_export_har` | 导出 HAR 1.2 |
| 9 | `network_replay_request` | 重放请求（SSRF 防护、逐跳 DNS 校验） |
| 10 | `performance_get_metrics` | Web Vitals |
| 11 | `performance_start_coverage` | 开始覆盖率记录 |
| 12 | `performance_stop_coverage` | 停止覆盖率 |
| 13 | `performance_take_heap_snapshot` | V8 堆快照 |
| 14 | `console_get_exceptions` | 未捕获异常 |
| 15 | `console_inject_script_monitor` | 动态脚本监控 |
| 16 | `console_inject_xhr_interceptor` | XHR 拦截器 |
| 17 | `console_inject_fetch_interceptor` | Fetch 拦截器（自动持久化 URL） |
| 18 | `console_clear_injected_buffers` | 清理注入缓冲区 |
| 19 | `console_reset_injected_interceptors` | 重置拦截器 |
| 20 | `console_inject_function_tracer` | 函数追踪器 |

</details>

### 工作流 / 复合（8 个工具）

<details>
<summary>全链路逆向高层编排</summary>

| # | 工具 | 说明 |
|---|------|------|
| 1 | `web_api_capture_session` | 导航 + 操作 + 收集请求 + Auth 提取 + HAR 导出 — 一次调用完成 |
| 2 | `register_account_flow` | 自动化注册：填表、提交、收集 Token、可选邮箱验证 |
| 3 | `api_probe_batch` | 批量探测 API（自动注入 Bearer、过滤 HTML 重定向） |
| 4 | `js_bundle_search` | 服务端 fetch + 缓存 JS Bundle；多正则搜索 + 噪音过滤 |
| 5 | `page_script_register` | 注册命名 JS 片段到脚本库 |
| 6 | `page_script_run` | 执行脚本库中的命名脚本 |
| 7 | `boost_profile` | *(元工具)* 动态加载高档位工具；TTL 自动过期（默认 30 分钟） |
| 8 | `unboost_profile` | *(元工具)* 卸载 boost 加载的工具 |

**内置脚本库预设**：`auth_extract`、`bundle_search`、`react_fill_form`、`dom_find_upgrade_buttons`

</details>

### Hook（8 个工具）

<details>
<summary>AI 生成的 JavaScript Hook 和 20+ 内置预设</summary>

| # | 工具 | 说明 |
|---|------|------|
| 1 | `ai_hook_generate` | 为函数/API/方法生成 Hook |
| 2 | `ai_hook_inject` | 注入 Hook 到页面 |
| 3 | `ai_hook_get_data` | 获取 Hook 捕获数据 |
| 4 | `ai_hook_list` | 列出活跃 Hook |
| 5 | `ai_hook_clear` | 清理 Hook |
| 6 | `ai_hook_toggle` | 启用/禁用 Hook |
| 7 | `ai_hook_export` | 导出 Hook 数据 |
| 8 | `hook_preset` | 安装预设 Hook |

**预设列表**：`eval`、`function-constructor`、`atob-btoa`、`crypto-subtle`、`json-stringify`、`object-defineproperty`、`settimeout`、`setinterval`、`addeventlistener`、`postmessage`、`webassembly`、`proxy`、`reflect`、`history-pushstate`、`location-href`、`navigator-useragent`、`eventsource`、`window-open`、`mutationobserver`、`formdata`

</details>

### 维护（6 个工具）

<details>
<summary>Token 预算追踪与缓存管理</summary>

| # | 工具 | 说明 |
|---|------|------|
| 1 | `get_token_budget_stats` | Token 预算统计 |
| 2 | `manual_token_cleanup` | 手动清理 |
| 3 | `reset_token_budget` | 硬重置计数 |
| 4 | `get_cache_stats` | 缓存统计 |
| 5 | `smart_cache_cleanup` | 智能清理 |
| 6 | `clear_all_caches` | 清空全部缓存 |

</details>

### 进程 / 内存 / Electron（26 个工具）

<details>
<summary>进程枚举、内存操作、DLL/Shellcode 注入、Electron 附加</summary>

| # | 工具 | 说明 |
|---|------|------|
| 1 | `process_find` | 按名称模式查找进程 |
| 2 | `process_list` | 列出全部进程 |
| 3 | `process_get` | PID 详情 |
| 4 | `process_windows` | 进程窗口句柄 |
| 5 | `process_find_chromium` | 查找 Chromium 进程 |
| 6 | `process_check_debug_port` | 检查调试端口 |
| 7 | `process_launch_debug` | 启动带调试端口的进程 |
| 8 | `process_kill` | 结束进程 |
| 9 | `memory_read` | 读取内存 |
| 10 | `memory_write` | 写入内存 |
| 11 | `memory_scan` | 扫描内存 |
| 12 | `memory_check_protection` | 检查保护属性 |
| 13 | `memory_protect` | 修改保护属性（Windows） |
| 14 | `memory_scan_filtered` | 二次扫描 |
| 15 | `memory_batch_write` | 批量写补丁 |
| 16 | `memory_dump_region` | 转储内存区域 |
| 17 | `memory_list_regions` | 列出内存区域 |
| 18 | `inject_dll` | DLL 注入（Windows） |
| 19 | `module_inject_dll` | `inject_dll` 别名 |
| 20 | `inject_shellcode` | Shellcode 注入（Windows） |
| 21 | `module_inject_shellcode` | `inject_shellcode` 别名 |
| 22 | `check_debug_port` | 检查是否被调试 |
| 23 | `enumerate_modules` | 枚举加载模块 |
| 24 | `module_list` | `enumerate_modules` 别名 |
| 25 | `electron_attach` | 附加 Electron 应用 |

> **平台说明**：内存读写/扫描/转储支持 Windows 和 macOS（lldb + vmmap）。注入工具需要 Windows + 提权。

</details>

## 生成产物与清理

| 产物 | 默认位置 | 生成工具 |
|------|----------|---------|
| HAR 流量 | `artifacts/har/jshhook-capture-<timestamp>.har` | `web_api_capture_session`、`network_export_har` |
| Workflow Markdown 报告 | `artifacts/reports/web-api-capture-<timestamp>.md` | `web_api_capture_session` |
| 截图 | `screenshots/manual/` | `page_screenshot` |
| CAPTCHA 截图 | `screenshots/` | `page_navigate` |
| 调试会话 | `sessions/` | `debugger_save_session` / `debugger_export_session` |

```bash
# 一键清理
rm -rf artifacts/har artifacts/reports screenshots/ sessions/
```

## 安全

- **认证**：设置 `MCP_AUTH_TOKEN` 启用 HTTP Bearer 令牌认证
- **CSRF 防护**：Origin 校验阻断无认证的跨域浏览器请求
- **SSRF 防御**：`network_replay_request` 和 `safeFetch` 使用 `redirect: 'manual'` + 逐跳 DNS pinning
- **路径穿越**：HAR 导出和调试会话使用 `fs.realpath` + symlink 检测
- **注入防护**：所有 PowerShell 操作使用 `execFile` + 输入净化

## License

MIT
