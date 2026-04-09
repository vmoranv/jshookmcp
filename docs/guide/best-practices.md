# 最佳实践

面向初次配置 jshookmcp 的用户，帮你快速上手并避免常见坑。

## 推荐 `.env` 配置

### 最小可用配置

```bash
# .env — 最小启动配置
PUPPETEER_HEADLESS=true
MCP_TOOL_PROFILE=workflow        # 推荐默认档位，覆盖 90% 逆向场景
```

### 需要扩展生态时

```bash
# 扩展 registry（安装官方 workflow/plugin 需要）
EXTENSION_REGISTRY_BASE_URL=https://raw.githubusercontent.com/vmoranv/jshookmcpextension/master/registry
```

---

## Profile 选择建议

| 场景 | 推荐 Profile | 理由 |
|------|-------------|------|
| 日常逆向 | `workflow` | 浏览器、网络、调试、Hook 常驻，token 开销适中 |
| 只做搜索/探索 | `search` | 极简模式，仅暴露元工具，token 最省 |
| 深度分析（WASM/进程/内存） | `full` | 全域预载，适合重型任务 |

```bash
# 切换方式
MCP_TOOL_PROFILE=workflow   # 在 .env 中设置
```

---

## 推荐安装的 Extension

通过 `install_extension` 工具安装官方扩展：

### Workflow（任务流）

| Workflow | 用途 | 安装命令 |
|----------|------|----------|
| `signature_hunter` | 签名算法定位：自动抓请求、识别加密参数、Hook 签名路径 | `install_extension("workflow:signature_hunter")` |
| `ws_protocol_lifter` | WebSocket 协议逆向：消息聚类、编码识别、handler 关联 | `install_extension("workflow:ws_protocol_lifter")` |
| `bundle_recovery` | Bundle 恢复：webpack 枚举、source map 恢复、模块结构还原 | `install_extension("workflow:bundle_recovery")` |
| `anti_bot_diagnoser` | 反检测诊断：对比 stealth/normal 指纹差异 | `install_extension("workflow:anti_bot_diagnoser")` |
| `evidence_pack` | 证据打包：一键收集请求、Cookie、快照为可回放包 | `install_extension("workflow:evidence_pack")` |

### Plugin（工具插件）

| Plugin | 用途 | 安装命令 |
|--------|------|----------|
| `pl-auth-extract` | 从页面提取 token/device-id 等鉴权要素 | `install_extension("plugin:pl-auth-extract")` |
| `pl-qwen-mail-open-latest` | 打开最新 QQ 邮件并提取正文 | `install_extension("plugin:pl-qwen-mail-open-latest")` |
| `pl-temp-mail-open-latest` | 打开临时邮箱最新邮件 | `install_extension("plugin:pl-temp-mail-open-latest")` |

安装后通过 `list_extension_workflows()` / `run_extension_workflow()` 调用。

---

## 环境调优

### 浏览器配置

```bash
# 指定 Chrome 路径（自动检测失败时）
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome
# 或
CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe

```

### 性能调优

```bash
# Token 预算（防止上下文爆炸）
TOKEN_BUDGET_MAX_TOKENS=200000

# 并发控制
jshook_IO_CONCURRENCY=4       # I/O 并发上限
jshook_CDP_CONCURRENCY=2       # CDP 操作并发上限
MAX_CONCURRENT_ANALYSIS=3      # 分析任务并发上限

# 缓存（推荐开启，减少重复采集）
ENABLE_CACHE=true
CACHE_TTL=3600
```

### 超时设置

```bash
# 浏览器操作超时
PUPPETEER_TIMEOUT=30000

# 外部工具超时
EXTERNAL_TOOL_TIMEOUT_MS=30000

# Workflow 批处理超时
WORKFLOW_BATCH_MAX_TIMEOUT_MS=300000
```

---

## 常见问题

### 搜索不到工具

**原因**：当前 profile 未包含目标域。

**解决**：

1. 切到更高档位：`MCP_TOOL_PROFILE=workflow`
2. 或运行时调用 `activate_tools(["debugger", "hooks"])`

### Extension 安装失败

**检查**：

1. 确认 registry URL 已配置：`EXTENSION_REGISTRY_BASE_URL=https://...`
2. 确认网络可达（需要访问 GitHub raw 内容）
3. 运行 `doctor_environment()` 诊断环境

### Hook 注入后无数据

**可能原因**：

- 目标函数在 iframe/worker 内，需要切换上下文
- 页面启用了 CSP，阻止注入脚本
- Hook 路径不正确（如 `window.fetch` vs `globalThis.fetch`）

**排查**：调用 `manage_hooks({ action: "list" })` 确认状态。

### 浏览器启动失败

**排查顺序**：

1. 运行 `doctor_environment()` 检查依赖
2. 显式指定浏览器路径：`PUPPETEER_EXECUTABLE_PATH=...`
3. 检查浏览器远程调试端口是否被占用

---

## 下一步

- [.env 与配置](/guide/configuration) — 完整配置项参考
- [工具路由](/guide/tool-selection) — Profile 与路由机制详解
- [域矩阵](/reference/) — 所有域的完整工具清单
- [Workflow 开发](/extensions/workflow-development) — 编写自己的 workflow
- [环境诊断](/operations/doctor-and-artifacts) — 检查 bridge 健康状态
