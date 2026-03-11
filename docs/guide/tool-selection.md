# 工具选择

## 决策路径

- 当前目标是 **浏览网页**：使用 `page_* / browser_*`
- 当前目标是 **网络抓包与认证**：使用 `web_api_capture_session / network_*`
- 当前目标是 **批量探测 API**：使用 `api_probe_batch`
- 当前目标是 **源码/Bundle 寻证**：使用 `js_bundle_search / search_in_scripts`
- 当前目标是 **运行时 Hook 与断点**：使用 `debugger_* / hook_* / ai_hook_*`
- 当前目标是 **业务流程固化**：使用 `workflow`
- 当前目标是 **集成新工具或子系统桥接**：使用 `plugin`

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
