# 工具选择

## 核心原则：用 route_tool，不要堆砌元工具

**错误用法** — 手动链式调用元工具：

```text
search_tools → describe_tool → activate_tools → 调用工具   ← 浪费 4 轮上下文
```

**正确用法** — 一步到位：

```text
route_tool(task="拦截这个页面的 API 请求")   ← 自动推荐 + 激活 + 调用示例
```

`route_tool` 自动完成：任务意图分析 → 工作流模式匹配 → 域级激活（带 TTL）→ 返回推荐工具链和参数示例。**绝大多数场景一次 `route_tool` 调用就够了。**

## 决策路径

- 当前目标是 **浏览网页**：使用 `page_* / browser_*`
- 当前目标是 **网络抓包与认证**：使用 `web_api_capture_session / network_*`
- 当前目标是 **批量探测 API**：使用 `api_probe_batch`
- 当前目标是 **源码/Bundle 寻证**：使用 `js_bundle_search / search_in_scripts`
- 当前目标是 **运行时 Hook 与断点**：使用 `debugger_* / hook_* / ai_hook_*`
- 当前目标是 **业务流程固化**：使用 `workflow`
- 当前目标是 **集成新工具或子系统桥接**：使用 `plugin`

> **注意**：以上工具名仅做决策参考。实际使用时应通过 `route_tool` 获取精确工具名和参数。

## 三阶段工作流：Discover → Activate → Use

```text
1. DISCOVER  →  route_tool(task="描述你的意图")   — 首选，任务驱动，自动推荐 + 激活
                search_tools(query="关键词")       — 备选，关键词探索
2. ACTIVATE  →  通常 route_tool 已自动完成，手动激活仅用于：
                activate_domain(domain="network")  — 明确需要整个领域
                activate_tools(names=[...])        — 精确激活少量工具
3. USE       →  直接调用已激活工具
                call_tool(name, args)              — 工具不在列表中时的后备
```

## Profile 与基线工具集

通过 `MCP_TOOL_PROFILE` 环境变量配置。层级关系：**search ⊂ workflow ⊂ full**

| Profile                | 域数  | 包含域                                                                             | 适用场景                   |
| ---------------------- | ----- | ---------------------------------------------------------------------------------- | -------------------------- |
| `search`（默认）       | 1     | maintenance（仅元工具）                                                            | 按需发现，最省上下文       |
| **`workflow`（推荐）** | **9** | **+ analysis, browser, debugger, encoding, graphql, network, streaming, workflow** | **E2E 逆向、日常安全研究** |
| `full`                 | 16    | + antidebug, hooks, platform, process, sourcemap, transform, wasm                  | 全量，适合复杂调试         |

> **建议**：日常使用设置 `MCP_TOOL_PROFILE=workflow`，避免频繁的 discover-activate 开销。

### 各 Profile 的推荐使用姿势

**`search` 档位：**
遇到不熟悉、工具列表里没有、或不确定名字的能力时，不要先说做不到。先调用 `route_tool` 描述任务意图，让服务器推荐并自动激活。如果需要更精确的关键词搜索，用 `search_tools`。

**`workflow` 档位：**
browser、network、debugger、workflow 等核心域已预加载。大部分逆向任务可以直接开始，无需额外激活。只有需要 hooks/process/wasm 等重型能力时才需手动 `activate_domain`。

**`full` 档位：**
所有 238 工具预加载，无需任何激活操作。适合长时间联合调试。注意上下文开销较大。

## 关键规则

- **永远先 `route_tool`**：描述任务意图，让 jshook 推荐工具链和执行顺序，不要猜工具名
- **`search_tools` 仅用于探索**：不确定有什么工具时按关键词搜索
- **`describe_tool` 支持所有工具**：包括元工具自身（search_tools, activate_domain, call_tool 等）
- **`call_tool` 是万能后备**：工具激活后不出现在列表中时（MCP 客户端不支持 `tools/list_changed`），用 `call_tool` 直接按名调用
- **auto-activation 带 TTL**：`search_tools` / `route_tool` 触发的自动激活默认 30 分钟超时，到期自动清理

## SPA 逆向流注意事项

- Fetch/XHR 拦截器支持 `persistent: true` 模式，注入后跨导航持久生效，无需关注注入顺序
- 先查 `localStorage` — JWT/token 可能已经在那里，不需要抓包
- `api_probe_batch` 首批路径务必包含 OpenAPI 端点（`/docs`, `/openapi.json`）
- `web_api_capture_session` 自动导出 `.har` 到磁盘，context 压缩后可从文件恢复
- 确诊后降级：root cause 明确后停止使用 debugger/hook 类重工具

## 并行原则

### 适合并行

- `page_get_local_storage`
- `page_get_cookies`
- `network_get_requests`
- `console_get_logs`
- `extensions_list`

### 不适合并行

- `page_click` + `page_type`
- 登录 + 验证码
- 多个可能触发跳转的动作

## 子代理 (Sub-agent) 适用原则

### 适合委托给 Sub-agent 的任务

- Bundle 源码分析与理解
- 海量请求清单过滤与整理
- HAR 分析与报告初稿起草
- 扩展模板结构与文档学习

### 必须保留在主 Agent 的核心任务

- 需要强实时性的浏览器交互
- 敏感的登录态生命周期管理
- CAPTCHA
- 具有严格顺序与状态依赖的动作链
