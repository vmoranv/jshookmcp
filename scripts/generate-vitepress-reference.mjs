import { readFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';

const scriptDirUrl = new URL('.', import.meta.url);
const projectRootUrl = new URL('../', scriptDirUrl);
const projectRoot = fileURLToPath(projectRootUrl);
const require = createRequire(import.meta.url);
const workflowPresetsRoot = join(projectRoot, 'workflows');
const zhReferenceRoot = join(projectRoot, 'docs', 'reference');
const zhDomainsRoot = join(zhReferenceRoot, 'domains');
const enReferenceRoot = join(projectRoot, 'docs', 'en', 'reference');
const enDomainsRoot = join(enReferenceRoot, 'domains');
const zhTranslationsPath = join(
  projectRoot,
  'docs',
  '.vitepress',
  'i18n',
  'zh',
  'reference-tool-descriptions.json',
);
const zhPlaceholderPrefix = '待补充中文：';
const referenceRegistryPlatform = 'win32';

const zhVitepressRoot = join(projectRoot, 'docs', '.vitepress');
const zhSidebarPath = join(zhVitepressRoot, 'sidebar-reference-zh.mjs');
const enSidebarPath = join(zhVitepressRoot, 'sidebar-reference-en.mjs');

const META = {
  core: {
    zhTitle: '核心',
    zhSummary:
      '核心静态/半静态分析域，覆盖脚本采集、反混淆、语义理解、webpack/source map 与加密识别。',
    zhScenarios: ['脚本采集与静态检索', '混淆代码理解', '从 bundle/source map 恢复源码'],
    zhCombos: ['browser + network + core', 'core + sourcemap + transform'],
    enTitle: 'Core',
    enSummary:
      'Core static and semi-static analysis domain for script collection, deobfuscation, semantic inspection, webpack analysis, source map recovery, and crypto detection.',
    enScenarios: [
      'Collect and inspect scripts',
      'Understand obfuscated code',
      'Recover code from bundles and source maps',
    ],
    enCombos: ['browser + network + core', 'core + sourcemap + transform'],
  },
  browser: {
    zhTitle: '浏览器',
    zhSummary: '浏览器控制与 DOM 交互主域，也是大多数工作流的入口。',
    zhScenarios: ['页面导航', 'DOM 操作与截图', '多标签页与本地存储读取'],
    zhCombos: ['browser + network', 'browser + instrumentation', 'browser + workflow'],
    enTitle: 'Browser',
    enSummary:
      'Primary browser control and DOM interaction domain; the usual entry point for most workflows.',
    enScenarios: [
      'Navigate pages',
      'Interact with the DOM and capture screenshots',
      'Work with tabs and storage',
    ],
    enCombos: ['browser + network', 'browser + instrumentation', 'browser + workflow'],
  },
  coordination: {
    zhTitle: '协调',
    zhSummary:
      '用于会话洞察记录、MCP Task Handoff 与跨 Agent 共享状态板的协调域，衔接大语言模型的规划与执行。',
    zhScenarios: ['Task Handoff 任务交接', '记录会话深度分析结论', '跨 Agent 数据共享与状态广播'],
    zhCombos: ['coordination + workflow', 'coordination + browser'],
    enTitle: 'Coordination',
    enSummary:
      'Coordination domain for session insights, MCP Task Handoff, and cross-agent shared state board, bridging the planning and execution boundaries of LLMs.',
    enScenarios: [
      'MCP Task Handoff',
      'Recording deep session insights',
      'Cross-agent data sharing and state broadcasting',
    ],
    enCombos: ['coordination + workflow', 'coordination + browser'],
  },
  debugger: {
    zhTitle: '调试器',
    zhSummary: '基于 CDP 的断点、单步、调用栈、watch、调试会话管理与反反调试域。',
    zhScenarios: ['断点调试', '调用帧求值', '调试会话保存/恢复', '反调试绕过'],
    zhCombos: ['debugger + browser', 'debugger + instrumentation'],
    enTitle: 'Debugger',
    enSummary:
      'CDP-based debugging domain covering breakpoints, stepping, call stacks, watches, debugger sessions, and anti-anti-debug.',
    enScenarios: [
      'Set and hit breakpoints',
      'Evaluate expressions in frames',
      'Save and restore debugger sessions',
      'Bypass anti-debugging protections',
    ],
    enCombos: ['debugger + browser', 'debugger + instrumentation'],
  },
  encoding: {
    zhTitle: '编码',
    zhSummary: '二进制格式检测、编码转换、熵分析与 protobuf 原始解码。',
    zhScenarios: ['payload 判型', '编码互转', '未知 protobuf 粗解码'],
    zhCombos: ['network + encoding'],
    enTitle: 'Encoding',
    enSummary:
      'Binary format detection, encoding conversion, entropy analysis, and raw protobuf decoding.',
    enScenarios: [
      'Identify unknown payload formats',
      'Convert between encodings',
      'Decode schema-less protobuf payloads',
    ],
    enCombos: ['network + encoding'],
  },
  graphql: {
    zhTitle: '图查询',
    zhSummary: 'GraphQL 发现、提取、重放与 introspection 能力。',
    zhScenarios: ['Schema 枚举', '网络中提取 query/mutation', 'GraphQL 重放'],
    zhCombos: ['network + graphql'],
    enTitle: 'GraphQL',
    enSummary: 'GraphQL discovery, extraction, replay, and introspection tooling.',
    enScenarios: [
      'Run schema introspection',
      'Extract queries and mutations from traces',
      'Replay GraphQL requests',
    ],
    enCombos: ['network + graphql'],
  },
  instrumentation: {
    zhTitle: '仪器化',
    zhSummary:
      '统一仪器化会话域，将 Hook、拦截、Trace、证据图与产物记录收束到可查询的 session 中。',
    zhScenarios: [
      '创建/销毁 instrumentation 会话',
      '登记 Hook / 拦截 / Trace 操作',
      '记录并查询运行时产物',
      'AI Hook 生成与 preset 管理',
      '逆向证据图溯源',
    ],
    zhCombos: ['instrumentation + network', 'instrumentation + browser'],
    enTitle: 'Instrumentation',
    enSummary:
      'Unified instrumentation-session domain that groups hooks, intercepts, traces, evidence graphs, and artifacts into a queryable session.',
    enScenarios: [
      'Create and destroy instrumentation sessions',
      'Register hook, intercept, and trace operations',
      'Record and query runtime artifacts',
      'AI hook generation and preset management',
      'Evidence graph provenance traversal',
    ],
    enCombos: ['instrumentation + network', 'instrumentation + browser'],
  },
  maintenance: {
    zhTitle: '维护',
    zhSummary: '运维与维护域，覆盖缓存、token 预算、环境诊断、产物清理、扩展管理与安全沙箱执行。',
    zhScenarios: ['依赖诊断', '产物清理', '扩展热加载', '安全脚本执行'],
    zhCombos: ['maintenance + workflow', 'maintenance + extensions'],
    enTitle: 'Maintenance',
    enSummary:
      'Operations and maintenance domain covering cache hygiene, token budget, environment diagnostics, artifact cleanup, extension management, and secure sandbox execution.',
    enScenarios: [
      'Diagnose dependencies',
      'Clean retained artifacts',
      'Reload plugins and workflows',
      'Execute custom scripts in a secure sandbox',
    ],
    enCombos: ['maintenance + workflow', 'maintenance + extensions'],
  },
  memory: {
    zhTitle: '内存',
    zhSummary: '面向原生内存扫描、指针链分析、结构体推断与断点观测的内存分析域。',
    zhScenarios: ['首扫/缩扫定位目标值', '指针链与结构体分析', '内存断点与扫描会话管理'],
    zhCombos: ['memory + process', 'memory + debugger', 'memory + workflow'],
    enTitle: 'Memory',
    enSummary:
      'Memory analysis domain for native scans, pointer-chain discovery, structure inference, and breakpoint-based observation.',
    enScenarios: [
      'Run first/next scans to narrow target values',
      'Analyze pointer chains and in-memory structures',
      'Manage scan sessions and memory breakpoints',
    ],
    enCombos: ['memory + process', 'memory + debugger', 'memory + workflow'],
  },
  network: {
    zhTitle: '网络',
    zhSummary: '请求捕获、响应体读取、HAR 导出、请求重放与性能追踪。',
    zhScenarios: ['抓包', '认证提取', '请求重放', '性能 trace'],
    zhCombos: ['browser + network', 'network + workflow'],
    enTitle: 'Network',
    enSummary:
      'Request capture, response extraction, HAR export, safe replay, and performance tracing.',
    enScenarios: [
      'Capture requests',
      'Extract auth material',
      'Replay requests safely',
      'Record performance traces',
    ],
    enCombos: ['browser + network', 'network + workflow'],
  },
  platform: {
    zhTitle: '平台',
    zhSummary: '宿主平台与包格式分析域，覆盖 miniapp、asar、Electron。',
    zhScenarios: ['小程序包分析', 'Electron 结构检查'],
    zhCombos: ['platform + process', 'platform + core'],
    enTitle: 'Platform',
    enSummary:
      'Platform and package analysis domain covering miniapps, ASAR archives, and Electron apps.',
    enScenarios: ['Inspect miniapp packages', 'Analyze Electron application structure'],
    enCombos: ['platform + process', 'platform + core'],
  },
  process: {
    zhTitle: '进程',
    zhSummary:
      '进程、模块、内存诊断与受控注入域，适合宿主级分析、故障排查与 Windows 进程实验场景。',
    zhScenarios: [
      '进程枚举与模块检查',
      '内存失败诊断与审计导出',
      '受控环境中的 DLL/Shellcode 注入',
    ],
    zhCombos: ['process + debugger', 'process + platform'],
    enTitle: 'Process',
    enSummary:
      'Process, module, memory diagnostics, and controlled injection domain for host-level inspection, troubleshooting, and Windows process experimentation workflows.',
    enScenarios: [
      'Enumerate processes and inspect modules',
      'Diagnose memory failures and export audit trails',
      'Perform controlled DLL/shellcode injection in opt-in environments',
    ],
    enCombos: ['process + debugger', 'process + platform'],
  },
  sourcemap: {
    zhTitle: '源映射',
    zhSummary: 'SourceMap 发现、抓取、解析与源码树重建。',
    zhScenarios: ['自动发现 sourcemap', '恢复源码树'],
    zhCombos: ['core + sourcemap'],
    enTitle: 'SourceMap',
    enSummary: 'Source map discovery, fetching, parsing, and source tree reconstruction.',
    enScenarios: ['Discover source maps automatically', 'Reconstruct source trees'],
    enCombos: ['core + sourcemap'],
  },
  streaming: {
    zhTitle: '流式',
    zhSummary: 'WebSocket 与 SSE 监控域。',
    zhScenarios: ['WS 帧采集', 'SSE 事件监控'],
    zhCombos: ['browser + streaming + network'],
    enTitle: 'Streaming',
    enSummary: 'WebSocket and SSE monitoring domain.',
    enScenarios: ['Capture WebSocket frames', 'Monitor SSE events'],
    enCombos: ['browser + streaming + network'],
  },
  transform: {
    zhTitle: '变换',
    zhSummary: 'AST/字符串变换与加密实现抽取、测试、对比域。',
    zhScenarios: ['变换预览', '加密函数抽取', '实现差异比对'],
    zhCombos: ['core + transform'],
    enTitle: 'Transform',
    enSummary:
      'AST/string transform domain plus crypto extraction, harnessing, and comparison tooling.',
    enScenarios: [
      'Preview transforms',
      'Extract standalone crypto code',
      'Compare implementations',
    ],
    enCombos: ['core + transform'],
  },
  wasm: {
    zhTitle: 'WASM',
    zhSummary: 'WebAssembly dump、反汇编、反编译、优化与离线执行域。',
    zhScenarios: ['WASM 模块提取', 'WAT/伪代码恢复', '离线运行导出函数'],
    zhCombos: ['browser + wasm', 'core + wasm'],
    enTitle: 'WASM',
    enSummary:
      'WebAssembly dump, disassembly, decompilation, optimization, and offline execution domain.',
    enScenarios: ['Dump WASM modules', 'Recover WAT or pseudo-C', 'Run exported functions offline'],
    enCombos: ['browser + wasm', 'core + wasm'],
  },
  workflow: {
    zhTitle: '工作流',
    zhSummary: '复合工作流、脚本库与宏编排域，是 built-in 高层编排入口。',
    zhScenarios: ['一键 API 采集', '注册与验证流程', '批量探测与 bundle 搜索', '多步宏编排'],
    zhCombos: ['workflow + browser + network'],
    enTitle: 'Workflow',
    enSummary:
      'Composite workflow, script-library, and macro-orchestration domain; the main built-in orchestration layer.',
    enScenarios: [
      'Capture APIs end-to-end',
      'Register and verify accounts',
      'Probe endpoints and inspect bundles',
      'Chain multi-step macro workflows',
    ],
    enCombos: ['workflow + browser + network'],
  },
  trace: {
    zhTitle: '追踪',
    zhSummary: '时间旅行调试域，录制 CDP 事件并写入 SQLite，支持 SQL 查询与堆快照对比。',
    zhScenarios: ['录制浏览器事件', 'SQL 查询跟踪数据', '堆快照差异对比'],
    zhCombos: ['trace + debugger + browser'],
    enTitle: 'Trace',
    enSummary:
      'Time-travel debugging domain that records CDP events into SQLite for SQL-based querying and heap snapshot comparison.',
    enScenarios: ['Record browser events', 'Query trace data with SQL', 'Diff heap snapshots'],
    enCombos: ['trace + debugger + browser'],
  },
  canvas: {
    zhTitle: '画布引擎',
    zhSummary:
      '游戏引擎 Canvas 逆向分析域与 Skia 渲染引擎捕获域，支持 Laya/Pixi/Phaser/Cocos/Unity 等主流游戏引擎的指纹识别、场景树导出、对象拾取，以及 Skia GPU 后端检测与场景提取。',
    zhScenarios: [
      '游戏引擎识别与版本检测',
      '场景节点树导出',
      '坐标拾取游戏对象',
      '点击事件链路追踪',
      'Skia GPU 后端检测与场景提取',
    ],
    zhCombos: ['browser + canvas + debugger', 'canvas + trace'],
    enTitle: 'Canvas',
    enSummary:
      'Canvas game engine reverse analysis domain plus Skia rendering capture, supporting Laya, Pixi, Phaser, Cocos, and Unity engines for fingerprinting, scene tree dumping, object picking, and Skia GPU backend detection and scene extraction.',
    enScenarios: [
      'Game engine fingerprinting and version detection',
      'Scene node tree export',
      'Coordinate-based object picking',
      'Click event handler tracing',
      'Skia GPU backend detection and scene extraction',
    ],
    enCombos: ['browser + canvas + debugger', 'canvas + trace'],
  },
  'protocol-analysis': {
    zhTitle: '协议分析',
    zhSummary: '自定义协议分析域，支持协议模式定义、自动字段检测、状态机推断和可视化。',
    zhScenarios: [
      '自定义协议模式定义',
      '从十六进制载荷自动检测字段边界',
      '从捕获消息推断协议状态机',
      '生成 Mermaid 状态图',
    ],
    zhCombos: ['network + protocol-analysis', 'encoding + protocol-analysis'],
    enTitle: 'Protocol Analysis',
    enSummary:
      'Custom protocol analysis domain supporting protocol pattern definition, automatic field detection from hex payloads, state machine inference from captured messages, and Mermaid diagram visualization.',
    enScenarios: [
      'Custom protocol pattern definition',
      'Automatic field boundary detection from hex payloads',
      'State machine inference from captured message sequences',
      'Mermaid state diagram generation',
    ],
    enCombos: ['network + protocol-analysis', 'encoding + protocol-analysis'],
  },
  'adb-bridge': {
    zhTitle: 'ADB 桥接',
    zhSummary: 'Android Debug Bridge 集成域，用于设备管理、应用分析和远程调试。',
    zhScenarios: ['Android 设备管理', 'APK 分析', '远程调试'],
    zhCombos: ['adb-bridge + process', 'adb-bridge + network'],
    enTitle: 'ADB Bridge',
    enSummary:
      'Android Debug Bridge integration domain for device management, application analysis, and remote debugging.',
    enScenarios: ['Android device management', 'APK analysis', 'Remote debugging'],
    enCombos: ['adb-bridge + process', 'adb-bridge + network'],
  },
  'binary-instrument': {
    zhTitle: '二进制插桩',
    zhSummary: '二进制插桩域，提供二进制分析、运行时插桩、APK 加固识别与密钥候选扫描能力。',
    zhScenarios: ['二进制分析', '运行时插桩', 'APK 加固层识别', '硬编码密钥候选检测'],
    zhCombos: ['binary-instrument + memory', 'binary-instrument + process'],
    enTitle: 'Binary Instrument',
    enSummary:
      'Binary instrumentation domain providing binary analysis, runtime instrumentation, APK packer identification, and hardcoded key candidate scanning.',
    enScenarios: [
      'Binary analysis',
      'Runtime instrumentation',
      'APK packer-layer identification',
      'Hardcoded key candidate detection',
    ],
    enCombos: ['binary-instrument + memory', 'binary-instrument + process'],
  },
  'boringssl-inspector': {
    zhTitle: 'BoringSSL 检查',
    zhSummary: 'BoringSSL/TLS 检查域，支持 TLS 流量分析和证书检查。',
    zhScenarios: ['TLS 流量分析', '证书解析', '密钥日志捕获'],
    zhCombos: ['boringssl-inspector + network', 'boringssl-inspector + browser'],
    enTitle: 'BoringSSL Inspector',
    enSummary:
      'BoringSSL/TLS inspection domain supporting TLS traffic analysis and certificate inspection.',
    enScenarios: ['TLS traffic analysis', 'Certificate parsing', 'Key log capture'],
    enCombos: ['boringssl-inspector + network', 'boringssl-inspector + browser'],
  },
  'dart-inspector': {
    zhTitle: 'Dart 检查',
    zhSummary:
      '从 Flutter AOT libapp.so 中抽取并分类字符串、还原 Smi 整数常量，并使用开发者提供的混淆映射反查原始符号。',
    zhScenarios: [
      'Flutter 应用逆向',
      'libapp.so 字符串审计',
      'Smi 整数常量恢复',
      '混淆符号反查（obfuscation-map.json）',
    ],
    zhCombos: ['dart-inspector + binary-instrument', 'dart-inspector + adb-bridge'],
    enTitle: 'Dart Inspector',
    enSummary:
      'Extract and classify strings, recover Smi integer constants, and resolve obfuscated identifiers from Flutter AOT libapp.so using a developer-supplied obfuscation map.',
    enScenarios: [
      'Flutter app reversing',
      'libapp.so string audit',
      'Smi integer constant recovery',
      'Obfuscation map symbol lookup',
    ],
    enCombos: ['dart-inspector + binary-instrument', 'dart-inspector + adb-bridge'],
  },
  'native-emulator': {
    zhTitle: '原生仿真',
    zhSummary:
      '进程内、零外部依赖的自研 ARM64 解释器，用于仿真执行 Android `.so`：加载共享库、注册模拟 Java 方法、调用导出函数或 `Java_*` JNI 入口，以还原签名/加密算法。无需真机、JVM 或 Frida。会话隔离且显式管理（create→…→destroy），空闲自动过期防泄漏。libapp.so（Flutter Dart AOT）不在此执行，应交给 Dart 层。',
    zhScenarios: [
      'native/JNI 签名与加密算法还原',
      '从 APK 抽取并加载 arm64-v8a .so',
      '逐指令跟踪混淆 native 函数',
      '模拟 Java 世界回调（声明式常量）',
    ],
    zhCombos: ['native-emulator + binary-instrument', 'native-emulator + dart-inspector'],
    enTitle: 'Native Emulator',
    enSummary:
      'In-process, dependency-free self-built ARM64 interpreter for emulating Android `.so` libraries: load a shared object, register mock Java methods, and invoke exported or `Java_*` JNI functions to recover signing/crypto algorithms — no device, JVM, or Frida. Sessions are isolated and explicitly managed (create → … → destroy) with idle auto-expiry. libapp.so (Flutter Dart AOT) is not executable here and routes to the Dart layer.',
    enScenarios: [
      'Recover native/JNI signing and crypto algorithms',
      'Extract and load arm64-v8a .so from an APK',
      'Instruction-trace an obfuscated native function',
      'Mock the Java world via declarative callbacks',
    ],
    enCombos: ['native-emulator + binary-instrument', 'native-emulator + dart-inspector'],
  },
  'native-bridge': {
    zhTitle: '原生桥接',
    zhSummary:
      '原生分析工具桥接域，通过本地 loopback HTTP bridge 对接 Ghidra、IDA、Rizin/r2 与 Binary Ninja，用于函数枚举、反编译/反汇编、字符串搜索、交叉引用与符号同步。',
    zhScenarios: [
      '检查本地反汇编器 bridge 健康状态',
      '打开二进制并枚举函数/段/字符串',
      '通过 Ghidra/IDA/Binary Ninja 反编译函数',
      '通过 Rizin/r2 执行分析命令',
      '在多后端之间同步原生符号',
    ],
    zhCombos: ['native-bridge + binary-instrument', 'native-bridge + process'],
    enTitle: 'Native Bridge',
    enSummary:
      'Native analysis bridge domain for local loopback HTTP bridges to Ghidra, IDA, Rizin/r2, and Binary Ninja, covering function listing, decompilation/disassembly, string search, xrefs, and symbol sync.',
    enScenarios: [
      'Check local disassembler bridge health',
      'Open binaries and list functions, segments, and strings',
      'Decompile functions through Ghidra, IDA, or Binary Ninja',
      'Run analysis commands through Rizin/r2',
      'Synchronize native symbols across backends',
    ],
    enCombos: ['native-bridge + binary-instrument', 'native-bridge + process'],
  },
  'extension-registry': {
    zhTitle: '扩展注册',
    zhSummary: '扩展注册域，管理和发现社区扩展。',
    zhScenarios: ['扩展浏览', '扩展安装', '扩展版本管理'],
    zhCombos: ['extension-registry + workflow', 'extension-registry + maintenance'],
    enTitle: 'Extension Registry',
    enSummary: 'Extension registry domain for managing and discovering community extensions.',
    enScenarios: ['Extension browsing', 'Extension installation', 'Extension version management'],
    enCombos: ['extension-registry + workflow', 'extension-registry + maintenance'],
  },
  'mojo-ipc': {
    zhTitle: 'Mojo IPC',
    zhSummary: 'Mojo IPC 监控域，用于 Chromium 内部进程间通信分析。',
    zhScenarios: ['Mojo 消息监控', 'IPC 模式分析', 'Chromium 内部协议逆向'],
    zhCombos: ['mojo-ipc + browser', 'mojo-ipc + network'],
    enTitle: 'Mojo IPC',
    enSummary: 'Mojo IPC monitoring domain for Chromium inter-process communication analysis.',
    enScenarios: [
      'Mojo message monitoring',
      'IPC pattern analysis',
      'Chromium internal protocol reversing',
    ],
    enCombos: ['mojo-ipc + browser', 'mojo-ipc + network'],
  },
  netproto: {
    zhTitle: '网络协议',
    zhSummary: '网络协议分析域，专注于网络层协议逆向和模式识别。',
    zhScenarios: ['自定义协议分析', '网络模式识别', '协议指纹'],
    zhCombos: ['netproto + network', 'netproto + protocol-analysis'],
    enTitle: 'NetProto',
    enSummary:
      'Network protocol analysis domain focused on network-layer protocol reversing and pattern recognition.',
    enScenarios: [
      'Custom protocol analysis',
      'Network pattern recognition',
      'Protocol fingerprinting',
    ],
    enCombos: ['netproto + network', 'netproto + protocol-analysis'],
  },
  'syscall-hook': {
    zhTitle: '系统调用挂钩',
    zhSummary: '系统调用挂钩域，提供系统调用监控和映射能力。',
    zhScenarios: ['系统调用监控', 'API 挂钩', '行为分析'],
    zhCombos: ['syscall-hook + process', 'syscall-hook + instrumentation'],
    enTitle: 'Syscall Hook',
    enSummary:
      'System call hooking domain providing system call monitoring and mapping capabilities.',
    enScenarios: ['System call monitoring', 'API hooking', 'Behavioral analysis'],
    enCombos: ['syscall-hook + process', 'syscall-hook + instrumentation'],
  },
  'v8-inspector': {
    zhTitle: 'V8 检查器',
    zhSummary: 'V8 检查器域，提供堆快照分析、CPU 分析和内存检查。',
    zhScenarios: ['堆快照分析', 'CPU 性能分析', '内存泄漏检测'],
    zhCombos: ['v8-inspector + browser', 'v8-inspector + debugger'],
    enTitle: 'V8 Inspector',
    enSummary:
      'V8 inspector domain providing heap snapshot analysis, CPU profiling, and memory inspection.',
    enScenarios: ['Heap snapshot analysis', 'CPU profiling', 'Memory leak detection'],
    enCombos: ['v8-inspector + browser', 'v8-inspector + debugger'],
  },
  'cross-domain': {
    zhTitle: '跨域关联',
    zhSummary: '跨域关联域，将多个域的分析结果进行交叉关联，支持自动化工作流编排与证据图桥接。',
    zhScenarios: ['跨域证据关联', '自动化逆向工作流', '多信号源聚合分析'],
    zhCombos: ['cross-domain + instrumentation', 'cross-domain + v8-inspector + canvas'],
    enTitle: 'Cross-Domain',
    enSummary:
      'Cross-domain correlation domain that bridges analysis results across multiple domains, supporting workflow orchestration and evidence graph integration.',
    enScenarios: [
      'Cross-domain evidence correlation',
      'Automated reverse engineering workflows',
      'Multi-signal aggregation analysis',
    ],
    enCombos: ['cross-domain + instrumentation', 'cross-domain + v8-inspector + canvas'],
  },
  proxy: {
    zhTitle: '代理',
    zhSummary: '全栈 HTTP/HTTPS 中间人代理域，提供系统级的流量拦截、篡改与应用级挂载配置。',
    zhScenarios: ['全局 HTTP/HTTPS 抓包', '接口 Mock 与转发', 'Android 辅助挂载'],
    zhCombos: ['proxy + network', 'proxy + adb-bridge'],
    enTitle: 'Proxy',
    enSummary:
      'Full-stack HTTP/HTTPS MITM proxy domain for system-level traffic interception, modification, and application configuration.',
    enScenarios: [
      'Global HTTP/HTTPS capture',
      'API Mocking and forwarding',
      'Android assisted mounting',
    ],
    enCombos: ['proxy + network', 'proxy + adb-bridge'],
  },
  'exploit-dev': {
    zhTitle: '漏洞开发',
    zhSummary:
      '二进制漏洞利用开发域，提供 ROP/JOP gadget 搜索、shellcode 编码、保护机制检测与偏移计算。',
    zhScenarios: ['ROP 链构建', 'Shellcode 编码与混淆', '二进制保护检测', '缓冲区溢出偏移计算'],
    zhCombos: ['exploit-dev + binary-instrument', 'exploit-dev + memory'],
    enTitle: 'Exploit Development',
    enSummary:
      'Binary exploit development domain providing ROP/JOP gadget search, shellcode encoding, mitigation detection, and offset calculation.',
    enScenarios: [
      'ROP chain building',
      'Shellcode encoding and obfuscation',
      'Binary protection detection',
      'Buffer overflow offset calculation',
    ],
    enCombos: ['exploit-dev + binary-instrument', 'exploit-dev + memory'],
  },
  webgpu: {
    zhTitle: 'WebGPU',
    zhSummary:
      'WebGPU 逆向分析域，支持 GPU 适配器信息、shader 编译反汇编、计时侧信道分析与内存布局检查。',
    zhScenarios: ['GPU 硬件指纹识别', 'WGSL shader 分析', 'GPU 侧信道攻击检测', 'GPU 命令队列捕获'],
    zhCombos: ['webgpu + browser', 'webgpu + instrumentation'],
    enTitle: 'WebGPU',
    enSummary:
      'WebGPU reverse analysis domain supporting GPU adapter info, shader compile/disassembly, timing side-channel analysis, and memory layout inspection.',
    enScenarios: [
      'GPU hardware fingerprinting',
      'WGSL shader analysis',
      'GPU side-channel attack detection',
      'GPU command queue capture',
    ],
    enCombos: ['webgpu + browser', 'webgpu + instrumentation'],
  },
  tasks: {
    zhTitle: '后台任务',
    zhSummary: 'MCP 2.0 Tasks 协议域：查询、轮询、取消由长耗时工具创建的后台任务。',
    zhScenarios: ['长任务状态查询', '后台任务结果获取', '任务取消'],
    zhCombos: ['tasks + binary-instrument', 'tasks + protocol-analysis'],
    enTitle: 'Background Tasks',
    enSummary:
      'MCP 2.0 Tasks protocol domain for querying, polling and cancelling background tasks created by long-running tools.',
    enScenarios: ['Task status polling', 'Background task results', 'Task cancellation'],
    enCombos: ['tasks + binary-instrument', 'tasks + protocol-analysis'],
  },
};

async function main() {
  await mkdir(zhDomainsRoot, { recursive: true });
  await mkdir(enDomainsRoot, { recursive: true });
  await clearGeneratedPages(zhDomainsRoot);
  await clearGeneratedPages(enDomainsRoot);

  const manifests = await loadManifests();
  const workflowPresets = await loadWorkflowPresets();
  const sorted = manifests.toSorted((a, b) => a.domain.localeCompare(b.domain));
  assertDomainMetadataCoverage(sorted);
  const zhToolDescriptions = await syncZhCoverage(sorted, await loadZhToolDescriptions());

  assertZhCoverage(sorted, zhToolDescriptions);

  for (const manifest of sorted) {
    await writeFile(
      join(zhDomainsRoot, `${manifest.domain}.md`),
      renderDomainPage(manifest, 'zh', zhToolDescriptions, workflowPresets),
      'utf8',
    );
    await writeFile(
      join(enDomainsRoot, `${manifest.domain}.md`),
      renderDomainPage(manifest, 'en', zhToolDescriptions, workflowPresets),
      'utf8',
    );
  }

  await writeFile(
    join(zhReferenceRoot, 'index.md'),
    renderOverview(sorted, 'zh', workflowPresets),
    'utf8',
  );
  await writeFile(
    join(enReferenceRoot, 'index.md'),
    renderOverview(sorted, 'en', workflowPresets),
    'utf8',
  );

  await writeFile(zhSidebarPath, renderSidebarModule(sorted, 'zh'), 'utf8');
  await writeFile(enSidebarPath, renderSidebarModule(sorted, 'en'), 'utf8');

  console.log(`[docs] Generated bilingual reference pages for ${sorted.length} domains`);
}

async function clearGeneratedPages(directory) {
  try {
    const files = await readdir(directory);
    await Promise.all(
      files
        .filter((file) => file.endsWith('.md'))
        .map((file) => rm(join(directory, file), { force: true })),
    );
  } catch {
    // ignore missing directories
  }
}

async function loadManifests() {
  const registryProbe = `
import { initRegistry, getAllManifests } from './src/server/registry/index.ts';

(async () => {
  await initRegistry();

  const manifests = [...getAllManifests()]
    .map((manifest) => ({
      domain: manifest.domain,
      profiles: [...manifest.profiles],
      tools: manifest.registrations.map((registration) => ({
        name: registration.tool.name,
        description: String(registration.tool.description ?? '').split(/\\r?\\n/, 1)[0] ?? '',
      })),
    }))
    .sort((left, right) => left.domain.localeCompare(right.domain));

  console.log(JSON.stringify(manifests));
})();
`;

  const tsxPackagePath = require.resolve('tsx/package.json');
  const tsxCliPath = join(dirname(tsxPackagePath), 'dist', 'cli.mjs');
  const result = spawnSync(process.execPath, [tsxCliPath, '--eval', registryProbe], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      JSHOOK_REGISTRY_PLATFORM: referenceRegistryPlatform,
      LOG_LEVEL: 'error',
    },
  });

  if (result.status !== 0) {
    const details = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`Failed to load domain manifests via tsx.${details ? `\n${details}` : ''}`);
  }

  const stdout = result.stdout.trim();
  if (!stdout) {
    throw new Error('Domain manifest probe returned empty stdout.');
  }

  return JSON.parse(stdout);
}

async function loadWorkflowPresets() {
  const presets = [];

  try {
    const entries = await readdir(workflowPresetsRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const workflowPath = join(workflowPresetsRoot, entry.name, 'workflow.js');
      try {
        await stat(workflowPath);
      } catch {
        continue;
      }

      const source = await readFile(workflowPath, 'utf8');
      const workflow = extractWorkflowPresetMetadata(source, entry.name, workflowPath);
      if (!workflow) {
        continue;
      }

      presets.push({
        ...workflow,
        source: `workflows/${entry.name}/workflow.js`,
      });
    }
  } catch {
    return [];
  }

  return presets.toSorted((left, right) => left.id.localeCompare(right.id));
}

function extractWorkflowPresetMetadata(source, fallbackId, workflowPath) {
  let ast;

  try {
    ast = parse(source, { sourceType: 'module' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse workflow preset metadata from ${workflowPath}: ${message}`, {
      cause: error,
    });
  }

  const bindings = new Map();
  let defaultExportNode = null;

  for (const statement of ast.program.body) {
    if (statement.type === 'VariableDeclaration') {
      for (const declaration of statement.declarations) {
        if (declaration.id.type === 'Identifier' && declaration.init) {
          bindings.set(declaration.id.name, declaration.init);
        }
      }
      continue;
    }

    if (statement.type === 'ExportDefaultDeclaration') {
      defaultExportNode = statement.declaration;
    }
  }

  if (!defaultExportNode) {
    return null;
  }

  const workflow = resolveStaticNode(defaultExportNode, bindings, new Set());
  if (!isPlainObject(workflow) || workflow.kind !== 'workflow-contract') {
    return null;
  }

  const route = isPlainObject(workflow.route) ? workflow.route : null;
  if (!route || route.kind !== 'preset') {
    return null;
  }

  const requiredDomains = Array.isArray(route.requiredDomains)
    ? route.requiredDomains.filter((domain) => typeof domain === 'string')
    : [];
  const steps = Array.isArray(route.steps) ? route.steps.filter((step) => isPlainObject(step)) : [];

  return {
    id: typeof workflow.id === 'string' ? workflow.id : fallbackId,
    displayName: typeof workflow.displayName === 'string' ? workflow.displayName : fallbackId,
    description: typeof workflow.description === 'string' ? workflow.description : '',
    requiredDomains,
    steps,
  };
}

function resolveStaticNode(node, bindings, seen) {
  if (!node) {
    return undefined;
  }

  switch (node.type) {
    case 'Identifier': {
      if (seen.has(node.name)) {
        return undefined;
      }

      const target = bindings.get(node.name);
      if (!target) {
        return undefined;
      }

      seen.add(node.name);
      const resolved = resolveStaticNode(target, bindings, seen);
      seen.delete(node.name);
      return resolved;
    }

    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return node.value;

    case 'NullLiteral':
      return null;

    case 'TemplateLiteral':
      if (node.expressions.length === 0) {
        return node.quasis[0]?.value.cooked ?? '';
      }
      return undefined;

    case 'RegExpLiteral':
      return `/${node.pattern}/${node.flags}`;

    case 'ArrayExpression':
      return node.elements.map((element) => {
        if (!element || element.type === 'SpreadElement') {
          return undefined;
        }
        return resolveStaticNode(element, bindings, seen);
      });

    case 'ObjectExpression': {
      const result = {};

      for (const property of node.properties) {
        if (property.type !== 'ObjectProperty' || property.computed) {
          continue;
        }

        const key = getObjectPropertyKey(property.key);
        if (!key) {
          continue;
        }

        result[key] = resolveStaticNode(property.value, bindings, seen);
      }

      return result;
    }

    default:
      return undefined;
  }
}

function getObjectPropertyKey(node) {
  if (node.type === 'Identifier') {
    return node.name;
  }

  if (node.type === 'StringLiteral' || node.type === 'NumericLiteral') {
    return String(node.value);
  }

  return null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertDomainMetadataCoverage(manifests) {
  const missing = manifests
    .map((manifest) => manifest.domain)
    .filter((domain, index, domains) => domains.indexOf(domain) === index && !META[domain]);

  if (missing.length > 0) {
    throw new Error(
      `Missing reference metadata for ${missing.length} domains: ${missing.join(', ')}`,
    );
  }
}

function getDomainMeta(domain) {
  const meta = META[domain];
  if (!meta) {
    throw new Error(`Missing reference metadata for domain "${domain}"`);
  }
  return meta;
}

async function loadZhToolDescriptions() {
  const raw = await readFile(zhTranslationsPath, 'utf8');
  return JSON.parse(raw);
}

async function syncZhCoverage(manifests, zhToolDescriptions) {
  const activeToolNames = new Set(
    manifests.flatMap((manifest) => manifest.tools.map((tool) => tool.name)),
  );
  const merged = {};
  const added = [];
  const removed = [];

  for (const [toolName, description] of Object.entries(zhToolDescriptions)) {
    if (activeToolNames.has(toolName)) {
      merged[toolName] = description;
    } else {
      removed.push(toolName);
    }
  }

  for (const manifest of manifests) {
    for (const tool of manifest.tools) {
      if (!merged[tool.name]) {
        merged[tool.name] = `${zhPlaceholderPrefix}${tool.description}`;
        added.push(`${manifest.domain}.${tool.name}`);
      }
    }
  }

  if (added.length > 0 || removed.length > 0) {
    await writeFile(zhTranslationsPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
    if (added.length > 0) {
      console.log(
        `[docs] Added ${added.length} placeholder Chinese tool descriptions: ${added
          .slice(0, 20)
          .join(', ')}`,
      );
    }
    if (removed.length > 0) {
      console.log(
        `[docs] Removed ${removed.length} stale Chinese tool descriptions: ${removed
          .slice(0, 20)
          .join(', ')}`,
      );
    }
  }

  const placeholders = [];

  for (const manifest of manifests) {
    for (const tool of manifest.tools) {
      const localized = merged[tool.name];
      if (typeof localized === 'string' && localized.startsWith(zhPlaceholderPrefix)) {
        placeholders.push(`${manifest.domain}.${tool.name}`);
      }
    }
  }

  if (placeholders.length > 0 && isCiEnvironment()) {
    throw new Error(
      `Placeholder Chinese tool descriptions remain for ${placeholders.length} tools: ${placeholders
        .slice(0, 20)
        .join(', ')}`,
    );
  }

  return merged;
}

function isCiEnvironment() {
  return process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
}

function assertZhCoverage(manifests, zhToolDescriptions) {
  const missing = [];

  for (const manifest of manifests) {
    for (const tool of manifest.tools) {
      if (!zhToolDescriptions[tool.name]) {
        missing.push(`${manifest.domain}.${tool.name}`);
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing Chinese tool descriptions for ${missing.length} tools: ${missing.slice(0, 20).join(', ')}`,
    );
  }
}
function renderOverview(manifests, locale, workflowPresets) {
  const rows = manifests
    .map((manifest) => {
      const meta = getDomainMeta(manifest.domain);
      const title = locale === 'zh' ? meta.zhTitle : meta.enTitle;
      const summary = locale === 'zh' ? meta.zhSummary : meta.enSummary;
      return `| \`${manifest.domain}\` | ${title} | ${manifest.profiles.join(', ')} | ${summary} |`;
    })
    .join('\n');
  const externalPresetIds = workflowPresets
    .slice(0, 5)
    .map((preset) => `\`${preset.id}\``)
    .join(', ');
  const externalPresetSection =
    workflowPresets.length === 0
      ? ''
      : locale === 'zh'
        ? `
## 外置 Workflow Preset

仓库根目录的 \`workflows/*/workflow.js\` 额外提供 **${workflowPresets.length}** 个 preset，已在工作流域页面单独列出。

- 示例：${externalPresetIds}${workflowPresets.length > 5 ? ' ...' : ''}
`
        : `
## External Workflow Presets

The repository-level \`workflows/*/workflow.js\` tree contributes **${workflowPresets.length}** additional presets, documented separately on the workflow domain page.

- Examples: ${externalPresetIds}${workflowPresets.length > 5 ? ' ...' : ''}
`;

  if (locale === 'zh') {
    return `# Reference Overview

当前包含以下工具域：

## 推荐阅读路径

1. 先看 \`browser / network / workflow\`，建立日常使用路径。
2. 再看 \`debugger / instrumentation / streaming\`，理解运行时分析面。
3. 最后看 \`core / sourcemap / transform / wasm / process / platform\`，覆盖更深入的逆向面。

## 域矩阵

| 域 | 标题 | 适用 profile | 典型场景 |
| --- | --- | --- | --- |
${rows}

## 重点高层入口

- \`api_probe_batch\`：批量探测 OpenAPI / Swagger / API 端点
- \`js_bundle_search\`：远程抓取 bundle 并做多模式匹配
- \`page_script_register\` / \`page_script_run\`：复用页面内脚本完成定制化采集与自动化
- \`doctor_environment\`：环境依赖与 bridge 健康检查
- \`cleanup_artifacts\`：按 retention / size 规则清理产物
- \`list_extension_workflows\` / \`run_extension_workflow\`：发现并执行外置扩展工作流
${externalPresetSection}`;
  }

  return `# Reference Overview

The following tool domains are available:

## Recommended reading order

1. Start with \`browser / network / workflow\` to understand the day-to-day path.
2. Continue with \`debugger / instrumentation / streaming\` for runtime analysis.
3. Finish with \`core / sourcemap / transform / wasm / process / platform\` for deeper reverse-engineering coverage.

## Domain matrix

| Domain | Title | Profiles | Typical use |
| --- | --- | --- | --- |
${rows}

## Key high-level entry points

- \`api_probe_batch\` — batch-probe OpenAPI / Swagger / API paths
- \`js_bundle_search\` — fetch a bundle remotely and search it with multiple patterns
- \`page_script_register\` / \`page_script_run\` — register reusable page-side snippets and execute them on demand
- \`doctor_environment\` — diagnose dependencies and local bridge health
- \`cleanup_artifacts\` — clean retained artifacts by age or size
- \`list_extension_workflows\` / \`run_extension_workflow\` — discover and execute external extension workflows
${externalPresetSection}`;
}

function renderWorkflowPresetSection(presets, locale) {
  if (presets.length === 0) {
    return '';
  }

  const rows = presets
    .map(
      (preset) =>
        `| \`${preset.id}\` | ${escapeMd(preset.displayName)} | ${escapeMd(
          preset.description || (locale === 'zh' ? '无描述' : 'No description'),
        )} | ${escapeMd(preset.source)} | ${
          preset.requiredDomains.length > 0
            ? preset.requiredDomains.map((domain) => `\`${domain}\``).join(', ')
            : '-'
        } | ${preset.steps.length} |`,
    )
    .join('\n');

  if (locale === 'zh') {
    return `\n## 外置 Preset（${presets.length}）\n\n以下 preset 来自仓库根目录的 \`workflows/*/workflow.js\`，用于路由匹配与步骤编排提示，不属于内置 manifest 注册列表。\n\n| ID | 名称 | 说明 | 来源 | 依赖域 | 步骤数 |\n| --- | --- | --- | --- | --- | --- |\n${rows}\n`;
  }

  return `\n## External presets (${presets.length})\n\nThese presets are loaded from repository-level \`workflows/*/workflow.js\` files for routing and guided step orchestration. They are intentionally separate from built-in manifest registrations.\n\n| ID | Name | Description | Source | Required domains | Steps |\n| --- | --- | --- | --- | --- | --- |\n${rows}\n`;
}

function renderDomainPage(manifest, locale, zhToolDescriptions, workflowPresets) {
  const meta = getDomainMeta(manifest.domain);
  const title = locale === 'zh' ? meta.zhTitle : meta.enTitle;
  const summary = locale === 'zh' ? meta.zhSummary : meta.enSummary;
  const scenarios = locale === 'zh' ? meta.zhScenarios : meta.enScenarios;
  const combos = locale === 'zh' ? meta.zhCombos : meta.enCombos;
  const localizedTools = manifest.tools.map((tool) => ({
    ...tool,
    localizedDescription:
      locale === 'zh'
        ? (zhToolDescriptions[tool.name] ?? `[缺少中文翻译] ${tool.description}`)
        : tool.description,
  }));
  const allRows = localizedTools
    .map((tool) => `| \`${tool.name}\` | ${escapeMd(tool.localizedDescription)} |`)
    .join('\n');
  const presetSection =
    manifest.domain === 'workflow' ? renderWorkflowPresetSection(workflowPresets, locale) : '';

  if (locale === 'zh') {
    return `# ${title}

域名：\`${manifest.domain}\`

${summary}

## Profile

${manifest.profiles.map((profile) => `- ${profile}`).join('\n')}

## 典型场景

${scenarios.map((item) => `- ${item}`).join('\n')}

## 常见组合

${combos.map((item) => `- ${item}`).join('\n')}

## 工具清单（${manifest.tools.length}）

| 工具 | 说明 |
| --- | --- |
${allRows}${presetSection}
`;
  }

  return `# ${title}

Domain: \`${manifest.domain}\`

${summary}

## Profiles

${manifest.profiles.map((profile) => `- ${profile}`).join('\n')}

## Typical scenarios

${scenarios.map((item) => `- ${item}`).join('\n')}

## Common combinations

${combos.map((item) => `- ${item}`).join('\n')}

## Full tool list (${manifest.tools.length})

| Tool | Description |
| --- | --- |
${allRows}${presetSection}
`;
}

function renderSidebarModule(manifests, locale) {
  const prefix = locale === 'zh' ? '/reference/domains' : '/en/reference/domains';
  const overviewLink = locale === 'zh' ? '/reference/' : '/en/reference/';
  const overviewText = locale === 'zh' ? '总览' : 'Overview';

  const items = [
    `  { text: '${overviewText}', link: '${overviewLink}' },`,
    ...manifests.map((manifest) => {
      const meta = getDomainMeta(manifest.domain);
      const label = locale === 'zh' ? meta.zhTitle : meta.enTitle;
      return `  { text: '${label}', link: '${prefix}/${manifest.domain}' },`;
    }),
  ];

  return `// AUTO-GENERATED BY scripts/generate-vitepress-reference.mjs
// DO NOT EDIT DIRECTLY

export const referenceSidebarItems = [
${items.join('\n')}
];
`;
}

function escapeMd(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '\\|');
}

main().catch((error) => {
  console.error(`[docs] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
