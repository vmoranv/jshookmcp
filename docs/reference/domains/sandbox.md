# Sandbox

域名：`sandbox`

基于 QuickJS WASM 的安全沙箱域，支持执行自定义脚本并调用 MCP 工具。

## Profile

- full

## 典型场景

- 安全脚本执行
- 自定义分析逻辑
- 隔离环境中的代码测试

## 常见组合

- sandbox + core + transform

## 代表工具

- `execute_sandbox_script` — 在隔离沙箱中安全执行自定义 JavaScript 脚本。

## 工具清单（1）

| 工具 | 说明 |
| --- | --- |
| `execute_sandbox_script` | 在隔离沙箱中安全执行自定义 JavaScript 脚本。 |
