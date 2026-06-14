# 原生仿真

域名：`native-emulator`

进程内、零外部依赖的自研 ARM64 解释器，用于仿真执行 Android `.so`：加载共享库、注册模拟 Java 方法、调用导出函数或 `Java_*` JNI 入口，以还原签名/加密算法。无需真机、JVM 或 Frida。会话隔离且显式管理（create→…→destroy），空闲自动过期防泄漏。libapp.so（Flutter Dart AOT）不在此执行，应交给 Dart 层。

## Profile

- full

## 典型场景

- native/JNI 签名与加密算法还原
- 从 APK 抽取并加载 arm64-v8a .so
- 逐指令跟踪混淆 native 函数
- 模拟 Java 世界回调（声明式常量）

## 常见组合

- native-emulator + binary-instrument
- native-emulator + dart-inspector

## 工具清单（21）

| 工具 | 说明 |
| --- | --- |
| `nemu_capabilities` | 查看 native 仿真器后端可用性与支持的特性（自研 ARM64 解释器，无外部依赖）。 |
| `nemu_create_session` | 创建一个隔离的 ARM64 仿真器会话并返回 sessionId。每个会话独占自己的 CPU 寄存器、栈和 JNI 对象表，并发分析互不干扰。用完用 nemu_destroy_session 销毁，空闲会话会自动过期。 |
| `nemu_destroy_session` | 销毁一个仿真器会话并释放其内存（已映射的库、栈、JNI 表）。 |
| `nemu_list_sessions` | 列出活动的仿真器会话及其创建和最近使用时间。 |
| `nemu_load_library` | 从文件路径将一个 AArch64 ELF 共享库（.so）加载进会话，映射段并解析导出符号。是 list_symbols / call_symbol / call_jni_export 的前置步骤。 |
| `nemu_load_library_chain` | 待补充中文：Load a chain of dependent libraries into a session, resolving inter-library imports. Pass dependency .so paths as dependencyPaths (loaded first in order), then the primary .so path. Each dependency exports are visible to the primary and later dependencies. Use this for FFmpeg-style multi-library loads where libijkplayer.so calls exports from libijkffmpeg.so and libijksdl.so. |
| `nemu_inspect_imports` | 在仿真前检查 AArch64 ELF .so 的动态导入重定位信息，列出导入符号、GOT 偏移，并标注每个导入在内置 bionic 桩中是否有支持。无需手写 readelf/Capstone 脚本即可诊断 PLT/GOT NULL 间接调用失败。 |
| `nemu_extract_apk_libs` | 列出 APK 中可加载的 arm64-v8a native 库（.so）及其字节大小。libapp.so（Flutter Dart AOT）会被列出但无法在此执行，应交给 Dart 层。 |
| `nemu_load_apk_library` | 按名称从 APK 中抽取指定的 arm64-v8a .so 并一步加载进会话（无临时文件）。配合 nemu_extract_apk_libs 发现库名。 |
| `nemu_list_symbols` | 列出已加载库的导出函数符号——即可被 call_symbol / call_jni_export 调用的名字。 |
| `nemu_call_symbol` | 按 AArch64 AAPCS 调用约定调用一个导出函数（参数放 x0..x7，结果在 x0）。用于普通 native 导出；`Java_*` JNI 入口请用 call_jni_export。 |
| `nemu_call_jni_export` | 调用一个导出的 `Java_*` JNI 函数。自动注入 `JNIEnv*` 与 thiz，再传入 Java 参数。返回 x0——直接是 int/jboolean，或是 jobject/jbyteArray/jstring 句柄（用 read_byte_array 解析）。逆向 native 签名/加密例程的主入口。 |
| `nemu_setup_java_mock` | 注册一个模拟 Java 方法，供被仿真的 native 代码经 JNI 回调（GetMethodID/GetStaticMethodID + `Call*Method`）。用 returnInt、returnString 或 returnBytes（base64）声明式指定返回值——模拟 native 例程计算前读取的「Java 世界」。不执行任何代码，仅返回配置的常量。 |
| `nemu_setup_java_field` | 注册一个模拟 Java 字段，供被仿真的 native 代码经 JNI 回读（GetFieldID/GetStaticFieldID + `Get&lt;Type&gt;Field`）。用 valueInt、valueString 或 valueBytes（base64）声明式指定字段值——即 native 例程会折叠进结果的「Java 世界」常量。不执行任何代码。 |
| `nemu_new_byte_array` | 将 base64 字节包装成 JNI jbyteArray 句柄，作为参数传入 call_jni_export（如签名例程要处理的明文）。返回该句柄。 |
| `nemu_read_byte_array` | 将 jbyteArray 句柄（如 native 调用的返回值）解析回字节，以 base64 加长度返回。 |
| `nemu_trace` | 调用一个导出符号，同时记录执行的每条指令（pc、操作码、步号），可选按步快照指定寄存器。受 maxSteps 限制。用于跟踪混淆 native 函数的控制流/算法。 |
| `nemu_disassemble` | 无需创建仿真器会话即可反汇编单条指令。支持 arm64/aarch64、x86、x64、riscv32/riscv64、mips/mips32 与 mipsel；用于提升 trace 可读性的本地轻量解码器，覆盖常见 SSE/AVX/AVX2/AVX-512 EVEX、RISC-V 和 MIPS 指令。 |
| `nemu_alloc_memory` | 分配原始客户机内存（不是 JNI 句柄——是真正的 char* 地址）。可选通过 fillBytes（base64）填入初始数据。返回客户机地址，可作为整数参数传入 call_symbol。在会话开始时为原生解密/签名例程布置加密数据块，然后用 nemu_read_memory 读取输出。 |
| `nemu_read_memory` | 从客户机内存的指定地址读取原始字节。默认返回有界预览；设置 includeDataBase64=true 可在配置上限内返回完整 base64。用于在原生例程写入输出缓冲区后取回结果。 |
| `nemu_write_memory` | 通过 base64 数据向客户机内存的指定地址写入原始字节。用于在 call_symbol 调用之间更新输入缓冲区而无需重新分配，或就地修补代码/数据。 |
