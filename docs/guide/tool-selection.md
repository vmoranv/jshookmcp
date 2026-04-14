# 工具路由与生命周期

`jshookmcp` 实现了声明式的动态工具路由架构，采用命名空间与按需激活隔离。严禁在调度方硬编码工具签名预期，一切关联依赖和预热必须通过路由总线动态解析。

## 核心路由协议

### 标准解析流

所有非缓存命中场景的第一顺位调用必须为 `route_tool`，而非组合调用搜索协议。

```yaml
Tool: route_tool
Args: { task: '劫持并拦截当前页面 /api/login 的 POST 口令' }
```

调用侧抛出意图后，Server 将代理执行：语义匹配 → 依赖树解析 → 关联域沙箱热激活（TTL 托管）→ 下发附带最佳实践的上下文响应。

::: danger 反模式 (Anti-Pattern)
手动链式调度 `search_tools` → `describe_tool` → `activate_tools` 是未优化的降级链路，将导致极高的 RTT (Round-Trip Time) 延迟和 Token 损耗。仅在探查模式或路由失效时使用。
:::

### 运行时基线模式

全局可用工具面由 `MCP_TOOL_PROFILE` 环境变量映射的内存驻留策略决定。

| Profile 标识      | 驻留域 (Domains)                                                                           | 行为特征                                                           | RTT 损耗 |
| ----------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | -------- |
| `search`          | maintenance                                                                                | 极简模式，仅暴露元工具，所有业务域全量依赖 `route_tool` 动态懒加载 | 最高     |
| `workflow` (推荐) | analysis, browser, coordination, debugger, encoding, graphql, network, streaming, workflow | 覆盖 90% Web/逆向工作流，核心套件常驻内存                          | 较低     |
| `full`            | 全域静态预载                                                                               | 全量挂载所有工具，抹平按需加载延迟，适于重型静态分析与全栈审计     | 零       |

---

## 编排与防重入规约

调度多工具执行时，必须遵守浏览器的状态一致性抽象边界：

- **并发读取准入**：状态无关探针（如 `page_get_local_storage`, `page_get_cookies`, `network_get_requests`）支持安全的大规模并行调用。
- **副作用硬互斥**：DOM 突变（`page_click`, `page_type`）、认证状态转移（例如验证码滑动、SSO 重定向）具备强副作用，并发下发会导致竞争冒险与幽灵触发，必须同步阻塞调用。
- **持久化上下文隔离**：推荐优先使用外部 workflow `workflow.web-api-capture-session.v1`。它会协调 HAR 导出与抓包步骤，断开连接后可通过归档文件做 Context 重建，无需维持 Headless 长连接。

---

## 工作流与智能体委托模型 (Broker & Agents)

对于包含大规模计算复杂度的分析流程，主控节点(Master) 应实施数据面解耦，剥离业务逻辑至子节点 (Sub-agents) 处理。

### 必须由主控保留（时序强依赖）

- Headless CDP 环境存活性与生命周期绑定
- Auth 会话转移机制与防指纹 (Anti-fingerprint) 反制
- CAPTCHA 与验证码挑战应对策略

### 应委托至 Sub-Agent（状态无关型密集运算）

- 巨型 JS Bundle 的分片定位与 AST 反混淆 (Deobfuscation) 工作
- HAR/Pcap 会话的海量噪声清洗与端点参数建模
- 基于 `api_probe_batch` 的全量 OpenAPI 端点黑盒模糊扫描与特征总结
