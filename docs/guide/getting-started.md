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
npx @jshookmcp/jshook
```

这是普通使用者的推荐方式。

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

- Node.js `>=20`
- `npm` / `npx`

### 从源码开发

- Node.js `>=20`
- `pnpm`

更多 `.env` 与运行时配置，请看：[`.env` 与配置](/guide/configuration)

## 环境诊断

建议第一次先跑：

```bash
pnpm run doctor
```

如果你是通过 `npx` 或全局安装使用，也可以在源码仓或本地开发环境里跑这条命令来检查：

- 可选包是否安装
- wabt / binaryen / jadx 等外部命令是否可用
- Ghidra / IDA / Burp 本地桥是否在线
- 当前 retention 与安全相关配置

## 第一次最小成功路径

推荐先走复合工具，而不是手动拼十几个页面/网络工具：

1. `web_api_capture_session`
2. 查看 `artifacts/har/` 与 `artifacts/reports/`
3. 用 `network_extract_auth` 看认证线索

## 什么时候切到 workflow

当你发现自己在重复做这类步骤时：

- 先开网络监控
- 导航页面
- 做几次点击 / 输入
- 抓请求
- 提取 auth

这时候就该把它固化成 workflow。

## 什么时候切到 plugin

当你需要：

- 新的工具名
- 对接外部桥接系统
- 明确声明 `toolExecution` 权限
- 复用 built-in tools 但对外暴露自己的高层能力

就应该做 plugin，而不是继续堆 workflow。
