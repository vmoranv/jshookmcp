# 原生桥接

域名：`native-bridge`

原生分析工具桥接域，通过本地 loopback HTTP bridge 对接 Ghidra、IDA、Rizin/r2 与 Binary Ninja，用于函数枚举、反编译/反汇编、字符串搜索、交叉引用与符号同步。

## Profile

- full

## 典型场景

- 检查本地反汇编器 bridge 健康状态
- 打开二进制并枚举函数/段/字符串
- 通过 Ghidra/IDA/Binary Ninja 反编译函数
- 通过 Rizin/r2 执行分析命令
- 在多后端之间同步原生符号

## 常见组合

- native-bridge + binary-instrument
- native-bridge + process

## 工具清单（6）

| 工具 | 说明 |
| --- | --- |
| `native_bridge_status` | 检查本地原生分析 bridge 后端的健康状态与能力列表。 |
| `ghidra_bridge` | 向 Ghidra headless 分析 bridge 发送命令。 |
| `ida_bridge` | 向 IDA Pro 插件 bridge 发送命令。 |
| `rizin_bridge` | 向本地 Rizin/r2 分析 bridge 发送命令。 |
| `binary_ninja_bridge` | 向本地 Binary Ninja 分析 bridge 发送命令。 |
| `native_symbol_sync` | 从已连接的原生分析后端导出并同步符号。 |
