# 工具选择

## 一句话判断

- **先 built-in，后扩展**
- **先 workflow，后 plugin**
- **并行适合读，不适合改共享页面状态**

## 决策树

```mermaid
flowchart TD
  A[当前目标] --> B{需要什么?}
  B -->|浏览页面| C[page_* / browser_*]
  B -->|抓请求与认证| D[web_api_capture_session / network_*]
  B -->|批量探测接口| E[api_probe_batch]
  B -->|找 bundle 证据| F[js_bundle_search / search_in_scripts]
  B -->|运行时 Hook / 断点| G[debugger_* / hook_* / ai_hook_*]
  B -->|流程固化| H[workflow]
  B -->|新增工具或桥接| I[plugin]
```

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
