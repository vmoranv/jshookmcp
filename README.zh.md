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

## 安装

```bash
pnpm install
pnpm build
```

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

### 浏览器（45 个工具）

浏览器生命周期、页面导航、DOM 交互、表单输入、截图、脚本执行、Cookie 和存储管理。

| 工具 | 说明 |
|------|------|
| `browser_launch` | 启动 Chromium 浏览器实例 |
| `browser_close` | 关闭浏览器 |
| `browser_status` | 获取当前浏览器/页面状态 |
| `page_navigate` | 导航到指定 URL |
| `page_click` | 点击 DOM 元素 |
| `page_type` | 向输入框输入文本 |
| `page_evaluate` | 在页面上下文中执行 JavaScript |
| `page_screenshot` | 截取页面截图 |
| `dom_query_selector` | 查询单个 DOM 元素 |
| `dom_query_all` | 查询所有匹配元素 |
| `captcha_detect` | AI 驱动的 CAPTCHA 检测 |
| `captcha_wait` | 等待手动完成 CAPTCHA |
| `stealth_inject` | 注入反检测补丁 |
| ... | 32 个更多浏览器工具 |

### 调试器（37 个工具）

Chrome DevTools Protocol 调试器：断点、单步执行、作用域检查、监视表达式、XHR/事件断点、会话持久化。

| 工具 | 说明 |
|------|------|
| `debugger_enable` | 启用 CDP 调试器 |
| `debugger_pause` | 暂停执行 |
| `debugger_resume` | 恢复执行 |
| `debugger_step_into` | 步入下一个调用 |
| `breakpoint_set` | 设置断点 |
| `get_call_stack` | 获取当前调用栈 |
| `debugger_evaluate` | 在暂停帧中求值表达式 |
| `get_scope_variables_enhanced` | 深度作用域变量检查 |
| `watch_add` | 添加监视表达式 |
| `xhr_breakpoint_set` | 对 XHR URL 模式设置断点 |
| `debugger_save_session` | 保存调试会话到文件 |
| `debugger_load_session` | 恢复已保存的会话 |
| ... | 25 个更多调试器工具 |

### 网络（15 个工具）

基于 CDP 的网络监控、请求/响应捕获、统计聚合和控制台注入。

| 工具 | 说明 |
|------|------|
| `network_enable` | 启用网络监控 |
| `network_get_requests` | 列出捕获的请求 |
| `network_get_response_body` | 按请求 ID 获取响应体 |
| `network_get_stats` | 聚合请求统计 |
| `performance_get_metrics` | 页面性能指标 |
| `performance_start_coverage` | 开始记录代码覆盖率 |
| `console_inject_xhr_interceptor` | 注入 XHR 拦截器 |
| `console_inject_fetch_interceptor` | 注入 Fetch 拦截器 |
| ... | 7 个更多网络工具 |

### Hook（8 个工具）

AI 生成的 JavaScript Hook 和 20+ 内置预设，用于拦截浏览器 API。

| 工具 | 说明 |
|------|------|
| `ai_hook_generate` | 为 URL/函数模式生成 Hook |
| `ai_hook_inject` | 将生成的 Hook 注入页面 |
| `ai_hook_get_data` | 获取捕获的 Hook 数据 |
| `ai_hook_list` | 列出所有活跃的 Hook |
| `ai_hook_toggle` | 启用或禁用 Hook |
| `ai_hook_export` | 将 Hook 数据导出为 JSON 或 HAR |
| `hook_preset` | 安装内置预设 Hook |

**内置预设：** `eval`、`function-constructor`、`atob-btoa`、`crypto-subtle`、`json-stringify`、`object-defineproperty`、`settimeout`、`setinterval`、`addeventlistener`、`postmessage`、`webassembly`、`proxy`、`reflect`、`history-pushstate`、`location-href`、`navigator-useragent`、`eventsource`、`window-open`、`mutationobserver`、`formdata`

### 分析（11 个工具）

LLM 驱动的代码收集、反混淆、加密检测和 Hook 管理。

| 工具 | 说明 |
|------|------|
| `collect_code` | 从页面收集 JavaScript |
| `search_in_scripts` | 在收集的脚本中搜索模式 |
| `deobfuscate` | LLM 辅助代码反混淆 |
| `advanced_deobfuscate` | 带 AST 优化的深度反混淆 |
| `understand_code` | LLM 代码解释 |
| `detect_crypto` | 识别代码中的加密算法 |
| `detect_obfuscation` | 识别混淆技术 |
| `extract_function_tree` | 提取函数及其依赖 |
| `manage_hooks` | 创建/列出/清除浏览器 Hook |

### 维护（6 个工具）

Token 预算追踪与缓存管理。

| 工具 | 说明 |
|------|------|
| `get_token_budget_stats` | Token 使用统计 |
| `manual_token_cleanup` | 手动裁剪 Token 预算 |
| `reset_token_budget` | 重置 Token 预算 |
| `get_cache_stats` | 缓存使用统计 |
| `smart_cache_cleanup` | 清除过期缓存条目 |
| `clear_all_caches` | 清空所有缓存 |

## License

MIT
