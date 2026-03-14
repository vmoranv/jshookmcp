# 工具选择

## 决策路径

- 当前目标是 **浏览网页**：使用 `page_* / browser_*`
- 当前目标是 **网络抓包与认证**：使用 `web_api_capture_session / network_*`
- 当前目标是 **批量探测 API**：使用 `api_probe_batch`
- 当前目标是 **源码/Bundle 寻证**：使用 `js_bundle_search / search_in_scripts`
- 当前目标是 **运行时 Hook 与断点**：使用 `debugger_* / hook_* / ai_hook_*`
- 当前目标是 **业务流程固化**：使用 `workflow`
- 当前目标是 **集成新工具或子系统桥接**：使用 `plugin`

## Search 基座与升级规则

- 完整共有 **三档**：`search / workflow / full`
- `search` 是默认基座档，不是“自动升级档”。
- `workflow` 与 `full` 是按需进入的升级挡位。
- `search_tools` **只做检索与排序**，不会自动 `activate_tools`，也不会自动 `boost_profile`。
- 推荐链路是：`search_tools -> activate_tools / activate_domain -> （确有需要时）boost_profile`
- 如果你只需要少量明确工具，优先 `activate_tools`，**不用**为了单个工具先升到 `workflow / full`。
- `boost_profile` 适合“接下来会反复使用一整组相关工具”的阶段，而不是每次 search 之后机械地补一次升档。

## 最佳实践 Prompt

下面这些 prompt 适合放进 MCP 客户端对 `jshook` 的长期指令里，用来约束 agent 在不同档位下的行为。
这里是 **3 个档位 prompt**：`search / workflow / full`。

### `search` 挡位 Prompt

```text
你当前运行在 jshook 的 search 默认基座档。遇到不熟悉、当前工具列表里没有、或不确定名字的能力时，不要先说做不到；先调用 search_tools 检索最相关的工具。search_tools 返回后，优先用 activate_tools 精确激活所需工具，或用 activate_domain 激活整个域。只有在接下来会持续使用一整组相关能力时，才调用 boost_profile 升到 workflow 或 full。
```

### `workflow` 挡位 Prompt

```text
如果任务涉及页面交互链路、抓包、认证提取、批量 API 探测、streaming、debugger / network 联动或重复业务流程，先 search_tools 判断候选。只有当你预计会反复使用 browser、network、debugger、workflow 等成组能力时，才 boost_profile 到 workflow；如果只是临时用一两个工具，优先 activate_tools，不要为单工具机械升档。
```

### `full` 挡位 Prompt

```text
只有在明确需要 hook、process、wasm、antidebug、platform、sourcemap、transform 等重型逆向能力，或需要长时间联合调试时，才 boost_profile 到 full。进入 full 后应集中完成这一阶段工作，结束后及时 unboost_profile，或让 TTL 自动回落，避免长期占用高上下文成本。
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
