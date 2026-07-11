# 浏览器

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
- browser + instrumentation
- browser + workflow

## 工具清单（76）

| 工具 | 说明 |
| --- | --- |
| `get_detailed_data` | 获取之前因数据量过大而被截断的完整内容。 |
| `get_offloaded_data` | 取回此前卸载到磁盘的字段的原始字节（见占位符里的 `_offload.path`）。二进制大块（如解码后的 `data:` URI）默认以 base64 返回；文本用 encoding="utf8"。 |
| `browser_attach` | 通过 CDP 连接到一个正在运行的浏览器。 |
| `browser_list_tabs` | 列出浏览器中所有打开的标签页。 |
| `browser_list_cdp_targets` | 列出当前已连接浏览器目标可见的所有 CDP 目标。 |
| `browser_select_tab` | 切换到指定的标签页，可按索引、URL 或标题模式匹配。 |
| `browser_attach_cdp_target` | 连接到浏览器中的特定目标，如某个 iframe 或 Worker。 |
| `browser_detach_cdp_target` | 断开当前已附加的底层 CDP 目标会话，并恢复为常规页面绑定。 |
| `browser_evaluate_cdp_target` | 在当前已附加的 CDP 目标会话中执行 JavaScript。 |
| `browser_list_workers` | 通过 Target.getTargets 枚举 Service Worker / Shared Worker / 专用 Web Worker 目标。随后用 browser_worker_scripts(targetId=...) 导出某 worker 已加载的脚本——对分析 PWA / SW 承载的鉴权代码必不可少。 |
| `browser_worker_scripts` | 为 worker 目标挂载 CDP 会话并导出其已解析的脚本（相当于 get_all_scripts，但作用域限定在 worker）。Debugger.enable 会重放 scriptParsed 事件，因此 worker 已加载的脚本也会被返回。 |
| `browser_font_fingerprint` | 枚举本地已安装字体用于指纹分析。主路径是 Local Font Access API（queryLocalFonts，Chromium 103+）；不可用或被拒时回退到一组精简的 document.fonts.check 探针。返回检测到的字体集合、用于比对的稳定哈希，并可选地伪造字体指纹。 |
| `browser_launch` | 启动浏览器。 |
| `browser_close` | 关闭浏览器。 |
| `browser_status` | 查看浏览器状态：是否运行中、打开了几个标签页、版本号。 |
| `page_navigate` | 跳转到指定 URL。 |
| `page_reload` | 重新加载当前页面。 |
| `page_back` | 后退到上一个页面。 |
| `page_forward` | 前进到下一个页面。 |
| `page_list_frames` | 列出页面中所有框架（iframe），返回 frameId、父框架、跨域标记等元数据。 |
| `page_click` | 点击页面上的元素。 |
| `page_type` | 在输入框中输入文字。 |
| `page_upload_files` | 向 &lt;input type="file"&gt; 元素上传一个或多个本地文件。 |
| `page_select` | 在 &lt;select&gt; 下拉菜单中选择选项。 |
| `page_hover` | 将鼠标移到元素上方。 |
| `page_scroll` | 滚动页面。 |
| `page_wait_for_selector` | 等待某个元素出现。 |
| `page_evaluate` | 在页面上下文中执行 JavaScript 代码并返回结果。 |
| `page_screenshot` | 截取页面或指定 DOM 元素的截图。 |
| `get_all_scripts` | 列出页面中加载的所有脚本。 |
| `get_script_source` | 查看某个脚本的源代码。 |
| `console_monitor` | 启用或禁用控制台监控，捕获 console.log、console.error 等输出。 |
| `console_get_logs` | 获取当前页面已捕获的控制台日志输出。 |
| `console_execute` | 在控制台中执行 JavaScript 表达式。 |
| `page_inject_script` | 向页面注入 JavaScript 代码。 |
| `page_coverage_start` | 在活动页面上开始 JS+CSS 代码覆盖率采集。覆盖率追踪每个已加载脚本/样式表中实际执行的字节。使用 page_coverage_stop 停止采集并获取结果。 |
| `page_coverage_stop` | 停止覆盖率采集并返回每个脚本的 JS+CSS 覆盖率结果。包含每个 URL 的总字节数、已用字节数和覆盖率百分比。 |
| `page_block_script` | 按 URL 模式管理脚本拦截规则。被拦截的脚本将被阻止加载/执行。操作：add/block（添加规则）、remove/unblock（移除规则）、list（显示全部规则）、clear（清除全部）。 |
| `page_cookies` | 管理页面 Cookie。操作：get（获取全部）、set（需提供 cookies 数组）、clear（清除全部）。 |
| `page_set_viewport` | 设置当前页面视口尺寸。 |
| `page_emulate_device` | 模拟移动设备环境，例如 iPhone、iPad 或 Android 机型。 |
| `page_local_storage` | 管理 localStorage。操作：get（获取全部项）、set（需提供 key 和 value）。 |
| `page_session_storage` | 读取、写入或清空当前域名下的 sessionStorage。 |
| `page_storage_info` | 查询 navigator.storage.estimate() 获取当前源的存储用量与配额，并检查 navigator.storage.persisted() 的持久化状态，用于 PWA / 离线应用的存储预算与持久化分析。 |
| `browser_passkey_seed` | 向浏览器注入 WebAuthn/Passkey 虚拟凭据，用于 FIDO2 认证自动化测试。 |
| `page_press_key` | 模拟按下键盘按键，如 Enter、Escape 或 ArrowDown。 |
| `page_handle_dialog` | 控制 JavaScript 对话框（alert/confirm/prompt/beforeunload）的处理方式。默认安装持久处理器，自动关闭所有后续对话框；设置 dismissAll=false 则改为单次处理下一个对话框（带 30s 超时）。 |
| `service_worker_deliver_push` | 通过 CDP ServiceWorker.deliverPushMessage 向 Service Worker 投递一条合成的 push 消息，用于测试 push 事件处理逻辑。需先在 SW 目标上挂载 CDP 会话。 |
| `service_worker_dispatch_sync` | 通过 CDP ServiceWorker.dispatchSyncEvent 向 Service Worker 派发 Background Sync 事件，用于触发并测试后台同步逻辑。需先在 SW 目标上挂载 CDP 会话。 |
| `captcha_detect` | 使用 AI 视觉分析检测页面上是否有 CAPTCHA 验证码。 |
| `captcha_wait` | 等待用户手动完成 CAPTCHA 验证码。 |
| `captcha_config` | 配置 CAPTCHA 验证码的检测和自动处理行为。 |
| `stealth_inject` | 注入反检测脚本，降低被网站识别为自动化的概率。 |
| `stealth_set_user_agent` | 设置更真实的 User-Agent 与浏览器指纹信息。 |
| `stealth_configure_jitter` | 配置 CDP 命令时序抖动，在每个 CDP send() 调用间注入随机延迟以防止基于时序的自动化检测。 |
| `stealth_generate_fingerprint` | 生成逼真的浏览器指纹，包括屏幕、WebGL、navigator、字体等。 |
| `stealth_verify` | 运行反检测审计，检查多项隐身指标并返回 0-100 分及修复建议。 |
| `camoufox_geolocation` | 根据 locale 获取地理定位数据（经纬度、精度），可选通过代理查询公网 IP。需要 camoufox-js。 |
| `camoufox_server` | 管理 Camoufox WebSocket 服务器。先启动服务器，再通过 browser_launch 连接。 |
| `framework_state_extract` | 提取页面中 React/Vue/Svelte/Solid/Preact 组件状态，并检测 Next.js/Nuxt 等元框架的路由和构建信息，用于调试或逆向分析 SPA 应用。 |
| `indexeddb_dump` | 导出所有 IndexedDB 数据库及其内容，便于分析 PWA 数据、令牌或离线状态。 |
| `js_heap_search` | 在浏览器 JavaScript 堆中检索匹配模式的字符串值，用于定位 token、密钥、签名等敏感数据。 |
| `tab_workflow` | 多标签页协同操作，支持跨标签页传递数据。 |
| `browser_codegen_start` | 开始录制浏览器操作，将页面交互转化为可回放的步骤序列。 |
| `browser_codegen_stop` | 停止录制浏览器操作，返回经过清洗和合并的可回放步骤列表。 |
| `human_mouse` | 模拟真人移动鼠标，带随机轨迹和抖动。 |
| `human_scroll` | 模拟真人滚动页面，带变速和停顿。 |
| `human_typing` | 模拟真人打字，带变速和偶尔打错再修正。 |
| `captcha_solver_capabilities` | 查看当前 CAPTCHA 求解方式是否可用。 |
| `captcha_vision_solve` | 用手动流程或已配置的外部服务处理验证码。 |
| `widget_challenge_solve` | 用 hook、手动或已配置的外部服务处理部件验证。 |
| `browser_jsdom_parse` | 在内存中解析 HTML（无需启动浏览器），供其他 JSDOM 工具使用。 |
| `browser_jsdom_query` | 在 JSDOM 会话中执行 CSS 选择器查询，返回匹配元素的属性、文本及可选的 HTML 或源码位置信息。 |
| `browser_jsdom_execute` | 在 JSDOM 会话中执行 JavaScript，控制台输出会被捕获并返回。 |
| `browser_jsdom_serialize` | 将 JSDOM 会话序列化为 HTML。支持完整文档输出或 CSS 选择器片段输出，可选美化格式。 |
| `browser_jsdom_cookies` | 管理 JSDOM 会话的 Cookie。操作：get（列出）、set（添加）、clear（全部清除）。 |
