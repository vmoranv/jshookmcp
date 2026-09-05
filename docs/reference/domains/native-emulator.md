# 原生仿真

域名：`native-emulator`

进程内、零外部依赖的自研 ARM64 解释器，用于仿真执行 Android `.so`：加载共享库、注册模拟 Java 方法、调用导出函数或 `Java_*` JNI 入口，以还原签名/加密算法。无需真机、JVM 或 Frida。会话隔离且显式管理（create→…→destroy），空闲自动过期防泄漏。libapp.so（Flutter Dart AOT）不在此执行，应交给 Dart 层。

## Profile

- workflow
- full

## 典型场景

- native/JNI 签名与加密算法还原
- 从 APK 抽取并加载 arm64-v8a .so
- 逐指令跟踪混淆 native 函数
- 模拟 Java 世界回调（声明式常量）

## 常见组合

- native-emulator + binary-instrument
- native-emulator + dart-inspector

## 工具清单（56）

| 工具 | 说明 |
| --- | --- |
| `nemu_capabilities` | 查看 native 仿真器后端可用性与支持的特性（自研 ARM64 解释器，无外部依赖）。 |
| `nemu_create_session` | 创建一个隔离的 ARM64 仿真器会话并返回 sessionId。每个会话独占自己的 CPU 寄存器、栈和 JNI 对象表，并发分析互不干扰。用完用 nemu_destroy_session 销毁，空闲会话会自动过期。 |
| `nemu_destroy_session` | 销毁一个仿真器会话并释放其内存（已映射的库、栈、JNI 表）。 |
| `nemu_list_sessions` | 列出活动的仿真器会话及其创建和最近使用时间。 |
| `nemu_session_info` | 在不执行 native 代码的情况下检查一个仿真器会话，返回时间戳、导出符号、未解析导入、构造器故障和活动会话数。 |
| `nemu_load_library` | 从文件路径将一个 AArch64 ELF 共享库（.so）加载进会话，映射段并解析导出符号。是 list_symbols / call_symbol / call_jni_export 的前置步骤。 |
| `nemu_load_library_chain` | 加载依赖库链并解析跨库导入符号。先传入依赖库路径数组 dependencyPaths（按序加载），再传入主库路径 primaryPath。各依赖库的导出符号对主库及后续依赖可见。适用于 FFmpeg 风格的多库加载场景，如 libijkplayer.so 调用 libijkffmpeg.so 和 libijksdl.so 的导出函数。 |
| `nemu_inspect_imports` | 在仿真前检查 AArch64 ELF .so 的动态导入重定位信息，列出导入符号、GOT 偏移，并标注每个导入在内置 bionic 桩中是否有支持。无需手写 readelf/Capstone 脚本即可诊断 PLT/GOT NULL 间接调用失败。 |
| `nemu_dump_got` | 导出 AArch64 ELF .so 的 PLT 跳板→GOT→符号映射表。扫描 .text 段中的 4 指令跳板模式（adrp x16 → ldr x17 → add x17,x16,x17 → br x17），交叉引用动态重定位解析被调用函数名。用于快速理解混淆 SO 中 "bl 0xACD0" 实际调用了什么。 |
| `nemu_extract_apk_libs` | 列出 APK 中可加载的 arm64-v8a native 库（.so）及其字节大小。libapp.so（Flutter Dart AOT）会被列出但无法在此执行，应交给 Dart 层。 |
| `nemu_load_apk_library` | 按名称从 APK 中抽取指定的 arm64-v8a .so 并一步加载进会话（无临时文件）。配合 nemu_extract_apk_libs 发现库名。 |
| `nemu_list_symbols` | 列出已加载库的导出函数符号——即可被 call_symbol / call_jni_export 调用的名字。 |
| `nemu_call_symbol` | 按 AArch64 AAPCS 调用约定调用一个导出函数（参数放 x0..x7，结果在 x0）。用于普通 native 导出；`Java_*` JNI 入口请用 call_jni_export。 |
| `nemu_call_jni_export` | 调用一个导出的 `Java_*` JNI 函数。自动注入 `JNIEnv*` 与 thiz，再传入 Java 参数。返回 x0——直接是 int/jboolean，或是 jobject/jbyteArray/jstring 句柄（用 read_byte_array 解析）。逆向 native 签名/加密例程的主入口。 |
| `nemu_call_address` | 以 AArch64 AAPCS 调用约定执行任意 guest 地址的函数（如通过 RegisterNatives 注册的 native 方法）。参数通过 x0..x7 传递，返回 x0。可选 injectJni=true 自动注入 guest JNIEnv* 为 x0、thiz=0 为 x1。 |
| `nemu_setup_java_mock` | 注册一个模拟 Java 方法，供被仿真的 native 代码经 JNI 回调（GetMethodID/GetStaticMethodID + `Call*Method`）。用 returnInt、returnString 或 returnBytes（base64）声明式指定返回值——模拟 native 例程计算前读取的「Java 世界」。不执行任何代码，仅返回配置的常量。 |
| `nemu_setup_java_field` | 注册一个模拟 Java 字段，供被仿真的 native 代码经 JNI 回读（GetFieldID/GetStaticFieldID + `Get&lt;Type&gt;Field`）。用 valueInt、valueString 或 valueBytes（base64）声明式指定字段值——即 native 例程会折叠进结果的「Java 世界」常量。不执行任何代码。 |
| `nemu_setup_java_mocks` | 批量注册多个 Java 方法 mock，一次调用完成。每个条目与 nemu_setup_java_mock 字段相同：className、methodName、signature，外加一个返回值（returnInt/returnString/returnBytes/returnObject/returnArray/returnMap）。用于一次性定义完整 mock 链。 |
| `nemu_new_byte_array` | 将 base64 字节包装成 JNI jbyteArray 句柄，作为参数传入 call_jni_export（如签名例程要处理的明文）。返回该句柄。 |
| `nemu_read_byte_array` | 将 jbyteArray 句柄（如 native 调用的返回值）解析回字节，以 base64 加长度返回。 |
| `nemu_create_jni_handle` | 创建预填充受控数据的 mock JNI 对象句柄。在调用 JNI 函数之前先用此工具填充句柄表，使 GetStringUTFChars/GetObjectArrayElement/GetIntField 返回预期值。返回的句柄 ID 可作为参数传给 nemu_call_address 或 nemu_call_symbol。 |
| `nemu_trace` | 调用一个导出符号，同时记录执行的每条指令（pc、操作码、步号），可选按步快照指定寄存器。受 maxSteps 限制。用于跟踪混淆 native 函数的控制流/算法。 |
| `nemu_set_pac_key` | 配置 ARMv8.3 指针认证（PAC）密钥集。设置 128 位密钥（32 个十六进制字符）到指定密钥槽（ia/ib/da/db），匹配从真实设备通过 Frida 导出的密钥，使 AUTIA 能验证并剥离真实硬件的 PAC 签名。 |
| `nemu_disassemble` | 无需创建仿真器会话即可反汇编单条指令。支持 arm64/aarch64、x86、x64、riscv32/riscv64、mips/mips32 与 mipsel；用于提升 trace 可读性的本地轻量解码器，覆盖常见 SSE/AVX/AVX2/AVX-512 EVEX、RISC-V 和 MIPS 指令。 |
| `nemu_alloc_memory` | 分配原始客户机内存（不是 JNI 句柄——是真正的 char* 地址）。可选通过 fillBytes（base64）填入初始数据。返回客户机地址，可作为整数参数传入 call_symbol。在会话开始时为原生解密/签名例程布置加密数据块，然后用 nemu_read_memory 读取输出。 |
| `nemu_read_memory` | 从客户机内存的指定地址读取原始字节。默认返回有界预览；设置 includeDataBase64=true 可在配置上限内返回完整 base64。用于在原生例程写入输出缓冲区后取回结果。 |
| `nemu_write_memory` | 通过 base64 数据向客户机内存的指定地址写入原始字节。用于在 call_symbol 调用之间更新输入缓冲区而无需重新分配，或就地修补代码/数据。 |
| `nemu_write_regions` | 一次调用写入多个内存区域。接受 {address, dataBase64} 对象数组。用于原子代码补丁——所有补丁一次应用避免中间态不一致。 |
| `nemu_prepare_tls` | 映射 TPIDR_EL0（线程指针）TLS 块使其可访问，以便通过 nemu_write_regions 预填充。返回 TLS 基地址。在向 TLS 偏移写入数据前使用（如 native 代码通过 mrs xN, tpidr_el0; ldr xM, [xN, #large_offset] 读取的帧表指针在 +0x1768 处）。 |
| `nemu_session_load` | 加载 JSON 序列化的工具调用数组并按顺序执行以搭建会话。每条目为 {tool, args}。支持的工具：alloc_memory、write_regions、call_address、call_symbol、prepare_tls、setup_java_mocks、map_memory、bind_host_fn。用于从保存的 JSON 计划重放调试会话。 |
| `nemu_bind_host_fn` | 在特定 guest 地址注册一个 JavaScript 宿主函数，覆盖任何已有 stub。函数接收 guest 寄存器（ctx.x(0)..x(7)），可读写 guest 内存（ctx.read/ctx.write），返回 BigInt 值写入 x0。用于在已解析的 GOT 地址 mock 自定义 shell 导入。 |
| `nemu_bind_all_imports` | 批量将宿主函数绑定到 GOT 中所有已解析的导入 stub。读取 GOT 表（0x74000 范围），找到每个唯一已解析地址，将给定的 JS 函数体绑定到每个。在 load_library 后调用以一次性 mock 所有未解析的 shell 导入。 |
| `nemu_mem_shadow` | 在指定地址添加影子内存覆盖层。影子内存的读取优先于底层内存——用于在原本会崩溃的地址提供 mock 数据（如 SO ELF 头所在的地址 0）。不修改底层 SO 映射。 |
| `nemu_create_vtable` | 在 guest 内存中创建 C++ vtable 对象。分配一个含 numSlots 个条目（每个指向返回 0 的宿主 stub）的 vtable 和一个指向它的对象。当 native 代码通过 [obj+offset] 做直接虚函数分发（BLR X8）时使用——常见于混淆 SO 调用 C++ 对象虚方法。返回 {objectAddr, vtableAddr}。 |
| `nemu_set_vtable_slot` | 用自定义宿主函数覆盖特定 vtable 槽位。vtableAddr + slotIndex*8 处的槽位被重写为执行 fnBody（JS，支持 ctx.x/ctx.writeU64/ctx.persistReg 等）的 stub。用于在用 nemu_create_vtable 创建 vtable 后 mock 特定 C++ 虚方法。 |
| `nemu_set_registers` | 按索引设置任意 CPU 寄存器。传入寄存器号到值的映射对象（如 {0: 0x60000000, 10: 0, 11: 0x55150}）。支持 x0-x30 和浮点 d0-d31。用于修正循环变量或在宿主函数调用前后注入上下文指针。 |
| `nemu_jni_diag` | 读取会话的 JNI 诊断日志。记录每次 JNI 函数调用（FindClass、GetMethodID、CallIntMethod 等）和未实现的 stub 调用。在 nemu_call_symbol 或 nemu_trace 后使用，查看 native 代码尝试调用了哪些 Java 方法。action: "read"（默认）读取并清空日志；"snapshot" 只读不清空；"clear" 只清空不返回。 |
| `nemu_jni_handles` | 列出会话中所有已分配的 JNI 对象句柄及其类型和摘要。句柄是 native 代码间传递的不透明 ID（jclass、jstring、jbyteArray、jobject）。用于验证 mock 设置和调试句柄泄漏。可按类型（class/string/bytes/method/field/auto-object/mock-int/mock-string/mock-boolean/objarray）或特定句柄号过滤。 |
| `nemu_get_jni_stub` | 获取 JNI 表索引对应的 guest stub 地址。传入特定 index 查单个条目（返回 0+越界标志），或省略 index 获取全部表摘要（首尾地址+条目数）。搭配 nemu_bind_host_fn 使用可在任意 JNI 槽位注入自定义逻辑。 |
| `nemu_dlsym_diag` | 读取当前会话的 dlsym 解析日志。记录仿真代码通过 dlsym() 请求的每次符号查找——用于发现混淆分发引擎尝试解析哪些 VM handler 名称。action: "read"（默认）读取并清空；"snapshot" 只读不清空；"clear" 只清空不返回。 |
| `nemu_vm_state_dump` | 从 guest 内存指定基地址导出 LiteVM 状态。读取 ctx（32×64-bit）、table（32×64-bit）和可选的 output buffer。返回结构化十六进制值，可与 Python LiteVM dump 对比。在 nemu_call_symbol 后使用以检查 native VM 执行结果。 |
| `nemu_vm_state_load` | 将 VM 状态加载到 guest 内存。接受 ctx 值和 table 值（十六进制字符串），写入指定基地址。用于将 Python LiteVM 状态桥接到 native VM：运行 Python vm.run()，导出 ctx/table 为十六进制，然后加载到 nemu guest 内存后调用 bb2i34u32clsb。 |
| `nemu_vm_state_compare` | 将 native VM 状态（从 guest 内存读取）与预期状态（如 Python LiteVM dump）进行对比。对 ctx、table 和 output 分别报告是否匹配并列出首个不匹配项。用于交叉验证 native VM 执行与已知正确的 Python 实现。 |
| `nemu_mem_map` | 在 guest 地址空间中映射内存区域。用于扩展映射区域作为输出缓冲区或临时数据，否则会导致未映射内存错误。幂等——对已映射区域安全重复调用。 |
| `nemu_bytecode_decode` | 将一个 u32 LiteVM 字节码字解码为其操作码字段：group（G0-G7）、子操作码、a1 寄存器索引、fl 字段索引、imm 有符号偏移和有效性。与 Python LiteVM Opcode.is_valid_opcode() 语义一致。无需会话——纯计算。用于理解 native 字节码字的含义。 |
| `nemu_bytecode_scan` | 扫描 guest 内存区域并解码所有有效的 LiteVM 字节码字。从 address 开始读取 count 个 u32 字，逐个解码，仅返回有效操作码及其偏移。比手动 decode+filter 快得多——一次调用遍历整个字节码表。 |
| `nemu_pointer_chain` | 遍历 guest 内存中的指针链。从 base 开始读取 u64 指针，跟踪到下一地址，最多重复 maxDepth 次。每跳显示地址、指针值和该处前 32 字节数据。用于理解 CreateLitevm 的 x24 表间接引用结构。 |
| `nemu_data_dump` | 读取 guest 内存区域并格式化为 u32 或 u64 值的结构化表格。每行显示偏移、十六进制值、ASCII 预览和可选注解。自动将每个字分类为指针、字节码、ASCII 或原始数据。指针会被解析以显示目标数据。 |
| `nemu_dump_frame` | 从 guest 内存读取并解码 CreateLitevm 帧结构。解析 256 字节帧字段：链指针、字节码计数、帧数据和子函数标志。用于理解执行过程中任意点的 VM 分发状态。 |
| `nemu_patch_apply` | 一次调用应用多个内存补丁。每个补丁为 {address, dataBase64, writeProtect?}。比多次调用 nemu_write_memory 更快——用于必须同时应用以避免中间态损坏的原子代码补丁。 |
| `nemu_regs_save` | 保存当前 GPR 寄存器（x0-x30, sp）的命名快照。返回可用 nemu_regs_restore 恢复的快照 ID。快照持续到会话销毁或名称被覆盖。用于在调用会破坏被调用者保存寄存器的混淆函数前保留寄存器状态。 |
| `nemu_regs_restore` | 从之前保存的快照（由 nemu_regs_save 创建）恢复 GPR 寄存器。部分恢复：仅写回已保存的寄存器。用于在混淆函数调用后恢复解码/上下文寄存器。 |
| `nemu_scan_memory` | 在仿真内存中扫描字节模式（类似 Volatility）。使用 Boyer-Moore-Horspool 算法在 guest 地址范围内搜索精确字节匹配。返回匹配地址列表。静默跳过未映射区域——如需扩展扫描范围请先调用 nemu_mem_map。 |
| `nemu_xor_region` | 用单字节密钥对仿真内存区域进行 XOR 运算。返回 XOR 结果的 base64。用于快速解密测试——用候选密钥字节 XOR 缓冲区并检查预览，不修改 guest 状态。设 dryRun=false 将 XOR 结果写回 guest 内存。 |
| `nemu_relay` | 通过 IPC 中继连接到远程 native-emulator 会话。通过命名管道（Windows）或 Unix domain socket（Linux/macOS）以长度前缀帧的 JSON-RPC 转发 nemu 操作。适合从 Windows MCP 服务器驱动 Linux 主机上的 ARM64 nemu 会话（反之亦然）。 |
| `nemu_gdbserver` | 基于用户提供的 TCP 监听器实现的 GDB 远程串行协议（RSP）桩。这是一个协议桩层——需要自行提供 TCP socket（例如 netcat、Python socket 脚本或自定义桥接）。该工具接收原始 RSP 数据包并分发给仿真器，返回 RSP 响应。数据包格式：$data#checksum（RFC 5.1 GDB Remote Serial Protocol）。支持的命令：?（停止原因）、g（读寄存器）、G（写寄存器）、m addr,len（读内存）、M addr,len:data（写内存）、s（单步）、c（继续）、Z0,z0（设置/清除软件断点）。可用 action：packet（处理单个 RSP 数据包——返回响应供调用方回传）、status（报告会话就绪状态）。这是与 CE 7.6+ / x64dbg gdbserver 兼容的最小实现。 |
