# 最佳实践

基于真实逆向场景沉淀的工作流与扩展推荐。

## 推荐的 Extension Workflow

以下 workflow 已按逆向任务类型分类，可直接通过 `run_extension_workflow` 调用：

### 签名算法定位

**`signature_hunter`** — 从一次页面动作出发，自动完成：
1. 启用网络监控并导航到目标页
2. 捕获请求并识别含签名的参数
3. 并行搜索脚本、检测加密/混淆、读取 Cookie/Storage
4. 抽取函数依赖树
5. 对签名路径下 Hook 并捕获明文/密文
6. 提取鉴权面信息并写入证据图

```json
{
  "name": "run_extension_workflow",
  "arguments": {
    "workflowId": "signature_hunter",
    "input": {
      "url": "https://example.com/login",
      "targetParam": "sign",
      "enableHook": true
    }
  }
}
```

### WebSocket 协议逆向

**`ws_protocol_lifter`** — 自动聚类 WS 消息、尝试解码（JSON/base64/protobuf/msgpack）、关联 handler 函数并生成协议摘要。

### Bundle 恢复

**`bundle_recovery`** — 采集脚本 → 识别 webpack/source-map → 恢复模块结构 → 可选 webcrack 解包 → 抽取函数树。

### 反检测诊断

**`anti_bot_diagnoser`** — 对比普通模式与 stealth 模式的指纹差异，定位 webdriver/CDP/canvas/WebRTC 等检测点。

### 证据打包

**`evidence_pack`** — 一键收集请求、Cookie、Storage、本地快照、HAR 导出，生成可回放的证据包。

---

## 推荐的 Extension Plugin

| Plugin | 用途 | 安装方式 |
|--------|------|----------|
| `pl-qwen-mail-open-latest` | 打开最新 QQ 邮件并提取正文 | `install_extension("plugin:pl-qwen-mail-open-latest")` |
| `pl-temp-mail-open-latest` | 打开临时邮箱最新邮件 | 同上 |
| `pl-auth-extract` | 从页面提取 token/device-id 等鉴权要素 | 同上 |

---

## 典型逆向工作流

### 场景 1：登录流签名定位

```
1. run_extension_workflow("signature_hunter", { url, targetParam: "sign" })
   → 返回签名函数路径 + hook 点 + 证据图节点 ID

2. manage_hooks({ action: "list" })
   → 确认 hook 已注入

3. network_extract_auth({ requestId: "..." })
   → 提取完整鉴权参数链

4. evidence_export({ format: "json" })
   → 导出证据图供后续复盘
```

### 场景 2：私有 API 批量探测

```
1. api_probe_batch({ baseUrl, patterns: ["swagger", "openapi", "graphql"] })
   → 返回发现的端点列表

2. web_api_capture_session({ url, actions: [...] })
   → 执行预设动作并捕获所有请求

3. search_in_scripts({ keyword: "Authorization" })
   → 定位 header 注入点
```

### 场景 3：Electron 应用桥接面映射

```
1. electron_bridge_mapper({ appPath: "/path/to/app" })
   → 扫描 preload/asar/IPC 端点

2. manage_hooks({ action: "inject", preset: "electron-ipc" })
   → 注入 IPC 拦截器

3. page_navigate({ url: "file:///path/to/index.html" })
   → 触发 IPC 调用并捕获
```

---

## 性能与稳定性建议

### 1. 使用 profile 分层控制工具可见性

- **默认启动** = `search` 档（~12 个工具），token 开销最小
- 需要运行时分析时调用 `activate_tools(["debugger", "hooks"])`
- 需要深层逆向时调用 `boost_profile("workflow")` 或 `boost_profile("full")`

### 2. 用 instrumentation session 收束 hook 生命周期

```javascript
// workflow 内推荐模式
onStart: async (ctx) => {
  const sessionId = await ctx.invokeTool('instrumentation_session_create', {
    name: 'signature-capture-session',
  });
  ctx.setSessionData('sessionId', sessionId);
}

onFinish: async (ctx) => {
  const sessionId = ctx.getSessionData('sessionId');
  await ctx.invokeTool('instrumentation_session_close', { id: sessionId });
  await ctx.invokeTool('instrumentation_artifact_record', { sessionId });
}
```

### 3. 避免重复采集

- 先用 `page_get_cookies` / `page_get_local_storage` 读缓存
- 必须刷新时才调用 `page_navigate` + `collect_code`
- 大脚本采集后写入 `save_page_snapshot`，后续步骤复用快照

### 4. 超时与重试策略

- 单步 tool call 设置 `timeoutMs: 30000`（默认 30s）
- 网络请求类工具加 `retry: { maxAttempts: 3, backoffMs: 500 }`
- workflow 整体设置 `.timeoutMs(10 * 60_000)`（10 分钟）

---

## 故障排查

### 问题：extension workflow 找不到

**检查**：
```javascript
list_extension_workflows()
// 返回空数组？
```

**解决**：
1. 确认 `workflows/` 目录下有 `*/workflow.js` 或 `*/workflow.ts`
2. 运行 `pnpm install` 确保 extension registry 已同步
3. 检查 `server.json` 中 `EXTENSION_REGISTRY_BASE_URL` 配置

### 问题：hook 注入后无数据捕获

**可能原因**：
- 目标函数在 iframe/worker 内，需要切换上下文
- hook 路径错误（如 `window.fetch` vs `globalThis.fetch`）
- 页面已启用 CSP，阻止注入脚本

**排查步骤**：
1. `manage_hooks({ action: "list" })` 确认 hook 状态
2. `console_execute({ expression: "document.querySelectorAll('iframe')" })` 检查 iframe
3. 尝试 `page_inject_script({ content: "...", persistent: true })` 手动注入测试

---

## 下一步

- [域矩阵](/reference/) — 查看所有域的完整工具清单
- [Workflow 开发](/extensions/workflow-development) — 编写自己的 mission workflow
- [环境诊断](/operations/doctor-and-artifacts) — 检查 bridge 健康状态
