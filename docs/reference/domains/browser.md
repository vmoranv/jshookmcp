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
- `browser_list_cdp_targets` — 列出当前已连接浏览器目标可见的所有 CDP 目标。
- `browser_select_tab` — 按索引或 URL/标题模式切换当前活动标签页。
- `browser_attach_cdp_target` — 根据 targetId 附加到指定的 CDP 目标。
- `browser_detach_cdp_target` — 断开当前已附加的底层 CDP 目标会话，并将 network/hooks 恢复为常规页面绑定。
- `browser_evaluate_cdp_target` — 在当前已附加的 CDP 目标会话中执行 JavaScript。
- `browser_launch` — 启动浏览器实例。
- `browser_close` — 关闭当前浏览器实例。

## 工具清单（57）

| 工具 | 说明 |
| --- | --- |
| `get_detailed_data` | 根据 detailId 获取完整详细数据。 |
| `browser_attach` | 通过 Chrome DevTools Protocol（CDP）附加到现有浏览器实例。 |
| `browser_list_tabs` | 列出当前已连接浏览器中的所有标签页或页面。 |
| `browser_list_cdp_targets` | 列出当前已连接浏览器目标可见的所有 CDP 目标。 |
| `browser_select_tab` | 按索引或 URL/标题模式切换当前活动标签页。 |
| `browser_attach_cdp_target` | 根据 targetId 附加到指定的 CDP 目标。 |
| `browser_detach_cdp_target` | 断开当前已附加的底层 CDP 目标会话，并将 network/hooks 恢复为常规页面绑定。 |
| `browser_evaluate_cdp_target` | 在当前已附加的 CDP 目标会话中执行 JavaScript。 |
| `browser_launch` | 启动浏览器实例。 |
| `browser_close` | 关闭当前浏览器实例。 |
| `browser_status` | 获取浏览器当前状态，包括运行情况、页面数量与版本信息。 |
| `page_navigate` | 导航到指定 URL。 |
| `page_reload` | 重新加载当前页面。 |
| `page_back` | 在浏览历史中后退。 |
| `page_forward` | 在浏览历史中前进。 |
| `page_click` | 点击指定元素，建议先用 dom_query_selector 确认元素存在。 |
| `page_type` | 在输入元素中输入文本。 |
| `page_select` | 在 &lt;select&gt; 元素中选择一个或多个选项。 |
| `page_hover` | 将鼠标悬停到指定元素上。 |
| `page_scroll` | 滚动页面到指定位置。 |
| `page_wait_for_selector` | 等待指定元素出现。 |
| `page_evaluate` | 在页面上下文中执行 JavaScript 代码并返回结果。 |
| `page_screenshot` | 截取页面或指定 DOM 元素的截图。 |
| `get_all_scripts` | 获取页面中所有已加载脚本的列表。 |
| `get_script_source` | 获取指定脚本的源代码。 |
| `console_monitor` | 启用或禁用控制台监控，捕获 console.log、console.error 等输出。 |
| `console_get_logs` | 待补充中文：Get captured console logs |
| `console_execute` | 在控制台上下文中执行 JavaScript 表达式。 |
| `page_inject_script` | 向当前页面注入 JavaScript 代码。 |
| `page_cookies` | 管理页面 Cookie。操作：get（获取全部）、set（需提供 cookies 数组）、clear（清除全部）。 |
| `page_set_viewport` | 待补充中文：Set viewport size |
| `page_emulate_device` | 待补充中文：Emulate mobile device (iPhone, iPad, Android) |
| `page_local_storage` | 管理 localStorage。操作：get（获取全部项）、set（需提供 key 和 value）。 |
| `page_press_key` | 触发一次键盘按键操作，如 Enter、Escape 或 ArrowDown。 |
| `captcha_detect` | 使用 AI 视觉分析检测当前页面上的 CAPTCHA。 |
| `captcha_wait` | 等待用户手动完成 CAPTCHA 验证。 |
| `captcha_config` | 配置 CAPTCHA 检测相关行为。 |
| `stealth_inject` | 注入现代化 stealth 脚本，以降低被反爬或反自动化检测的概率。 |
| `stealth_set_user_agent` | 为目标平台设置更真实的 User-Agent 与浏览器指纹。 |
| `stealth_configure_jitter` | 配置 CDP 命令时序抖动，在每个 CDP send() 调用间注入随机延迟以防止基于时序的自动化检测。 |
| `stealth_generate_fingerprint` | 生成真实的浏览器指纹配置文件，使用 fingerprint-generator 创建一致的浏览器特征集，自动缓存到当前会话。 |
| `stealth_verify` | 运行离线反检测审计，检查 10 项隐身指标并返回 0-100 分的评分与修复建议。 |
| `camoufox_server` | 管理 Camoufox WebSocket 服务器。先启动服务器，再通过 browser_launch 连接。 |
| `framework_state_extract` | 提取当前页面中 React/Vue/Svelte/Solid/Preact 组件状态，同时检测 Next.js/Nuxt 元框架元数据（路由、构建信息），便于调试和逆向分析 SPA 应用。 |
| `indexeddb_dump` | 导出所有 IndexedDB 数据库及其内容，便于分析 PWA 数据、令牌或离线状态。 |
| `js_heap_search` | 在浏览器 JavaScript 堆中检索匹配模式的字符串值，用于定位令牌、密钥、签名等内存数据。 |
| `tab_workflow` | 为多页面自动化流程提供跨标签页协调与共享上下文能力。 |
| `human_mouse` | 以拟人化方式移动鼠标，模拟自然轨迹与随机抖动。 |
| `human_scroll` | 以拟人化方式滚动页面，模拟变速、微停顿与减速效果。 |
| `human_typing` | 以拟人化方式输入文本，模拟变速、偶发输入错误与自动修正。 |
| `captcha_vision_solve` | 使用外部打码服务或 AI 视觉能力尝试自动完成 CAPTCHA。 |
| `widget_challenge_solve` | 处理并尝试完成嵌入式组件类验证挑战。 |
| `browser_jsdom_parse` | 将 HTML 解析到内存中的 JSDOM 会话（无需浏览器）。返回供其他 browser_jsdom_* 工具使用的 sessionId，会话闲置 10 分钟后自动过期。 |
| `browser_jsdom_query` | 在 JSDOM 会话中执行 CSS 选择器查询，返回匹配元素的属性、文本及可选的 HTML 或源码位置信息。 |
| `browser_jsdom_execute` | 在 JSDOM 会话中执行 JavaScript。需要会话以 runScripts="outside-only" 或 "dangerously" 模式解析。控制台输出会被捕获并返回。 |
| `browser_jsdom_serialize` | 将 JSDOM 会话序列化为 HTML。支持完整文档输出或 CSS 选择器片段输出，可选美化格式。 |
| `browser_jsdom_cookies` | 管理 JSDOM 会话的 Cookie。操作：get（列出）、set（添加）、clear（全部清除）。 |
