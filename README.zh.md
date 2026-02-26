# jshhookmcp

[English](./README.md) | 中文

面向 AI 辅助 JavaScript 逆向工程的 MCP（模型上下文协议）服务器，提供 122 个工具。将浏览器自动化、Chrome DevTools Protocol 调试、网络监控、智能 JavaScript Hook 和 LLM 驱动的代码分析集成于单一服务器。

## 功能特性

- **浏览器自动化** — 启动 Chromium、页面导航、DOM 交互、截图、Cookie 与存储管理
- **CDP 调试器** — 断点设置、单步执行、作用域变量检查、监视表达式、会话保存/恢复
- **网络监控** — 请求/响应捕获、按 URL 或方法过滤、获取响应体
- **JavaScript Hook** — AI 生成的任意函数 Hook，20+ 内置预设（eval、crypto、atob、WebAssembly 等）
- **代码分析** — 反混淆（JScrambler、JSVMP、Packer）、加密算法检测、LLM 驱动的代码理解
- **CAPTCHA 处理** — AI 视觉检测、手动验证流程、可配置轮询
- **隐身注入** — 针对无头浏览器指纹识别的反检测补丁
- **性能优化** — 智能缓存、Token 预算管理、代码覆盖率统计

## 环境要求

- Node.js >= 18
- pnpm

若使用 Camoufox（`[full]` 安装），`camoufox-js` 建议 Node.js >= 20。

## 安装

### 默认安装（仅 Puppeteer）

```bash
pnpm install
pnpm build
```

### `[full]` 安装（Puppeteer + Camoufox）

```bash
pnpm install:full
pnpm build
```

`install:full` 已包含 `npx camoufox-js fetch`。
pnpm 语法不支持 `pnpm install -[full]`。

### 缓存清理（可选）

```bash
# Puppeteer 浏览器缓存
rm -rf ~/.cache/puppeteer

# Camoufox 浏览器缓存
rm -rf ~/.cache/camoufox
```

Windows 常见缓存路径：

- `%USERPROFILE%\\.cache\\puppeteer`
- `%LOCALAPPDATA%\\camoufox`

### 可选：启动性能档位

当前版本支持“工具渐进披露 + 按域懒初始化”：

- 启动时仅注册所选 profile/domain 的工具清单；
- 各 domain handler 在首次调用对应工具时才实例化，不在 init 阶段全量创建。

## 配置

将 `.env.example` 复制为 `.env` 并填写配置项：

```bash
cp .env.example .env
```

主要配置项：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DEFAULT_LLM_PROVIDER` | `openai` 或 `anthropic` | `openai` |
| `OPENAI_API_KEY` | OpenAI（或兼容接口）API Key | — |
| `OPENAI_BASE_URL` | OpenAI 兼容接口的 Base URL | `https://api.openai.com/v1` |
| `OPENAI_MODEL` | 模型名称 | `gpt-4-turbo-preview` |
| `ANTHROPIC_API_KEY` | Anthropic API Key | — |
| `PUPPETEER_HEADLESS` | 无头模式运行浏览器 | `true` |
| `PUPPETEER_EXECUTABLE_PATH` | 可选浏览器可执行路径（仅显式覆盖） | 由 Puppeteer 管理 |
| `LOG_LEVEL` | 日志详细程度（`debug`、`info`、`warn`、`error`） | `info` |
| `MCP_TRANSPORT` | 传输模式：`stdio` 或 `http` | `stdio` |
| `MCP_PORT` | HTTP 端口（仅 `MCP_TRANSPORT=http` 时生效） | `3000` |
| `MCP_TOOL_PROFILE` | 工具注册档位：`minimal` 或 `full` | `stdio` 默认 `minimal`，`http` 默认 `full` |
| `MCP_TOOL_DOMAINS` | 逗号分隔的域覆盖（`browser,debugger,network,maintenance,core,hooks,process`） | 未设置 |
| `MCP_SCREENSHOT_DIR` | 截图基础目录（会被规范到项目根目录内） | `screenshots/manual` |

档位规则：

- `MCP_TOOL_PROFILE=minimal`：`browser + debugger + network + maintenance`
- `MCP_TOOL_PROFILE=full`：全部域
- 若设置了 `MCP_TOOL_DOMAINS`，优先级高于 `MCP_TOOL_PROFILE`

示例：

```bash
# 本地轻量模式
MCP_TOOL_PROFILE=minimal node dist/index.js

# 只启用浏览器+维护工具
MCP_TOOL_DOMAINS=browser,maintenance node dist/index.js
```

截图路径规则：

- 绝对路径（如 `C:\tmp\a.png`）会被重写到项目内截图目录；
- 包含越界相对路径（如 `../../foo.png`）会被归一化到截图根目录内。

## MCP 客户端配置

在 MCP 客户端配置文件中添加以下内容：

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

## 工具域

### 浏览器（53 个工具）

浏览器生命周期、页面导航、DOM 交互、表单输入、截图、脚本执行、Cookie 和存储管理。

| # | 工具 | 说明 |
|---|------|------|
| 1 | `get_detailed_data` | 通过 `detailId` 获取大数据结果（超上下文限制时返回） |
| 2 | `browser_launch` | 启动浏览器实例（`chrome` 或 `camoufox`） |
| 3 | `camoufox_server_launch` | 启动 Camoufox WebSocket 服务 |
| 4 | `camoufox_server_close` | 关闭 Camoufox WebSocket 服务 |
| 5 | `camoufox_server_status` | 获取 Camoufox 服务状态 |
| 6 | `browser_attach` | 通过 CDP WebSocket 附加到已有浏览器 |
| 7 | `browser_close` | 关闭浏览器实例 |
| 8 | `browser_status` | 获取浏览器状态（运行中、页签数、版本） |
| 9 | `browser_list_tabs` | 列出所有标签页（索引、URL、标题） |
| 10 | `browser_select_tab` | 按索引或 URL/标题模式切换标签页 |
| 11 | `page_navigate` | 导航到 URL（含 CAPTCHA 检测/可选网络监控） |
| 12 | `page_reload` | 刷新当前页面 |
| 13 | `page_back` | 后退 |
| 14 | `page_forward` | 前进 |
| 15 | `dom_query_selector` | 查询单个 DOM 元素（点击前建议先调用） |
| 16 | `dom_query_all` | 查询所有匹配 DOM 元素 |
| 17 | `dom_get_structure` | 获取页面 DOM 结构（超大结果返回摘要+`detailId`） |
| 18 | `dom_find_clickable` | 查找所有可点击元素 |
| 19 | `dom_get_computed_style` | 获取元素计算样式 |
| 20 | `dom_find_by_text` | 按文本查找元素 |
| 21 | `dom_get_xpath` | 获取元素 XPath |
| 22 | `dom_is_in_viewport` | 判断元素是否在视口内 |
| 23 | `page_click` | 点击元素 |
| 24 | `page_type` | 向输入框输入文本 |
| 25 | `page_select` | 选择 `<select>` 选项 |
| 26 | `page_hover` | 悬停元素 |
| 27 | `page_scroll` | 页面滚动 |
| 28 | `page_press_key` | 键盘按键 |
| 29 | `page_wait_for_selector` | 等待元素出现 |
| 30 | `page_evaluate` | 在页面上下文执行 JavaScript（超大结果摘要化） |
| 31 | `page_screenshot` | 截图 |
| 32 | `page_get_performance` | 获取页面性能指标 |
| 33 | `page_inject_script` | 注入 JavaScript 到页面 |
| 34 | `page_set_cookies` | 设置 Cookie |
| 35 | `page_get_cookies` | 获取 Cookie |
| 36 | `page_clear_cookies` | 清空 Cookie |
| 37 | `page_set_viewport` | 设置视口大小 |
| 38 | `page_emulate_device` | 模拟移动设备 |
| 39 | `page_get_local_storage` | 获取 `localStorage` |
| 40 | `page_set_local_storage` | 设置 `localStorage` |
| 41 | `page_get_all_links` | 获取页面全部链接 |
| 42 | `get_all_scripts` | 获取页面已加载脚本列表 |
| 43 | `get_script_source` | 获取指定脚本源码（超大结果摘要化） |
| 44 | `console_enable` | 开启控制台日志采集 |
| 45 | `console_get_logs` | 获取采集到的控制台日志 |
| 46 | `console_execute` | 在控制台上下文执行表达式 |
| 47 | `captcha_detect` | AI 检测 CAPTCHA |
| 48 | `captcha_wait` | 等待用户手动通过 CAPTCHA |
| 49 | `captcha_config` | 配置 CAPTCHA 检测行为 |
| 50 | `stealth_inject` | 注入反检测脚本 |
| 51 | `stealth_set_user_agent` | 设置真实化 User-Agent 与指纹参数 |
| 52 | `framework_state_extract` | 提取 React/Vue 组件状态 |
| 53 | `indexeddb_dump` | 导出 IndexedDB 数据 |

### 调试器（37 个工具）

Chrome DevTools Protocol 调试器：断点、单步执行、作用域检查、监视表达式、XHR/事件断点、会话持久化。

| # | 工具 | 说明 |
|---|------|------|
| 1 | `debugger_enable` | 启用 CDP 调试器 |
| 2 | `debugger_disable` | 关闭调试器并清理断点 |
| 3 | `debugger_pause` | 暂停执行 |
| 4 | `debugger_resume` | 恢复执行 |
| 5 | `debugger_step_into` | 步入 |
| 6 | `debugger_step_over` | 单步跳过 |
| 7 | `debugger_step_out` | 步出 |
| 8 | `debugger_wait_for_paused` | 等待命中暂停态 |
| 9 | `debugger_get_paused_state` | 获取当前暂停状态 |
| 10 | `debugger_evaluate` | 在当前调用帧求值表达式 |
| 11 | `debugger_evaluate_global` | 在全局上下文求值表达式 |
| 12 | `debugger_save_session` | 保存调试会话 |
| 13 | `debugger_load_session` | 加载调试会话 |
| 14 | `debugger_export_session` | 导出调试会话 JSON |
| 15 | `debugger_list_sessions` | 列出已保存会话 |
| 16 | `breakpoint_set` | 设置断点 |
| 17 | `breakpoint_remove` | 移除断点 |
| 18 | `breakpoint_list` | 列出断点 |
| 19 | `breakpoint_set_on_exception` | 设置异常中断策略 |
| 20 | `get_call_stack` | 获取调用栈 |
| 21 | `get_object_properties` | 获取对象属性 |
| 22 | `get_scope_variables_enhanced` | 深度获取作用域变量 |
| 23 | `watch_add` | 添加监视表达式 |
| 24 | `watch_remove` | 移除监视表达式 |
| 25 | `watch_list` | 列出监视表达式 |
| 26 | `watch_evaluate_all` | 评估全部监视表达式 |
| 27 | `watch_clear_all` | 清空监视表达式 |
| 28 | `xhr_breakpoint_set` | 设置 XHR/Fetch 断点 |
| 29 | `xhr_breakpoint_remove` | 移除 XHR 断点 |
| 30 | `xhr_breakpoint_list` | 列出 XHR 断点 |
| 31 | `event_breakpoint_set` | 设置事件断点 |
| 32 | `event_breakpoint_set_category` | 按事件类别设置断点 |
| 33 | `event_breakpoint_remove` | 移除事件断点 |
| 34 | `event_breakpoint_list` | 列出事件断点 |
| 35 | `blackbox_add` | 按 URL 模式黑盒脚本 |
| 36 | `blackbox_add_common` | 一键黑盒常见第三方库 |
| 37 | `blackbox_list` | 列出黑盒脚本规则 |

### 网络（17 个工具）

基于 CDP 的网络监控、请求/响应捕获、统计聚合和控制台注入。

| # | 工具 | 说明 |
|---|------|------|
| 1 | `network_enable` | 启用网络请求监控 |
| 2 | `network_disable` | 关闭网络请求监控 |
| 3 | `network_get_status` | 获取网络监控状态 |
| 4 | `network_get_requests` | 获取已捕获请求 |
| 5 | `network_get_response_body` | 获取指定请求响应体 |
| 6 | `network_get_stats` | 获取网络统计信息 |
| 7 | `performance_get_metrics` | 获取 Web Vitals |
| 8 | `performance_start_coverage` | 开始 JS/CSS 覆盖率记录 |
| 9 | `performance_stop_coverage` | 停止覆盖率记录并返回报告 |
| 10 | `performance_take_heap_snapshot` | 生成 V8 堆快照 |
| 11 | `console_get_exceptions` | 获取页面未捕获异常 |
| 12 | `console_inject_script_monitor` | 注入动态脚本监控器 |
| 13 | `console_inject_xhr_interceptor` | 注入 XHR 拦截器 |
| 14 | `console_inject_fetch_interceptor` | 注入 Fetch 拦截器 |
| 15 | `console_clear_injected_buffers` | 清理注入缓冲区（XHR/Fetch 队列、动态脚本记录） |
| 16 | `console_reset_injected_interceptors` | 重置注入拦截器/监控器状态，支持后续干净重注入 |
| 17 | `console_inject_function_tracer` | 注入函数调用追踪器 |

> 说明：
> - Playwright/Camoufox 模式默认已使用 `page.on('request'/'response')` 进行轻量网络采集。
> - `console_inject_*` 属于可选深度观测能力（请求体/脚本级）。
> - 长会话建议先执行 `console_clear_injected_buffers` 或 `console_reset_injected_interceptors` 再重注入。

### Hook（8 个工具）

AI 生成的 JavaScript Hook 和 20+ 内置预设，用于拦截浏览器 API。

| # | 工具 | 说明 |
|---|------|------|
| 1 | `ai_hook_generate` | 为函数/API/对象方法生成 Hook 代码 |
| 2 | `ai_hook_inject` | 将生成的 Hook 注入页面 |
| 3 | `ai_hook_get_data` | 获取 Hook 捕获数据（参数/返回值/时间戳/调用次数） |
| 4 | `ai_hook_list` | 列出活跃 Hook |
| 5 | `ai_hook_clear` | 按 ID 清理 Hook，或清理全部 Hook 与数据 |
| 6 | `ai_hook_toggle` | 启用/禁用 Hook |
| 7 | `ai_hook_export` | 导出 Hook 数据（JSON/CSV） |
| 8 | `hook_preset` | 安装 20+ 内置预设 Hook |

**内置预设：** `eval`、`function-constructor`、`atob-btoa`、`crypto-subtle`、`json-stringify`、`object-defineproperty`、`settimeout`、`setinterval`、`addeventlistener`、`postmessage`、`webassembly`、`proxy`、`reflect`、`history-pushstate`、`location-href`、`navigator-useragent`、`eventsource`、`window-open`、`mutationobserver`、`formdata`

### 分析（13 个工具）

LLM 驱动的代码收集、反混淆、加密检测和 Hook 管理。

| # | 工具 | 说明 |
|---|------|------|
| 1 | `collect_code` | 从目标网站收集 JavaScript（摘要/优先级/增量/全量） |
| 2 | `search_in_scripts` | 在已收集脚本中按关键字或正则搜索 |
| 3 | `extract_function_tree` | 提取函数及其依赖树 |
| 4 | `deobfuscate` | LLM 辅助反混淆 |
| 5 | `understand_code` | 语义代码分析（结构/行为/风险） |
| 6 | `detect_crypto` | 识别加密算法与使用模式 |
| 7 | `manage_hooks` | 创建/查看/清除运行时 Hook |
| 8 | `detect_obfuscation` | 识别混淆技术 |
| 9 | `advanced_deobfuscate` | 高级反混淆（含 VM 导向策略） |
| 10 | `clear_collected_data` | 清理收集脚本数据、缓存与内存索引 |
| 11 | `get_collection_stats` | 获取收集/缓存/压缩统计 |
| 12 | `webpack_enumerate` | 枚举页面 webpack 模块并可按关键字搜索 |
| 13 | `source_map_extract` | 提取并解析 Source Map 还原源码 |

### 维护（6 个工具）

Token 预算追踪与缓存管理。

| # | 工具 | 说明 |
|---|------|------|
| 1 | `get_token_budget_stats` | Token 预算使用统计 |
| 2 | `manual_token_cleanup` | 手动触发 Token 清理（通常可释放 10–30%） |
| 3 | `reset_token_budget` | 硬重置 Token 预算计数 |
| 4 | `get_cache_stats` | 内部缓存统计（条目/命中率） |
| 5 | `smart_cache_cleanup` | 智能清理缓存并保留热点数据 |
| 6 | `clear_all_caches` | 清空全部缓存（破坏性） |

### Process / Memory / Electron（25 个工具）

| # | 工具 | 说明 |
|---|------|------|
| 1 | `process_find` | 按名称模式查找进程（PID、路径、窗口句柄） |
| 2 | `process_list` | 列出所有进程（`process_find` 空模式别名） |
| 3 | `process_get` | 获取指定 PID 的详细信息 |
| 4 | `process_windows` | 获取进程窗口句柄 |
| 5 | `process_find_chromium` | 设计上禁用：不扫描用户自装浏览器进程 |
| 6 | `process_check_debug_port` | 检查进程是否开放 CDP 调试端口 |
| 7 | `process_launch_debug` | 启动带远程调试端口的进程 |
| 8 | `process_kill` | 按 PID 结束进程 |
| 9 | `memory_read` | 读取进程内存 |
| 10 | `memory_write` | 写入进程内存 |
| 11 | `memory_scan` | 扫描内存模式（hex/value） |
| 12 | `memory_check_protection` | 检查内存页保护属性（R/W/X） |
| 13 | `memory_protect` | 修改内存页保护属性（Windows） |
| 14 | `memory_scan_filtered` | 在已过滤地址集内二次扫描 |
| 15 | `memory_batch_write` | 批量写内存补丁 |
| 16 | `memory_dump_region` | 将内存区域转储为二进制文件 |
| 17 | `memory_list_regions` | 列出内存区域及保护属性 |
| 18 | `inject_dll` | DLL 注入（`CreateRemoteThread + LoadLibraryA`） |
| 19 | `module_inject_dll` | `inject_dll` 别名 |
| 20 | `inject_shellcode` | Shellcode 注入执行 |
| 21 | `module_inject_shellcode` | `inject_shellcode` 别名 |
| 22 | `check_debug_port` | 检查进程是否被调试 |
| 23 | `enumerate_modules` | 枚举进程模块（DLL 基址等） |
| 24 | `module_list` | `enumerate_modules` 别名 |
| 25 | `electron_attach` | 附加到 Electron 应用并执行/检查 JS |

> 平台说明：
> - 内存读写/扫描/转储/区域列表：Windows 与 macOS 支持（macOS 依赖 lldb + vmmap）。
> - `memory_protect`、`memory_scan_filtered`、注入相关工具通常需要 Windows + 提权权限。
> - Linux/不支持平台会返回明确的“不可用”提示。

## License

MIT


