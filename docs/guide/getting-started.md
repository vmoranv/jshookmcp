# 快速开始

专为首次安装并配置 `jshookmcp` 的用户准备的极简指南。

## 1. 安装 Node.js

确保已安装 **Node.js 20.19+** 或 **22.12+**。

## 2. 修改 MCP 客户端配置

在你的 MCP 客户端（如 Claude Desktop 或 Cursor）配置中插入以下内容：

```json
{
  "mcpServers": {
    "jshook": {
      "command": "npx",
      "args": ["-y", "@jshookmcp/jshook"]
    }
  }
}
```

::: warning 注意
`args` 里的 `-y` 必须保留，否则会自动安装阻塞导致客户端超时挂起。
:::

## 3. 重启并验证

重启客户端，确认 `jshook` 工具已加载。发送测试语：

> "请使用 jshook 的 `page_navigate` 访问 `https://example.com`，告诉我网页标题"

恭喜！配置完成。

---

如果需要调整持久化缓存、修改系统行为，请继续阅读 [配置指南](/guide/configuration)。
