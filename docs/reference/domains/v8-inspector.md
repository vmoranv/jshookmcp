# V8 Inspector

域名：`v8-inspector`

V8 检查器域，提供堆快照分析、CPU 分析和内存检查。

## Profile

- full

## 典型场景

- 堆快照分析
- CPU 性能分析
- 内存泄漏检测

## 常见组合

- v8-inspector + browser
- v8-inspector + debugger

## 代表工具

- `v8_heap_snapshot_capture` — 从活跃浏览器目标捕获 V8 堆快照。
- `v8_heap_snapshot_analyze` — 分析先前捕获的 V8 堆快照。
- `v8_heap_diff` — 对比两个已捕获的 V8 堆快照。
- `v8_object_inspect` — 按地址检查 V8 堆对象。
- `v8_heap_stats` — 返回 V8 堆快照统计。
- `v8_bytecode_extract` — 提取函数的 V8 Ignition 字节码。
- `v8_version_detect` — 检测 V8 引擎版本和功能支持。
- `v8_jit_inspect` — 检查函数的 JIT 编译代码。

## 工具清单（8）

| 工具 | 说明 |
| --- | --- |
| `v8_heap_snapshot_capture` | 从活跃浏览器目标捕获 V8 堆快照。 |
| `v8_heap_snapshot_analyze` | 分析先前捕获的 V8 堆快照。 |
| `v8_heap_diff` | 对比两个已捕获的 V8 堆快照。 |
| `v8_object_inspect` | 按地址检查 V8 堆对象。 |
| `v8_heap_stats` | 返回 V8 堆快照统计。 |
| `v8_bytecode_extract` | 提取函数的 V8 Ignition 字节码。 |
| `v8_version_detect` | 检测 V8 引擎版本和功能支持。 |
| `v8_jit_inspect` | 检查函数的 JIT 编译代码。 |
