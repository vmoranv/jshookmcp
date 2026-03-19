# 快速开始

## 目标

让你在几分钟内完成：

- 用最短路径运行 `jshook`
- 跑通一次最小采集流程
- 知道下一步该走 built-in、workflow 还是 plugin

## 先分清两条路径

### 路径 A：你只是想使用主程序

这是默认推荐路径，**不需要 clone 仓库，也不需要先本地 build**。

### 路径 B：你要开发源码或扩展

只有在下面这些场景，才需要 clone 仓库或模板仓并执行 `pnpm install / build`：

- 你要调试 `jshookmcp` 源码
- 你要开发自己的 plugin
- 你要开发自己的 workflow

## 推荐安装方式

### 直接用 npx 运行主程序

```bash
npx -y @jshookmcp/jshook
```

## 常见启动故障排查

### 0. 运行后没有界面？

`jshook` 是 **stdio MCP server**，不是 GUI 程序。终端里运行后没有窗口弹出是正常的 — 它会占住当前终端，等待 MCP 客户端通过 stdin/stdout 握手。

### 1. npx 遗漏 `-y` 参数

`npx` 启动时必须加 `-y`，否则首次安装确认会阻塞 MCP 客户端。典型症状：

- 握手超时
- `initialize response` 失败
- MCP client startup failed

## MCP 客户端配置示例

### Codex / Claude Code

把 `stdio` MCP 配置写成这样：

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

## 可选方式

### 全局安装

```bash
npm install -g @jshookmcp/jshook
```

### 从源码运行（开发者场景）

```bash
pnpm install
pnpm run build
pnpm run doctor
pnpm start
```

### 从源码运行（含 Camoufox）

```bash
pnpm run install:full
pnpm run build
pnpm start
```

## 环境要求

### 普通使用主程序

- Node.js `>=22`
- `npm` / `npx`

### 从源码开发

- Node.js `>=22`
- `pnpm`

更多 `.env` 与运行时配置，请看：[`.env` 与配置](/guide/configuration)

## 环境诊断

从源码开发时建议先跑：

```bash
pnpm run doctor
```

检查项：可选包安装、wabt / binaryen / jadx 等外部命令、Ghidra / IDA / Burp 本地桥、retention 与安全配置。

通过 `npx` 或全局安装的用户也可在源码仓中运行此命令诊断环境。

## 第一次最小成功路径

建议优先使用复合工具，而非手动拼接多个独立的页面/网络工具：

1. `web_api_capture_session`
2. 查看 `artifacts/har/` 与 `artifacts/reports/`
3. 用 `network_extract_auth` 看认证线索

## 何时选用工作流 (Workflow)

当你在频繁重复以下步骤序列时：

- 先开网络监控
- 导航页面
- 做几次点击 / 输入
- 抓请求
- 提取 auth

这是将其固化为 Workflow 的标准场景。

## 何时选用插件 (Plugin)

当你需要：

- 新的工具名
- 对接外部桥接系统
- 明确声明 `toolExecution` 权限
- 复用 built-in tools 但对外暴露自己的高层能力

就应该做 plugin，而不是继续堆 workflow。
