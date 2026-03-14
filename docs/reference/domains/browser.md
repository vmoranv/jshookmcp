# Browser

域名：`browser`

浏览器控制与 DOM 交互主域，也是大多数工作流的入口。

## Profile

- workflow
- full

## 典型场景

- 页面导航
- DOM 操作与截图
- 多标签页与本地存储读取

## 常见组合

- browser + network
- browser + hooks
- browser + workflow

## 代表工具

- `get_detailed_data` — 根据 detailId 获取完整详细数据。
- `browser_attach` — 通过 Chrome DevTools Protocol（CDP）附加到现有浏览器实例。
- `browser_list_tabs` — 列出当前已连接浏览器中的所有标签页或页面。
- `browser_select_tab` — 按索引或 URL/标题模式切换当前活动标签页。
- `browser_launch` — 启动浏览器实例。
- `browser_close` — 关闭当前浏览器实例。
- `browser_status` — 获取浏览器当前状态，包括运行情况、页面数量与版本信息。
- `page_navigate` — 导航到指定 URL。
- `page_reload` — 重新加载当前页面。
- `page_back` — 在浏览历史中后退。

## 工具清单（60）

<details>
<summary><b>导航与浏览器控制</b> (12 工具)</summary>

| 工具                 | 说明                             |
| -------------------- | -------------------------------- |
| `get_detailed_data`  | 根据 detailId 获取完整详细数据。 |
| `browser_attach`     | 通过 CDP 附加到现有浏览器实例。  |
| `browser_list_tabs`  | 列出所有标签页或页面。           |
| `browser_select_tab` | 切换活动标签页。                 |
| `browser_launch`     | 启动浏览器实例。                 |
| `browser_close`      | 关闭浏览器实例。                 |
| `browser_status`     | 获取浏览器状态。                 |
| `page_navigate`      | 导航到指定 URL。                 |
| `page_reload`        | 重新加载当前页面。               |
| `page_back`          | 后退。                           |
| `page_forward`       | 前进。                           |
| `page_press_key`     | 触发键盘按键。                   |

</details>

<details>
<summary><b>DOM 交互</b> (18 工具)</summary>

| 工具                     | 说明               |
| ------------------------ | ------------------ |
| `dom_query_selector`     | 查询单个元素。     |
| `dom_query_all`          | 查询所有匹配元素。 |
| `dom_get_structure`      | 获取 DOM 结构。    |
| `dom_find_clickable`     | 查找可点击元素。   |
| `dom_find_by_text`       | 按文本查找元素。   |
| `dom_get_computed_style` | 获取计算样式。     |
| `dom_get_xpath`          | 获取 XPath。       |
| `dom_is_in_viewport`     | 检查是否在视口内。 |
| `page_click`             | 点击元素。         |
| `page_type`              | 输入文本。         |
| `page_select`            | 选择选项。         |
| `page_hover`             | 悬停。             |
| `page_scroll`            | 滚动。             |
| `page_wait_for_selector` | 等待元素出现。     |
| `page_evaluate`          | 执行 JS 代码。     |
| `page_screenshot`        | 截图。             |
| `page_get_all_links`     | 获取所有链接。     |
| `page_inject_script`     | 注入脚本。         |
| `page_get_performance`   | 获取性能指标。     |

</details>

<details>
<summary><b>存储与 Cookies</b> (6 工具)</summary>

| 工具                     | 说明                |
| ------------------------ | ------------------- |
| `page_set_cookies`       | 设置 Cookie。       |
| `page_get_cookies`       | 获取 Cookie。       |
| `page_clear_cookies`     | 清除 Cookie。       |
| `page_get_local_storage` | 获取 localStorage。 |
| `page_set_local_storage` | 设置 localStorage。 |
| `indexeddb_dump`         | 导出 IndexedDB。    |

</details>

<details>
<summary><b>脚本与控制台</b> (6 工具)</summary>

| 工具                | 说明             |
| ------------------- | ---------------- |
| `get_all_scripts`   | 获取脚本列表。   |
| `get_script_source` | 获取脚本源码。   |
| `console_enable`    | 启用控制台监控。 |
| `console_get_logs`  | 获取控制台日志。 |
| `console_execute`   | 执行控制台代码。 |
| `js_heap_search`    | 搜索 JS 堆。     |

</details>

<details>
<summary><b>设备与视口</b> (2 工具)</summary>

| 工具                  | 说明           |
| --------------------- | -------------- |
| `page_set_viewport`   | 设置视口尺寸。 |
| `page_emulate_device` | 模拟移动设备。 |

</details>

<details>
<summary><b>反检测、验证码与拟人化</b> (10 工具)</summary>

| 工具                     | 说明                |
| ------------------------ | ------------------- |
| `captcha_detect`         | 检测 CAPTCHA。      |
| `captcha_wait`           | 等待手动验证。      |
| `captcha_config`         | 配置验证码行为。    |
| `captcha_vision_solve`   | 自动识别验证码。    |
| `widget_challenge_solve` | 处理验证挑战。      |
| `stealth_inject`         | 注入 stealth 脚本。 |
| `stealth_set_user_agent` | 设置 User-Agent。   |
| `human_mouse`            | 拟人化鼠标移动。    |
| `human_scroll`           | 拟人化滚动。        |
| `human_typing`           | 拟人化输入。        |

</details>

<details>
<summary><b>Camoufox 服务器</b> (3 工具)</summary>

| 工具                     | 说明             |
| ------------------------ | ---------------- |
| `camoufox_server_launch` | 启动服务器。     |
| `camoufox_server_close`  | 关闭服务器。     |
| `camoufox_server_status` | 获取服务器状态。 |

</details>

<details>
<summary><b>高级功能</b> (2 工具)</summary>

| 工具                      | 说明           |
| ------------------------- | -------------- |
| `framework_state_extract` | 提取组件状态。 |
| `tab_workflow`            | 跨标签页协调。 |

</details>
