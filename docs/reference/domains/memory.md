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
- `memory_scan_session` — 管理扫描会话。操作：list（列出全部）、delete（删除指定会话）、export（导出为 JSON）。
- `memory_pointer_chain` — 多级指针链操作：扫描、验证、解析和导出指针链。
- `memory_structure_analyze` — 分析某个地址处的内存内容，以推断数据结构布局。使用启发式规则将字段识别为 vtable 指针、普通指针、字符串指针、浮点数、整数、布尔值或填充区。可选解析 RTTI，以获取类名和继承链（MSVC x64）。
- `memory_vtable_parse` — 解析 vtable，枚举其中的虚函数指针并解析为模块名 + 偏移。同时尝试解析 RTTI，以恢复类名和继承层级。
- `memory_structure_export_c` — 将推断出的结构体导出为 C 风格的 struct 定义，并附带偏移注释和类型标注。

## 工具清单（30）

| 工具 | 说明 |
| --- | --- |
| `memory_first_scan` | 开始新的内存扫描会话。扫描整个进程内存中的指定值并返回匹配地址。支持所有数值类型（byte/int8/int16/uint16/int32/uint32/int64/uint64/float/double/pointer）以及十六进制和字符串模式，并创建可供 memory_next_scan 继续缩小范围的会话。 |
| `memory_next_scan` | 缩小已有扫描会话范围。重新读取上次匹配到的地址，并按比较模式进行过滤。通常接在 memory_first_scan 或 memory_unknown_scan 之后使用，等同于 Cheat Engine 的“Next Scan”。 |
| `memory_unknown_scan` | 开始未知初始值扫描。先捕获指定类型的全部可读内存地址，再结合 memory_next_scan 的 "changed"、"unchanged"、"increased"、"decreased" 模式逐步缩小范围。等同于 Cheat Engine 的“Unknown initial value”扫描。 |
| `memory_pointer_scan` | 查找指向目标地址的指针。扫描进程内存中的指针大小值，定位那些直接指向目标地址或落在目标地址附近（±4096 字节，适用于结构体成员访问）的指针。 |
| `memory_group_scan` | 同时搜索多个已知偏移上的值。适合在你已知结构体相对布局时使用，例如生命值在 +0、法力值在 +4、等级在 +8。 |
| `memory_scan_session` | 管理扫描会话。操作：list（列出全部）、delete（删除指定会话）、export（导出为 JSON）。 |
| `memory_pointer_chain` | 多级指针链操作：扫描、验证、解析和导出指针链。 |
| `memory_structure_analyze` | 分析某个地址处的内存内容，以推断数据结构布局。使用启发式规则将字段识别为 vtable 指针、普通指针、字符串指针、浮点数、整数、布尔值或填充区。可选解析 RTTI，以获取类名和继承链（MSVC x64）。 |
| `memory_vtable_parse` | 解析 vtable，枚举其中的虚函数指针并解析为模块名 + 偏移。同时尝试解析 RTTI，以恢复类名和继承层级。 |
| `memory_structure_export_c` | 将推断出的结构体导出为 C 风格的 struct 定义，并附带偏移注释和类型标注。 |
| `memory_structure_compare` | 比较两个结构体实例，找出哪些字段会变化（如生命值、坐标等动态值），哪些字段保持不变（如 vtable、类型标志等），便于定位关键字段。 |
| `memory_breakpoint` | 使用 x64 调试寄存器（DR0-DR3）的硬件断点操作，最多支持 4 个并发断点。 |
| `memory_patch_bytes` | 向目标进程的指定地址写入字节序列。会保存原始字节，便于后续撤销。适用于运行时代码补丁。 |
| `memory_patch_nop` | 将指定地址处的指令改写为 NOP（0x90）。常用于禁用检查逻辑或跳转指令。 |
| `memory_patch_undo` | 撤销之前的补丁，并恢复原始字节内容。 |
| `memory_code_caves` | 在已加载模块的可执行节中查找 code cave（连续的 0x00 或 0xCC 区段），并按大小优先返回。 |
| `memory_write_value` | 向指定内存地址写入一个带类型的值，并支持通过 memory_write_undo 进行撤销。 |
| `memory_freeze` | 将某个地址冻结为固定值。工具会按设定间隔持续回写该值，防止它被其他逻辑修改。 |
| `memory_dump` | 以十六进制 + ASCII 列的形式导出一段内存区域，输出风格类似 xxd 的格式化十六进制转储。 |
| `memory_speedhack` | 变速器：Hook 时间 API 以缩放进程时间流速。speed=2.0 为两倍速，0.5 为半速。 |
| `memory_write_history` | 撤销或重做最近一次内存写入操作。 |
| `memory_heap_enumerate` | 通过 Toolhelp32 快照枚举目标进程中的所有堆和堆块，返回堆列表、块数量、块大小以及整体统计信息。 |
| `memory_heap_stats` | 获取详细的堆统计信息，包括大小分布桶（0-64B、64B-1KB、1-64KB、64KB-1MB、&gt;1MB）、碎片率和各类汇总指标。 |
| `memory_heap_anomalies` | 检测堆异常，包括堆喷射模式（大量同尺寸块）、可能的 use-after-free（已释放块中仍存在非零数据），以及可疑块尺寸（0 或大于 100MB）。 |
| `memory_pe_headers` | 从进程内存中的模块基址解析 PE 头（DOS、NT、File、Optional），返回机器类型、入口点、镜像基址、节区数量以及数据目录信息。 |
| `memory_pe_imports_exports` | 从进程内存中的 PE 模块解析导入表和/或导出表，返回 DLL 名称、函数名、序号、hint 以及 forwarded export 等信息。 |
| `memory_inline_hook_detect` | 通过比较磁盘文件与内存中每个导出函数的前 16 个字节来检测 inline hook。可识别 JMP rel32、JMP abs64、PUSH+RET 等 hook 形式，并解析跳转目标。 |
| `memory_anticheat_detect` | 扫描进程导入项中的反调试/反作弊机制，例如 IsDebuggerPresent、NtQueryInformationProcess、计时检测（QPC、GetTickCount）、线程隐藏、堆标志检查以及 DR 寄存器检测。每项发现都会附带绕过建议。 |
| `memory_guard_pages` | 查找进程中所有带有 PAGE_GUARD 保护属性的内存区域。Guard page 常用于防篡改机制或栈溢出检测。 |
| `memory_integrity_check` | 通过比较磁盘字节与内存字节的 SHA-256 哈希，检查代码节完整性。可用于发现补丁、Hook 以及其他对可执行节的运行时修改。 |
