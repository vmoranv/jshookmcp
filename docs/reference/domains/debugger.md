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
- `debugger_step_into` — 单步进入下一次函数调用。
- `debugger_step_over` — 单步跳过下一次函数调用。
- `debugger_step_out` — 单步跳出当前函数。
- `breakpoint_set` — 在指定位置设置断点，支持 URL、scriptId 和条件。
- `breakpoint_remove` — 按 ID 移除断点。
- `breakpoint_list` — 列出当前全部活动断点。

## 工具清单（37）

| 工具 | 说明 |
| --- | --- |
| `debugger_enable` | 启用调试器，可在此后设置断点。 |
| `debugger_disable` | 禁用调试器并清除全部断点。 |
| `debugger_pause` | 在下一条语句处暂停执行。 |
| `debugger_resume` | 恢复执行。 |
| `debugger_step_into` | 单步进入下一次函数调用。 |
| `debugger_step_over` | 单步跳过下一次函数调用。 |
| `debugger_step_out` | 单步跳出当前函数。 |
| `breakpoint_set` | 在指定位置设置断点，支持 URL、scriptId 和条件。 |
| `breakpoint_remove` | 按 ID 移除断点。 |
| `breakpoint_list` | 列出当前全部活动断点。 |
| `get_call_stack` | 获取当前调用栈（仅在断点暂停时可用）。 |
| `debugger_evaluate` | 在当前调用帧上下文中求值表达式。 |
| `debugger_evaluate_global` | 在全局上下文中求值表达式。 |
| `debugger_wait_for_paused` | 等待调试器进入暂停状态。 |
| `debugger_get_paused_state` | 获取当前暂停状态及原因。 |
| `breakpoint_set_on_exception` | 配置异常断点，可在全部或未捕获异常时暂停。 |
| `get_object_properties` | 获取对象的全部属性。 |
| `get_scope_variables_enhanced` | 增强查看作用域变量，支持深度对象遍历。 |
| `debugger_save_session` | 将当前调试会话保存为 JSON 文件。 |
| `debugger_load_session` | 加载调试会话并恢复断点与监视项。 |
| `debugger_export_session` | 将当前调试会话导出为 JSON 字符串。 |
| `debugger_list_sessions` | 列出已保存的调试会话。 |
| `watch_add` | 添加监视表达式以跟踪变量值。 |
| `watch_remove` | 按 ID 移除监视表达式。 |
| `watch_list` | 列出全部监视表达式。 |
| `watch_evaluate_all` | 计算全部已启用的监视表达式。 |
| `watch_clear_all` | 清空全部监视表达式。 |
| `xhr_breakpoint_set` | 为 XHR/Fetch 请求设置断点。 |
| `xhr_breakpoint_remove` | 按 ID 移除 XHR 断点。 |
| `xhr_breakpoint_list` | 列出全部 XHR 断点。 |
| `event_breakpoint_set` | 为指定事件监听设置断点。 |
| `event_breakpoint_set_category` | 为整类事件设置断点。 |
| `event_breakpoint_remove` | 按 ID 移除事件断点。 |
| `event_breakpoint_list` | 列出全部事件断点。 |
| `blackbox_add` | 将脚本加入黑盒列表，调试时自动跳过。 |
| `blackbox_add_common` | 一键将常见第三方库加入黑盒列表。 |
| `blackbox_list` | 列出全部黑盒脚本匹配规则。 |
