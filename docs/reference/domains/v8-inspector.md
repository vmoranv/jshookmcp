# V8 检查器

域名：`v8-inspector`

V8 检查器域，提供堆快照分析、CPU 分析和内存检查。

## Profile

- workflow
- full

## 典型场景

- 堆快照分析
- CPU 性能分析
- 内存泄漏检测

## 常见组合

- v8-inspector + browser
- v8-inspector + debugger

## 工具清单（21）

| 工具 | 说明 |
| --- | --- |
| `v8_heap_snapshot_capture` | 捕获 V8 堆快照用于离线分析。快照会持久化到 artifacts/heap-snapshots/（数据 + 附属元数据），可在服务器重启后保留；设 persist=false 则仅保存在内存中。 |
| `v8_heap_snapshot_analyze` | 分析堆快照：类直方图（按构造函数统计对象数量/大小）、统计信息（总对象数、分离的 DOM 节点）、可选的支配树，以及泄漏检测。 |
| `v8_heap_diff` | 比较两个堆快照以发现分配变化。 |
| `v8_object_inspect` | 按 objectId 检查一个存活的 JS 对象，含属性枚举。 |
| `v8_heap_stats` | 报告 V8 堆统计信息：已用、总量、外部内存。 |
| `v8_bytecode_extract` | 按 scriptId 提取脚本的 V8 字节码，带源码回退。 |
| `v8_version_detect` | 检测 V8 引擎版本、标志位和运行时能力。 |
| `v8_heap_find_leaks` | 在堆快照中查找疑似内存泄漏。按置信度排序返回泄漏候选，包括分离的 DOM 节点、大数组、闭包泄漏，以及体量异常大的保留对象。 |
| `v8_heap_retainers` | 从疑似泄漏对象追溯持有者链直到 GC 根。对每个 nodeId 遍历直接支配链，生成一条「是什么让它保持存活」的路径：叶子节点 → ... → GC 根。每一步包含 nodeId、name、className、shallowSize、retainedSize，以及与叶子节点的距离。配合 v8_heap_find_leaks 或 v8_heap_snapshot_analyze 使用，理解某个特定对象为何未被回收。 |
| `v8_deopt_trace` | 追踪采集窗口内的 V8 反优化（deopt）事件。通过 natives 语法启用 %TraceDeoptimizations 并捕获 deopt 事件（函数名、原因、bailout 位置）。需要 V8 natives 语法支持，不可用时优雅降级。 |
| `v8_turbofan_inspect` | 检查脚本中各函数的 TurboFan 编译状态。报告优化层级（interpreted/maglev/turbofan）。支持的 action：inspect（默认）、optimize（%OptimizeFunctionOnNextCall）、deoptimize（%DeoptimizeFunction）。需要 V8 natives 语法支持。 |
| `v8_turbofan_graph` | 采集并可视化 V8 TurboFan IR（sea-of-nodes / Turboshaft 图）。两种模式：（1）提供 JS 源码——启动一个独立 V8 子进程并附加 --trace-turbo 生成 IR JSON，然后解析出节点、边、阶段和操作码直方图；（2）提供 traceDir 路径读取已生成的 turbo-*.json 文件（如浏览器以 --trace-turbo 启动产生的文件）。返回按函数汇总的图摘要，含各阶段的节点/边数量、示例节点和操作码分布。 |
| `v8_function_retained` | 查找所有被匹配指定名称模式的函数持有的堆对象。遍历支配树，找出构造函数/类名匹配给定模式的对象，返回每个对象及其持有者链。适合了解某个特定函数/类保持哪些对象存活。 |
| `v8_object_compare` | 按浅层/保留大小、类名和属性数量比较堆对象。同快照模式（仅 objectIds）做全组合比较（n 选 2）。跨快照模式（anotherSnapshotId + anotherObjectIds）做逐对 A[i]↔B[i] 比较。用于追踪对象随时间的增长、查找内存回归候选，或比较同一类别的泄漏对象与健康对象。 |
| `v8_wasm_inspect` | 检查页面中的 WebAssembly 模块及垃圾回收型 WASM 对象。通过 performance.getEntriesByType 发现 .wasm 脚本资源，检测 WASM GC（struct/array/ref-types）可用性，并枚举特性标志（gc/threads/simd）。支持可选的 scriptId 过滤以检查特定 WASM 模块。需要 browser/page CDP 上下文。注：结构化类型枚举（includeStructs）需要 Chrome ≥ M119 并启用 --enable-features=WebAssemblyGC；否则仅返回 gcAvailable 标志和脚本级摘要。 |
| `v8_heap_sampling` | 通过 CDP HeapProfiler 采集 V8 分配采样剖析。在采集窗口（默认 5 秒）内开始采样，返回汇总的分配调用树：每个函数的自身/总计字节数 + 采样次数，按总分配字节数排序。适合在不做完整堆快照的情况下查找热点分配点。需要 browser/page CDP 上下文。 |
| `v8_allocation_track` | 通过 CDP HeapProfiler 对象跟踪捕获活跃的 V8 分配。在采集窗口（默认 3 秒）内开始分配跟踪，返回窗口期间存活对象及其分配调用栈（顶层帧 + 大小）。适合查找特定交互过程中挺过 GC 的对象。需要 browser/page CDP 上下文，完整调用栈解析需要 V8 natives。 |
| `v8_weakrefs_inspect` | 通过 Runtime.evaluate 枚举页面中的 WeakRef 和 FinalizationRegistry 实例。检查已注册的终结回调和存活的 WeakRef 目标，报告有多少 WeakRef 已解引用/已清除，以及哪些 FinalizationRegistry 回调有待处理条目。适合诊断长生命周期页面的清理逻辑。需要 browser/page CDP 上下文。 |
| `v8_heap_snapshot_list` | 列出 V8 堆快照——包括内存中的（当前会话）和已持久化到 artifacts/heap-snapshots/ 的（可在服务器重启后保留）。报告 id、捕获时间、大小、来源（内存/持久化）、模拟标志和过期状态，以及汇总统计。不返回快照负载本身（仅元数据）。 |
| `v8_heap_snapshot_delete` | 删除已持久化的 V8 堆快照产物文件（.heapsnapshot 数据 + .meta.json 附属文件）并丢弃对应的内存缓存条目。使用 deleteAll=true 可删除所有持久化快照。不影响实时 V8 堆。 |
| `v8_heap_snapshot_export` | 将堆快照导出为完整的 .heapsnapshot JSON 文件，存放在 artifacts/heap-snapshots/ 下，可被 Chrome DevTools Memory 面板加载。返回文件路径；快照内容写入磁盘而非注入响应体（因为可能非常大）。 |
