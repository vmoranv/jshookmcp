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

const META = {
  core: {
    zhTitle: 'Core',
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
  antidebug: {
    zhTitle: 'AntiDebug',
    zhSummary: '反反调试域，集中提供检测与绕过浏览器端反调试脚本的工具。',
    zhScenarios: ['调试器绕过', '计时检测缓解', '控制台/devtools 探测对抗'],
    zhCombos: ['browser + antidebug + debugger'],
    enTitle: 'AntiDebug',
    enSummary:
      'Anti-anti-debug domain focused on detecting and bypassing browser-side anti-debugging protections.',
    enScenarios: [
      'Bypass debugger traps',
      'Mitigate timing checks',
      'Counter console/devtools detection',
    ],
    enCombos: ['browser + antidebug + debugger'],
  },
  evidence: {
    zhTitle: 'Evidence',
    zhSummary: '逆向证据图域，用图结构串联 URL、脚本、函数、Hook 与捕获产物之间的溯源关系。',
    zhScenarios: [
      '按 URL / 函数 / scriptId 反查关联节点',
      '查看前向或反向 provenance chain',
      '导出 JSON / Markdown 证据报告',
    ],
    zhCombos: ['instrumentation + evidence', 'network + hooks + evidence'],
    enTitle: 'Evidence',
    enSummary:
      'Evidence-graph domain that models provenance between URLs, scripts, functions, hooks, and captured artifacts.',
    enScenarios: [
      'Query nodes by URL, function, or script ID',
      'Traverse forward or backward provenance chains',
      'Export JSON or Markdown evidence reports',
    ],
    enCombos: ['instrumentation + evidence', 'network + hooks + evidence'],
  },
  browser: {
    zhTitle: 'Browser',
    zhSummary: '浏览器控制与 DOM 交互主域，也是大多数工作流的入口。',
    zhScenarios: ['页面导航', 'DOM 操作与截图', '多标签页与本地存储读取'],
    zhCombos: ['browser + network', 'browser + hooks', 'browser + workflow'],
    enTitle: 'Browser',
    enSummary:
      'Primary browser control and DOM interaction domain; the usual entry point for most workflows.',
    enScenarios: [
      'Navigate pages',
      'Interact with the DOM and capture screenshots',
      'Work with tabs and storage',
    ],
    enCombos: ['browser + network', 'browser + hooks', 'browser + workflow'],
  },
  coordination: {
    zhTitle: 'Coordination',
    zhSummary: '用于会话洞察记录与 MCP Task Handoff 的协调域，衔接大语言模型的规划与执行。',
    zhScenarios: ['Task Handoff 任务交接', '记录会话深度分析结论'],
    zhCombos: ['coordination + workflow', 'coordination + browser'],
    enTitle: 'Coordination',
    enSummary:
      'Coordination domain for session insights and MCP Task Handoff, bridging the planning and execution boundaries of LLMs.',
    enScenarios: ['MCP Task Handoff', 'Recording deep session insights'],
    enCombos: ['coordination + workflow', 'coordination + browser'],
  },
  'shared-state-board': {
    zhTitle: 'Shared State Board',
    zhSummary: '跨 Agent 状态同步域，提供全局共享的状态板用于多 Agent 协作。',
    zhScenarios: ['跨 Agent 数据共享', '多 Agent 工作流协调', '实时状态广播'],
    zhCombos: ['shared-state-board + coordination', 'shared-state-board + workflow'],
    enTitle: 'Shared State Board',
    enSummary:
      'Cross-agent state synchronization domain providing a global shared state board for multi-agent collaboration.',
    enScenarios: [
      'Cross-agent data sharing',
      'Multi-agent workflow coordination',
      'Real-time state broadcasting',
    ],
    enCombos: ['shared-state-board + coordination', 'shared-state-board + workflow'],
  },
  debugger: {
    zhTitle: 'Debugger',
    zhSummary: '基于 CDP 的断点、单步、调用栈、watch 与调试会话管理域。',
    zhScenarios: ['断点调试', '调用帧求值', '调试会话保存/恢复'],
    zhCombos: ['debugger + hooks', 'debugger + antidebug'],
    enTitle: 'Debugger',
    enSummary:
      'CDP-based debugging domain covering breakpoints, stepping, call stacks, watches, and debugger sessions.',
    enScenarios: [
      'Set and hit breakpoints',
      'Evaluate expressions in frames',
      'Save and restore debugger sessions',
    ],
    enCombos: ['debugger + hooks', 'debugger + antidebug'],
  },
  encoding: {
    zhTitle: 'Encoding',
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
    zhTitle: 'GraphQL',
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
  hooks: {
    zhTitle: 'Hooks',
    zhSummary: 'AI Hook 生成、注入、数据导出，以及内置/自定义 preset 管理。',
    zhScenarios: ['函数调用采集', '运行时证据留存', '团队专用 inline preset'],
    zhCombos: ['browser + hooks + debugger'],
    enTitle: 'Hooks',
    enSummary: 'AI hook generation, injection, export, and built-in/custom preset management.',
    enScenarios: [
      'Capture function calls',
      'Persist runtime evidence',
      'Install team-specific inline presets',
    ],
    enCombos: ['browser + hooks + debugger'],
  },
  instrumentation: {
    zhTitle: 'Instrumentation',
    zhSummary: '统一仪器化会话域，将 Hook、拦截、Trace 与产物记录收束到可查询的 session 中。',
    zhScenarios: [
      '创建/销毁 instrumentation 会话',
      '登记 Hook / 拦截 / Trace 操作',
      '记录并查询运行时产物',
    ],
    zhCombos: ['instrumentation + hooks + network', 'instrumentation + evidence'],
    enTitle: 'Instrumentation',
    enSummary:
      'Unified instrumentation-session domain that groups hooks, intercepts, traces, and artifacts into a queryable session.',
    enScenarios: [
      'Create and destroy instrumentation sessions',
      'Register hook, intercept, and trace operations',
      'Record and query runtime artifacts',
    ],
    enCombos: ['instrumentation + hooks + network', 'instrumentation + evidence'],
  },
  maintenance: {
    zhTitle: 'Maintenance',
    zhSummary: '运维与维护域，覆盖缓存、token 预算、环境诊断、产物清理与扩展管理。',
    zhScenarios: ['依赖诊断', '产物清理', '扩展热加载'],
    zhCombos: ['maintenance + workflow', 'maintenance + extensions'],
    enTitle: 'Maintenance',
    enSummary:
      'Operations and maintenance domain covering cache hygiene, token budget, environment diagnostics, artifact cleanup, and extension management.',
    enScenarios: [
      'Diagnose dependencies',
      'Clean retained artifacts',
      'Reload plugins and workflows',
    ],
    enCombos: ['maintenance + workflow', 'maintenance + extensions'],
  },
  memory: {
    zhTitle: 'Memory',
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
    zhTitle: 'Network',
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
    zhTitle: 'Platform',
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
    zhTitle: 'Process',
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
    zhTitle: 'SourceMap',
    zhSummary: 'SourceMap 发现、抓取、解析与源码树重建。',
    zhScenarios: ['自动发现 sourcemap', '恢复源码树'],
    zhCombos: ['core + sourcemap'],
    enTitle: 'SourceMap',
    enSummary: 'Source map discovery, fetching, parsing, and source tree reconstruction.',
    enScenarios: ['Discover source maps automatically', 'Reconstruct source trees'],
    enCombos: ['core + sourcemap'],
  },
  streaming: {
    zhTitle: 'Streaming',
    zhSummary: 'WebSocket 与 SSE 监控域。',
    zhScenarios: ['WS 帧采集', 'SSE 事件监控'],
    zhCombos: ['browser + streaming + network'],
    enTitle: 'Streaming',
    enSummary: 'WebSocket and SSE monitoring domain.',
    enScenarios: ['Capture WebSocket frames', 'Monitor SSE events'],
    enCombos: ['browser + streaming + network'],
  },
  transform: {
    zhTitle: 'Transform',
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
    zhTitle: 'Workflow',
    zhSummary: '复合工作流与脚本库域，是 built-in 高层编排入口。',
    zhScenarios: ['一键 API 采集', '注册与验证流程', '批量探测与 bundle 搜索'],
    zhCombos: ['workflow + browser + network'],
    enTitle: 'Workflow',
    enSummary:
      'Composite workflow and script-library domain; the main built-in orchestration layer.',
    enScenarios: [
      'Capture APIs end-to-end',
      'Register and verify accounts',
      'Probe endpoints and inspect bundles',
    ],
    enCombos: ['workflow + browser + network'],
  },
  trace: {
    zhTitle: 'Trace',
    zhSummary: '时间旅行调试域，录制 CDP 事件并写入 SQLite，支持 SQL 查询与堆快照对比。',
    zhScenarios: ['录制浏览器事件', 'SQL 查询跟踪数据', '堆快照差异对比'],
    zhCombos: ['trace + debugger + browser'],
    enTitle: 'Trace',
    enSummary:
      'Time-travel debugging domain that records CDP events into SQLite for SQL-based querying and heap snapshot comparison.',
    enScenarios: ['Record browser events', 'Query trace data with SQL', 'Diff heap snapshots'],
    enCombos: ['trace + debugger + browser'],
  },
  macro: {
    zhTitle: 'Macro',
    zhSummary: '子代理宏编排域，将多步工具调用组合为可复用的宏流程。',
    zhScenarios: ['多步反混淆流程', '自动化分析管线', '用户自定义宏'],
    zhCombos: ['macro + core + transform'],
    enTitle: 'Macro',
    enSummary:
      'Sub-agent macro orchestration domain that chains multiple tool calls into reusable macro workflows.',
    enScenarios: [
      'Multi-step deobfuscation',
      'Automated analysis pipelines',
      'User-defined macros',
    ],
    enCombos: ['macro + core + transform'],
  },
  sandbox: {
    zhTitle: 'Sandbox',
    zhSummary: '基于 QuickJS WASM 的安全沙箱域，支持执行自定义脚本并调用 MCP 工具。',
    zhScenarios: ['安全脚本执行', '自定义分析逻辑', '隔离环境中的代码测试'],
    zhCombos: ['sandbox + core + transform'],
    enTitle: 'Sandbox',
    enSummary:
      'WASM-isolated QuickJS sandbox domain for secure custom script execution with MCP tool access.',
    enScenarios: ['Secure script execution', 'Custom analysis logic', 'Isolated code testing'],
    enCombos: ['sandbox + core + transform'],
  },
  canvas: {
    zhTitle: 'Canvas',
    zhSummary: '游戏引擎 Canvas 逆向分析域，支持 Laya/Pixi/Phaser/Cocos/Unity 等主流游戏引擎的指纹识别、场景树导出和对象拾取。',
    zhScenarios: ['游戏引擎识别与版本检测', '场景节点树导出', '坐标拾取游戏对象', '点击事件链路追踪'],
    zhCombos: ['browser + canvas + debugger', 'canvas + evidence + trace'],
    enTitle: 'Canvas',
    enSummary:
      'Canvas game engine reverse analysis domain supporting Laya, Pixi, Phaser, Cocos, and Unity engines for fingerprinting, scene tree dumping, and object picking.',
    enScenarios: [
      'Game engine fingerprinting and version detection',
      'Scene node tree export',
      'Coordinate-based object picking',
      'Click event handler tracing',
    ],
    enCombos: ['browser + canvas + debugger', 'canvas + evidence + trace'],
  },
  'shared-state-board': {
    zhTitle: 'Shared State Board',
    zhSummary: '跨域协作状态同步域，提供跨域状态共享、团队协作和事件广播能力。',
    zhScenarios: ['跨域状态共享', '团队协作协调', '事件广播与订阅'],
    zhCombos: ['browser + network + coordination', 'shared-state-board + instrumentation'],
    enTitle: 'Shared State Board',
    enSummary:
      'Cross-domain coordination domain providing shared state synchronization, team collaboration, and event broadcasting capabilities.',
    enScenarios: [
      'Cross-domain state synchronization',
      'Team collaboration coordination',
      'Event broadcasting and subscription',
    ],
    enCombos: ['browser + network + coordination', 'shared-state-board + instrumentation'],
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
  const merged = { ...zhToolDescriptions };
  const added = [];

  for (const manifest of manifests) {
    for (const tool of manifest.tools) {
      if (!merged[tool.name]) {
        merged[tool.name] = `${zhPlaceholderPrefix}${tool.description}`;
        added.push(`${manifest.domain}.${tool.name}`);
      }
    }
  }

  if (added.length > 0) {
    await writeFile(zhTranslationsPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
    console.log(
      `[docs] Added ${added.length} placeholder Chinese tool descriptions: ${added
        .slice(0, 20)
        .join(', ')}`,
    );
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
  const totalTools = manifests.reduce((sum, manifest) => sum + manifest.tools.length, 0);
  const rows = manifests
    .map((manifest) => {
      const meta = getDomainMeta(manifest.domain);
      const title = locale === 'zh' ? meta.zhTitle : meta.enTitle;
      const summary = locale === 'zh' ? meta.zhSummary : meta.enSummary;
      return `| \`${manifest.domain}\` | ${title} | ${manifest.tools.length} | ${manifest.profiles.join(', ')} | ${summary} |`;
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

当前内置域共 **${manifests.length}** 个，域工具总数 **${totalTools}**。

## 推荐阅读路径

1. 先看 \`browser / network / workflow\`，建立日常使用路径。
2. 再看 \`debugger / hooks / streaming\`，理解运行时分析面。
3. 最后看 \`core / sourcemap / transform / wasm / process / platform\`，覆盖更深入的逆向面。

## 域矩阵

| 域 | 标题 | 工具数 | 适用 profile | 典型场景 |
| --- | --- | ---: | --- | --- |
${rows}

## 重点高层入口

- \`web_api_capture_session\`：一键抓请求、提取 auth、导出 HAR/报告
- \`register_account_flow\`：注册 + 邮箱验证流程
- \`api_probe_batch\`：批量探测 OpenAPI / Swagger / API 端点
- \`js_bundle_search\`：远程抓取 bundle 并做多模式匹配
- \`doctor_environment\`：环境依赖与 bridge 健康检查
- \`cleanup_artifacts\`：按 retention / size 规则清理产物
${externalPresetSection}`;
  }

  return `# Reference Overview

There are **${manifests.length}** built-in domains and **${totalTools}** domain tools in the current build.

## Recommended reading order

1. Start with \`browser / network / workflow\` to understand the day-to-day path.
2. Continue with \`debugger / hooks / streaming\` for runtime analysis.
3. Finish with \`core / sourcemap / transform / wasm / process / platform\` for deeper reverse-engineering coverage.

## Domain matrix

| Domain | Title | Tool count | Profiles | Typical use |
| --- | --- | ---: | --- | --- |
${rows}

## Key high-level entry points

- \`web_api_capture_session\` — capture APIs, extract auth, and export HAR/report
- \`register_account_flow\` — registration plus email verification flow
- \`api_probe_batch\` — batch-probe OpenAPI / Swagger / API paths
- \`js_bundle_search\` — fetch a bundle remotely and search it with multiple patterns
- \`doctor_environment\` — diagnose dependencies and local bridge health
- \`cleanup_artifacts\` — clean retained artifacts by age or size
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
  const representative = localizedTools.slice(0, Math.min(10, localizedTools.length));
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

## 代表工具

${representative.map((tool) => `- \`${tool.name}\` — ${tool.localizedDescription}`).join('\n')}

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

## Representative tools

${representative.map((tool) => `- \`${tool.name}\` — ${tool.localizedDescription}`).join('\n')}

## Full tool list (${manifest.tools.length})

| Tool | Description |
| --- | --- |
${allRows}${presetSection}
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
