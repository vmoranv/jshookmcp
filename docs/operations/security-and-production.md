# 安全与生产建议

## 插件安全默认值

当前实现里：

- 在 `production` 环境下，插件签名校验默认视为开启
- 严格加载会要求 `MCP_PLUGIN_ALLOWED_DIGESTS`
- digest allowlist 仍然是 **导入前** 的关键边界

## 推荐生产配置

```bash
MCP_PLUGIN_SIGNATURE_REQUIRED=true
MCP_PLUGIN_STRICT_LOAD=true
MCP_PLUGIN_ALLOWED_DIGESTS=<sha256-hex-list>
MCP_PLUGIN_SIGNATURE_SECRET=<shared-secret>
```

## 平台限制

- Windows：最适合进程/内存类能力
- Linux/macOS：优先使用浏览器 Hook、网络捕获、workflow、bridge 模式分析

## 外部桥建议

在依赖这些桥之前，先确认：

- `ghidra-bridge`
- `ida-bridge`
- `burp-mcp-sse`

可以直接用：

- `pnpm run doctor`
- `doctor_environment`

## Camoufox 建议

如果缺少 Camoufox 包或二进制，当前会返回更明确的先决条件错误，优先执行：

```bash
pnpm run install:full
```

或：

```bash
pnpm exec camoufox-js fetch
```
