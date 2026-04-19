# Debugger

域名：`debugger`

基于 CDP 的断点、单步、调用栈、watch 与调试会话管理域。

## Profile

- workflow
- full

## 典型场景

- 断点调试
- 调用帧求值
- 调试会话保存/恢复

## 常见组合

- debugger + hooks
- debugger + antidebug

## 代表工具

- `debugger_enable` — 启用调试器，可在此后设置断点。
- `debugger_disable` — 禁用调试器并清除全部断点。
- `debugger_pause` — 在下一条语句处暂停执行。
- `debugger_resume` — 恢复执行。
- `debugger_step` — 单步执行代码（进入/跳过/跳出）。
- `breakpoint` — 待补充中文：Manage breakpoints: code (line/script), XHR (URL pattern), event listener, event category, and exception breakpoints.
- `get_call_stack` — 获取当前调用栈（仅在断点暂停时可用）。
- `debugger_evaluate` — 在特定上下文（当前调用帧或全局）中求值表达式。
- `debugger_wait_for_paused` — 等待调试器进入暂停状态。
- `debugger_get_paused_state` — 获取当前暂停状态及原因。

## 工具清单（17）

| 工具 | 说明 |
| --- | --- |
| `debugger_enable` | 启用调试器，可在此后设置断点。 |
| `debugger_disable` | 禁用调试器并清除全部断点。 |
| `debugger_pause` | 在下一条语句处暂停执行。 |
| `debugger_resume` | 恢复执行。 |
| `debugger_step` | 单步执行代码（进入/跳过/跳出）。 |
| `breakpoint` | 待补充中文：Manage breakpoints: code (line/script), XHR (URL pattern), event listener, event category, and exception breakpoints. |
| `get_call_stack` | 获取当前调用栈（仅在断点暂停时可用）。 |
| `debugger_evaluate` | 在特定上下文（当前调用帧或全局）中求值表达式。 |
| `debugger_wait_for_paused` | 等待调试器进入暂停状态。 |
| `debugger_get_paused_state` | 获取当前暂停状态及原因。 |
| `get_object_properties` | 获取对象的全部属性。 |
| `get_scope_variables_enhanced` | 增强查看作用域变量，支持深度对象遍历。 |
| `debugger_session` | 管理调试会话（保存/加载/导出/列表）。 |
| `watch` | 待补充中文：Manage watch expressions for monitoring variable values during debugging. |
| `blackbox_add` | 将脚本加入黑盒列表，调试时自动跳过。 |
| `blackbox_add_common` | 一键将常见第三方库加入黑盒列表。 |
| `blackbox_list` | 列出全部黑盒脚本匹配规则。 |
