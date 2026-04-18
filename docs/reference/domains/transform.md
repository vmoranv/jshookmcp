# Transform

域名：`transform`

AST/字符串变换与加密实现抽取、测试、对比域。

## Profile

- full

## 典型场景

- 变换预览
- 加密函数抽取
- 实现差异比对

## 常见组合

- core + transform

## 代表工具

- `ast_transform_preview` — 预览轻量级 AST 风格转换，并返回前后差异。
- `ast_transform_chain` — 创建并保存内存中的转换链。
- `ast_transform_apply` — 将转换规则应用到输入代码或页面脚本。
- `crypto_extract_standalone` — 提取当前页面中的加密、签名或加密函数并生成可独立运行代码。
- `crypto_test_harness` — 在 worker_threads 与 vm 沙箱中运行提取出的加密代码并返回确定性测试结果。
- `crypto_compare` — 基于相同测试向量对比两套加密实现。

## 工具清单（6）

| 工具 | 说明 |
| --- | --- |
| `ast_transform_preview` | 预览轻量级 AST 风格转换，并返回前后差异。 |
| `ast_transform_chain` | 创建并保存内存中的转换链。 |
| `ast_transform_apply` | 将转换规则应用到输入代码或页面脚本。 |
| `crypto_extract_standalone` | 提取当前页面中的加密、签名或加密函数并生成可独立运行代码。 |
| `crypto_test_harness` | 在 worker_threads 与 vm 沙箱中运行提取出的加密代码并返回确定性测试结果。 |
| `crypto_compare` | 基于相同测试向量对比两套加密实现。 |
