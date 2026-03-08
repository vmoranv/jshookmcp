# 快速开始

## 目标

让你在几分钟内完成：

- 安装依赖
- 启动服务
- 跑通一次最小采集流程
- 知道下一步该走 built-in、workflow 还是 plugin

## 环境要求

- Node.js `>=20`
- `pnpm`

## 安装与构建

```bash
pnpm install
pnpm run build
```

如果你要 Camoufox：

```bash
pnpm run install:full
```

## 环境诊断

建议第一次先跑：

```bash
pnpm run doctor
```

它会检查：

- 可选包是否安装
- wabt / binaryen / jadx 等外部命令是否可用
- Ghidra / IDA / Burp 本地桥是否在线
- 当前 retention 与安全相关配置

## 启动服务

```bash
pnpm start
```

## 第一次最小成功路径

推荐先走复合工具，而不是手动拼十几个页面/网络工具：

1. `web_api_capture_session`
2. 查看 `artifacts/har/` 与 `artifacts/reports/`
3. 用 `network_extract_auth` 看认证线索

## 什么时候切到 workflow

当你发现自己在重复做这类步骤时：

- 先开网络监控
- 导航页面
- 做几次点击/输入
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
