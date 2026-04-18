# Memory

域名：`memory`

面向原生内存扫描、指针链分析、结构体推断与断点观测的内存分析域。

## Profile

- full

## 典型场景

- 首扫/缩扫定位目标值
- 指针链与结构体分析
- 内存断点与扫描会话管理

## 常见组合

- memory + process
- memory + debugger
- memory + workflow

## 代表工具

- `memory_first_scan` — 开始新的内存扫描会话。扫描整个进程内存中的指定值并返回匹配地址。支持所有数值类型（byte/int8/int16/uint16/int32/uint32/int64/uint64/float/double/pointer）以及十六进制和字符串模式，并创建可供 memory_next_scan 继续缩小范围的会话。
- `memory_next_scan` — 缩小已有扫描会话范围。重新读取上次匹配到的地址，并按比较模式进行过滤。通常接在 memory_first_scan 或 memory_unknown_scan 之后使用，等同于 Cheat Engine 的“Next Scan”。
- `memory_unknown_scan` — 开始未知初始值扫描。先捕获指定类型的全部可读内存地址，再结合 memory_next_scan 的 "changed"、"unchanged"、"increased"、"decreased" 模式逐步缩小范围。等同于 Cheat Engine 的“Unknown initial value”扫描。
- `memory_pointer_scan` — 查找指向目标地址的指针。扫描进程内存中的指针大小值，定位那些直接指向目标地址或落在目标地址附近（±4096 字节，适用于结构体成员访问）的指针。
- `memory_group_scan` — 同时搜索多个已知偏移上的值。适合在你已知结构体相对布局时使用，例如生命值在 +0、法力值在 +4、等级在 +8。
- `memory_scan_list` — 列出所有活动中的扫描会话，显示 PID、值类型、匹配数量、扫描次数和存活时间。
- `memory_scan_delete` — 删除一个扫描会话并释放其占用资源。
- `memory_scan_export` — 将扫描会话导出为 JSON 以便持久化保存，后续可重新导入并恢复扫描流程。
- `memory_pointer_chain_scan` — 执行多级指针链扫描。从模块相对基址出发，查找通向目标地址的稳定指针路径。使用 BFS 发现类似 [game.exe+0x1A3C] → [+0x10] → [+0x08] → target 的链路。静态链（模块相对基址）在进程重启后通常仍然有效。
- `memory_pointer_chain_validate` — 重新逐级解引用指针链并验证其有效性，返回哪些链仍然成立，以及失效链具体断在哪一层。

## 工具清单（41）

| 工具 | 说明 |
| --- | --- |
| `memory_first_scan` | 开始新的内存扫描会话。扫描整个进程内存中的指定值并返回匹配地址。支持所有数值类型（byte/int8/int16/uint16/int32/uint32/int64/uint64/float/double/pointer）以及十六进制和字符串模式，并创建可供 memory_next_scan 继续缩小范围的会话。 |
| `memory_next_scan` | 缩小已有扫描会话范围。重新读取上次匹配到的地址，并按比较模式进行过滤。通常接在 memory_first_scan 或 memory_unknown_scan 之后使用，等同于 Cheat Engine 的“Next Scan”。 |
| `memory_unknown_scan` | 开始未知初始值扫描。先捕获指定类型的全部可读内存地址，再结合 memory_next_scan 的 "changed"、"unchanged"、"increased"、"decreased" 模式逐步缩小范围。等同于 Cheat Engine 的“Unknown initial value”扫描。 |
| `memory_pointer_scan` | 查找指向目标地址的指针。扫描进程内存中的指针大小值，定位那些直接指向目标地址或落在目标地址附近（±4096 字节，适用于结构体成员访问）的指针。 |
| `memory_group_scan` | 同时搜索多个已知偏移上的值。适合在你已知结构体相对布局时使用，例如生命值在 +0、法力值在 +4、等级在 +8。 |
| `memory_scan_list` | 列出所有活动中的扫描会话，显示 PID、值类型、匹配数量、扫描次数和存活时间。 |
| `memory_scan_delete` | 删除一个扫描会话并释放其占用资源。 |
| `memory_scan_export` | 将扫描会话导出为 JSON 以便持久化保存，后续可重新导入并恢复扫描流程。 |
| `memory_pointer_chain_scan` | 执行多级指针链扫描。从模块相对基址出发，查找通向目标地址的稳定指针路径。使用 BFS 发现类似 [game.exe+0x1A3C] → [+0x10] → [+0x08] → target 的链路。静态链（模块相对基址）在进程重启后通常仍然有效。 |
| `memory_pointer_chain_validate` | 重新逐级解引用指针链并验证其有效性，返回哪些链仍然成立，以及失效链具体断在哪一层。 |
| `memory_pointer_chain_resolve` | 逐级解引用一条指针链，并解析出它当前最终指向的目标地址。 |
| `memory_pointer_chain_export` | 将指针链导出为 JSON 以便持久化保存，可在不同会话之间重新导入使用。 |
| `memory_structure_analyze` | 分析某个地址处的内存内容，以推断数据结构布局。使用启发式规则将字段识别为 vtable 指针、普通指针、字符串指针、浮点数、整数、布尔值或填充区。可选解析 RTTI，以获取类名和继承链（MSVC x64）。 |
| `memory_vtable_parse` | 解析 vtable，枚举其中的虚函数指针并解析为模块名 + 偏移。同时尝试解析 RTTI，以恢复类名和继承层级。 |
| `memory_structure_export_c` | 将推断出的结构体导出为 C 风格的 struct 定义，并附带偏移注释和类型标注。 |
| `memory_structure_compare` | 比较两个结构体实例，找出哪些字段会变化（如生命值、坐标等动态值），哪些字段保持不变（如 vtable、类型标志等），便于定位关键字段。 |
| `memory_breakpoint_set` | 使用 x64 调试寄存器（DR0-DR3）设置硬件断点。最多支持 4 个并发断点，可监视 read、write、readwrite、execute 四类访问。 |
| `memory_breakpoint_remove` | 按 ID 移除一个硬件断点，并释放对应的调试寄存器槽位。 |
| `memory_breakpoint_list` | 列出所有活动中的硬件断点及其命中次数。 |
| `memory_breakpoint_trace` | 跟踪某个地址的访问行为：设置一个临时断点，收集 N 次命中后自动移除。可回答“谁在读/写这个地址？”并返回每次访问对应的指令地址和寄存器状态。 |
| `memory_patch_bytes` | 向目标进程的指定地址写入字节序列。会保存原始字节，便于后续撤销。适用于运行时代码补丁。 |
| `memory_patch_nop` | 将指定地址处的指令改写为 NOP（0x90）。常用于禁用检查逻辑或跳转指令。 |
| `memory_patch_undo` | 撤销之前的补丁，并恢复原始字节内容。 |
| `memory_code_caves` | 在已加载模块的可执行节中查找 code cave（连续的 0x00 或 0xCC 区段），并按大小优先返回。 |
| `memory_write_value` | 向指定内存地址写入一个带类型的值，并支持通过 memory_write_undo 进行撤销。 |
| `memory_freeze` | 将某个地址冻结为固定值。工具会按设定间隔持续回写该值，防止它被其他逻辑修改。 |
| `memory_unfreeze` | 停止冻结一个之前已经冻结的地址。 |
| `memory_dump` | 以十六进制 + ASCII 列的形式导出一段内存区域，输出风格类似 xxd 的格式化十六进制转储。 |
| `memory_speedhack_apply` | 对目标进程应用 speedhack。通过 Hook 时间相关 API（GetTickCount64、QueryPerformanceCounter）来缩放时间流逝速度。speed=2.0 表示两倍速，0.5 表示半速。 |
| `memory_speedhack_set` | 在不重新 Hook 的情况下，调整当前 speedhack 的速度倍率。 |
| `memory_write_undo` | 撤销最近一次内存写入操作，并恢复之前的值。 |
| `memory_write_redo` | 重做最近一次被撤销的内存写入操作。 |
| `memory_heap_enumerate` | 通过 Toolhelp32 快照枚举目标进程中的所有堆和堆块，返回堆列表、块数量、块大小以及整体统计信息。 |
| `memory_heap_stats` | 获取详细的堆统计信息，包括大小分布桶（0-64B、64B-1KB、1-64KB、64KB-1MB、&gt;1MB）、碎片率和各类汇总指标。 |
| `memory_heap_anomalies` | 检测堆异常，包括堆喷射模式（大量同尺寸块）、可能的 use-after-free（已释放块中仍存在非零数据），以及可疑块尺寸（0 或大于 100MB）。 |
| `memory_pe_headers` | 从进程内存中的模块基址解析 PE 头（DOS、NT、File、Optional），返回机器类型、入口点、镜像基址、节区数量以及数据目录信息。 |
| `memory_pe_imports_exports` | 从进程内存中的 PE 模块解析导入表和/或导出表，返回 DLL 名称、函数名、序号、hint 以及 forwarded export 等信息。 |
| `memory_inline_hook_detect` | 通过比较磁盘文件与内存中每个导出函数的前 16 个字节来检测 inline hook。可识别 JMP rel32、JMP abs64、PUSH+RET 等 hook 形式，并解析跳转目标。 |
| `memory_anticheat_detect` | 扫描进程导入项中的反调试/反作弊机制，例如 IsDebuggerPresent、NtQueryInformationProcess、计时检测（QPC、GetTickCount）、线程隐藏、堆标志检查以及 DR 寄存器检测。每项发现都会附带绕过建议。 |
| `memory_guard_pages` | 查找进程中所有带有 PAGE_GUARD 保护属性的内存区域。Guard page 常用于防篡改机制或栈溢出检测。 |
| `memory_integrity_check` | 通过比较磁盘字节与内存字节的 SHA-256 哈希，检查代码节完整性。可用于发现补丁、Hook 以及其他对可执行节的运行时修改。 |
