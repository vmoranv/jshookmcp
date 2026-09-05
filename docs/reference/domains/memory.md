# 内存

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

## 工具清单（74）

| 工具 | 说明 |
| --- | --- |
| `memory_first_scan` | 启动新的内存扫描会话。在目标进程的可读写内存区域中搜索指定值。支持 13 种数据类型、可选浮点容差（tolerance）和区域过滤（可读写/可执行/仅模块）。跨平台。 |
| `memory_next_scan` | 在现有扫描会话基础上缩小范围。新增 4 种比较模式：changed_by（变化量等于 delta）、increased_by（增加至少 delta）、decreased_by（减少至少 delta）、changed_by_variable（记录每地址的实际变化量）。支持浮点容差和精确值/范围过滤。跨平台。 |
| `memory_unknown_scan` | 开始未知初始值扫描。先捕获指定类型的全部可读内存地址，再结合 memory_next_scan 的 "changed"、"unchanged"、"increased"、"decreased" 模式逐步缩小范围。等同于 Cheat Engine 的“Unknown initial value”扫描。 |
| `memory_pointer_scan` | 查找指向目标地址的指针。扫描进程内存中的指针大小值，定位那些直接指向目标地址或落在目标地址附近（±4096 字节，适用于结构体成员访问）的指针。 |
| `memory_group_scan` | 同时搜索多个已知偏移上的值。适合在你已知结构体相对布局时使用，例如生命值在 +0、法力值在 +4、等级在 +8。 |
| `memory_scan_session` | 管理扫描会话。操作：list（列出全部）、delete（删除指定会话）、export（导出为 JSON）。 |
| `memory_search_string` | 在进程内存中搜索匹配模式的字符串。封装 memory_first_scan(valueType=string) 并附加子串/正则/UTF-16LE 后过滤。跨平台。 |
| `memory_pointer_chain` | 多级指针链操作：扫描、验证、解析和导出指针链。 |
| `memory_structure_analyze` | 分析某个地址处的内存内容，以推断数据结构布局。使用启发式规则将字段识别为 vtable 指针、普通指针、字符串指针、浮点数、整数、布尔值或填充区。可选解析 RTTI，以获取类名和继承链（MSVC x64）。 |
| `memory_vtable_parse` | 解析 vtable，枚举其中的虚函数指针并解析为模块名 + 偏移。同时尝试解析 RTTI，以恢复类名和继承层级。 |
| `memory_structure_export_c` | 将推断出的结构体导出为 C 风格 struct 定义或 ReClass.NET XML 项目文件（format='reclass'），并附带偏移注释和类型标注。ReClass 格式与 ReClass.NET 兼容，可直接导入进行可视化结构分析。 |
| `memory_structure_compare` | 比较两个结构体实例，找出哪些字段会变化（如生命值、坐标等动态值），哪些字段保持不变（如 vtable、类型标志等），便于定位关键字段。 |
| `memory_breakpoint` | 使用 x64 调试寄存器（DR0-DR3）的硬件断点操作或 INT3（0xCC）软件断点。硬件断点最多 4 个并发，支持按访问类型（读/写/读写/执行）和观察大小（1/2/4/8 字节）过滤。软件断点无数量限制，在执行前自动读回原始字节检测自修改代码，线程安全。可选条件表达式（JavaScript 语法，如 'rax === 0x1234n'），条件为 false 时自动跳过命中。操作：set、remove、list、trace。 |
| `memory_patch_bytes` | 向目标进程的指定地址写入字节序列。会保存原始字节，便于后续撤销。适用于运行时代码补丁。 |
| `memory_patch_nop` | 将指定地址处的指令改写为 NOP（0x90）。常用于禁用检查逻辑或跳转指令。 |
| `memory_patch_undo` | 撤销之前的补丁，并恢复原始字节内容。 |
| `memory_code_caves` | 在已加载模块的可执行节中查找 code cave（连续的 0x00 或 0xCC 区段），并按大小优先返回。 |
| `memory_allocate` | 在目标进程中分配可执行内存（VirtualAllocEx 封装）。返回分配的基址和大小。需要 JSHOOK_INJECTION_ENABLE=1。仅 Win32。 |
| `memory_free` | 释放通过 memory_allocate 分配的目标进程内存（VirtualFreeEx 封装）。仅 Win32。 |
| `memory_inject_shellcode` | 注入并执行原始 shellcode。createremote（CreateRemoteThread）、ntcreatethread（NtCreateThreadEx 隐匿模式）、threadhijack（劫持现有线程）。需要 JSHOOK_INJECTION_ENABLE=1。仅 Win32。 |
| `memory_inject_dll` | 向目标进程注入 DLL。loadlibrary（Classic LoadLibraryA）、manualmap（手动映射——PE 解析+导入解析+重定位）。manualmap 支持擦除 PE 头。需要 JSHOOK_INJECTION_ENABLE=1。仅 Win32。 |
| `memory_write_value` | 向指定内存地址写入一个带类型的值，并支持通过 memory_write_history 的 undo/redo 动作进行撤销与重做。 |
| `memory_batch_edit` | 批量修改扫描会话中的所有地址。取 sessionId + valueType + value，逐地址写入。上限 1000 地址。破坏性操作，含审计轨迹。 |
| `memory_watch` | 监控内存地址值的变化。按间隔轮询读取（默认 500ms），值变化时返回新旧值。scanmem watch 命令的等价物。最大 120 秒。 |
| `memory_freeze` | 将某个地址冻结为固定值。工具会按设定间隔持续回写该值，防止它被其他逻辑修改。 |
| `memory_dump` | 以十六进制 + ASCII 列的形式导出一段内存区域，输出风格类似 xxd 的格式化十六进制转储。 |
| `memory_speedhack` | 通过进程内 SSE2 蹦床挂钩时间 API 来缩放进程时间。操作包括：apply（挂钩并设置速度）、set（调整速度无需重新挂钩）、restore（取消挂钩并恢复原始函数）。速度范围 0.01–100 倍。共挂钩 6 个 API：GetTickCount64、GetTickCount、QueryPerformanceCounter、QueryPerformanceFrequency（速度=0 时除零保护→1.0）、timeGetTime（winmm.dll）、GetSystemTimeAsFileTime。三区 W^X 分配架构（代码/蹦床/数据分离，从不同时可写可执行）。仅 Win32。 |
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
| `memory_region_enumerate` | 枚举目标进程的内存区域。跨平台：Windows（VirtualQueryEx）、macOS（mach_vm_region）、Linux（/proc/pid/maps）。返回基址、大小、保护属性（r/w/x/rw/rx/rwx）、状态、类型（image/mapped/private）和模块名（如有模块背书）。 |
| `memory_aob_scan` | 支持通配符的字节阵列扫描（AOB scan）。在可读内存中搜索如 "48 8B ?? ?? 00 00" 的字节模式。接受十六进制字节（00-FF，可选 0x 前缀）和 "??" 通配符，大小写不敏感。可选 executableOnly=true 仅扫描可执行内存页面（CE 7.6 AOBSCANEX）。 |
| `memory_find_accesses` | 查找写入或访问某内存地址的指令（Cheat Engine MWT 工作流）。在目标地址设置硬件断点，每次命中后自动重装，捕获触发故障的指令地址、上下文和时间戳，可选择反汇编该指令。返回聚合的命中记录及每条命中的指令详情。 |
| `memory_cheat_table` | 导入/导出 Cheat Engine .CT 文件。支持地址条目、类型映射、模块相对地址格式、签名和验签。不含 Auto Assembler 脚本执行。 |
| `memory_generate_signature` | 从内存地址生成更新安全的 AOB 特征码。自动将相对偏移（CALL/JMP/Jcc/LEA 操作数）替换为 ?? 通配符。7 种 x64 指令模式。 |
| `memory_rtti_info` | 独立 MSVC RTTI 类名解析。读取对象 vtable → Complete Object Locator → TypeDescriptor → 类名 + 基类数组。比完整结构分析更轻量。 |
| `memory_parse_dump` | 解析 Windows Minidump（.dmp）文件并提取取证信息：已加载模块（基址/大小/名称/时间戳）、线程（ID/栈/上下文）、内存范围（64 位或 32 位）、系统信息（OS/CPU）和异常记录。可选解析地址列表对照 dump 内容。纯 TS 实现——跨平台（可在 Linux/macOS 上分析 Windows dump）。 |
| `memory_mono_detect` | 检测目标进程的 Mono/IL2CPP 运行时。返回运行时类型、根域指针和模块基址。Unity 游戏逆向第一步。仅 Win32。 |
| `memory_mono_assemblies` | 列出目标进程中的 Mono 程序集。返回程序集名称、镜像基址、类数量。可选按名称筛选。仅 Win32。 |
| `memory_mono_classes` | 列出指定 Mono 程序集中的类。返回类名、命名空间、字段数、方法数。可选按命名空间筛选。仅 Win32。 |
| `memory_mono_objects` | 扫描 Mono 托管堆中匹配类名的活跃对象。返回对象地址、类名和 vtable。用于定位 GameObject/组件实例。仅 Win32。 |
| `memory_mono_fields` | 读取指定地址 Mono 对象的字段值。自动解码值类型（int/float/bool）和引用类型（字符串/嵌套对象）。仅 Win32。 |
| `memory_mono_methods` | 列出指定 Mono 类的方法。返回方法计数和类型元数据。仅 Win32。 |
| `memory_handle_enum` | 通过 NtQuerySystemInformation 枚举目标进程的系统句柄。按类型过滤（文件/进程/线程/令牌等）。需要管理员权限。仅 Win32。 |
| `memory_protect` | 修改目标进程内存页的保护属性。支持 r/rw/rx/rwx/none。封装 VirtualProtectEx/mprotect/mach_vm_protect。破坏性操作。跨平台。 |
| `memory_region_compare` | 逐字节对比两个内存区域。返回是否一致、差异数量和每个差异的偏移量+字节值。上限 64KB。跨平台。 |
| `memory_bookmark` | 管理进程地址书签。add/remove/list/export/clear。支持标签和颜色分类（十六进制 #RRGGBB）。按 PID 划分作用域。 |
| `memory_type_define` | 覆盖推断结构体中的字段类型。set（定义偏移+大小的类型）、list（列出全部覆盖）、clear（清除全部覆盖）。覆盖应用于后续 memory_structure_analyze 调用。 |
| `memory_emulator_detect` | 检测目标进程是否为已知模拟器（PCSX2/Dolphin/RPCS3/Yuzu/Cemu/ePSXe/PPSSPP/xemu）。扫描进程名和模块指纹。返回模拟器名、平台和内存布局。 |
| `memory_register_type` | 注册自定义内存扫描值类型（CE 兼容）。注册后可在所有扫描工具中用作 valueType。会话作用域。 |
| `memory_list_types` | 列出所有已注册的自定义扫描类型。返回名称、字节大小、编码和字节序。 |
| `memory_unregister_type` | 移除之前注册的自定义扫描值类型。 |
| `memory_call_stack` | 遍历目标进程线程的 x64 RBP 调用栈。使用 Toolhelp32 + ReadProcessMemory，返回帧号、返回地址、模块名。仅 Win32。 |
| `memory_process_control` | 暂停/恢复目标进程。suspend 冻结全部线程（Win32: NtSuspendProcess, Linux: SIGSTOP, macOS: task_suspend），resume 恢复。用于抓取一致的内存快照。跨平台。 |
| `memory_find_references` | x64dbg 风格交叉引用引擎。扫描可执行内存中指向目标地址的 CALL/JMP/LEA/MOV/条件跳转。使用字节模式启发式检测（E8/E9/0F8x/48 8D/48 8B）。跨平台。 |
| `memory_reverse_mwt` | 逆向内存访问追踪——给定代码地址，找出该指令访问的数据地址。使用 Capstone 反汇编并解析 RIP 相对/绝对内存操作数。memory_find_accesses 的逆操作。 |
| `memory_trace_code` | Ultimap 风格 INT3 代码路径追踪。在函数入口设置 INT3（push rbp 启发式），自动重装，聚合命中计数。最大 30 秒/10000 次命中。仅 Win32。 |
| `memory_pointer_map` | 保存/加载/比对指针映射。save 将指针链结果序列化为 .ptr.json，load 反序列化，compare 交叉比对 2 份以上映射，保留所有映射中都存在的链。 |
| `memory_assemble` | 将汇编指令转为机器码。支持 Keystone 引擎（keystone.dll）和内置回退（NOP/RET/INT3/PUSH/POP/MOV/XOR/ADD/SUB/INC/DEC）。assemble_at 直接写入目标进程。需要 JSHOOK_INJECTION_ENABLE=1。仅 Win32。 |
| `memory_auto_assemble` | 执行 Cheat Engine 风格 Auto Assembler 脚本的 [ENABLE] 段。支持 ALLOC/DEALLOC/LABEL/REGISTERSYMBOL/AOBSCAN/ASSERT/CREATETHREAD/DEFINE/FULLACCESS/READMEM/WRITEMEM。INCLUDE 和 LOADBINARY 被拒绝。返回 disableScript 供后续禁用。仅 Win32。 |
| `memory_auto_assemble_disable` | 执行 Auto Assembler 脚本的 [DISABLE] 段。DEALLOC 最后执行（CE 约定）。仅 Win32。 |
| `memory_remote` | 连接/断开远程 jshookmcp 实例。connect 建立 WebSocket 连接，forward 转发工具调用，disconnect 断开。支持认证令牌和指数退避重连。 |
| `memory_hypervisor` | 管理 VT-x/EPT Hypervisor。capabilities（CPUID+MSR 能力报告）、load（通过 BYOVD 分配 VMXON/VMCS/EPT/MSR 位图）、unload、status。VMXON/VMLAUNCH 需内核组件。需要 JSHOOK_HYPERVISOR_ENABLE=1 + BYOVD。仅 Win32。 |
| `memory_antidetection` | 反检测加固工具集。check（只读扫描：内核回调、插桩回调、AMSI/ETW 状态、混沌模式）、harden（应用 AMSI/ETW 补丁 + 进程伪装 + 自防御）、status（当前保护状态）。ProcessBreakOnTermination 已永久禁用。非 Windows 返回平台信息。 |
| `memory_antidetection_check` | 反检测预检审计（只读）。检查 ETW/AMSI 状态、调试器附加、HVCI/VBS 状态、已知反作弊进程（100+ 签名）。返回 0-100 分评级和处置建议。 |
| `memory_session_export` | 将扫描会话的完整状态导出为 JSON。包含地址、值、元数据。上限 100K 地址。供扩展消费。 |
| `memory_freeze_export` | 导出所有活跃冻结条目为 JSON。返回 freezeId、地址、值、类型、间隔、状态。供扩展或 trainer 消费。 |
