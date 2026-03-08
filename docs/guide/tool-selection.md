# 工具选择

## 决策路径

- 当前目标是浏览页面：使用 `page_* / browser_*`
- 当前目标是抓请求与认证：使用 `web_api_capture_session / network_*`
- 当前目标是批量探测接口：使用 `api_probe_batch`
- 当前目标是找 bundle 证据：使用 `js_bundle_search / search_in_scripts`
- 当前目标是运行时 Hook / 断点：使用 `debugger_* / hook_* / ai_hook_*`
- 当前目标是流程固化：使用 `workflow`
- 当前目标是新增工具或桥接：使用 `plugin`

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

## subagent 使用原则

### 适合丢给 subagent

- bundle 阅读
- 请求清单整理
- HAR / 报告草稿
- 扩展模板说明文档

### 应保留在主 agent

- 浏览器实时操控
- 登录态步骤
- CAPTCHA
- 强顺序依赖动作
