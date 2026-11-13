import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import { debuggerTools } from '@server/domains/debugger/definitions';
import { antidebugTools } from '@server/domains/debugger/antidebug/definitions';
import type { DebuggerToolHandlers } from '@server/domains/debugger/index';
import type { AntiDebugToolHandlers } from '@server/domains/debugger/antidebug/index';
import { ensureDebuggerCore } from '@server/registry/ensure-debugger-core';

const DOMAIN = 'debugger' as const;
const DEP_KEY = 'debuggerHandlers' as const;
const SECONDARY_DEP_KEYS = ['antidebugHandlers'] as const;
type H = DebuggerToolHandlers;
const t = toolLookup(debuggerTools);
const at = toolLookup(antidebugTools);
const registrations = [
  ...defineMethodRegistrations<H, (typeof debuggerTools)[number]['name']>({
    domain: DOMAIN,
    depKey: DEP_KEY,
    lookup: t,
    entries: [
      { tool: 'debugger_lifecycle', method: 'handleDebuggerLifecycle' },
      { tool: 'debugger_pause', method: 'handleDebuggerPause' },
      { tool: 'debugger_resume', method: 'handleDebuggerResume' },
      { tool: 'debugger_run_to_location', method: 'handleDebuggerRunToLocation' },
      { tool: 'debugger_step', method: 'handleDebuggerStep' },
      { tool: 'breakpoint', method: 'handleBreakpoint' },
      { tool: 'get_call_stack', method: 'handleGetCallStack' },
      { tool: 'debugger_disassemble', method: 'handleDebuggerDisassemble' },
      { tool: 'debugger_evaluate', method: 'handleDebuggerEvaluateDispatch' },
      { tool: 'debugger_wait_for_paused', method: 'handleDebuggerWaitForPaused' },
      { tool: 'debugger_capture_hit', method: 'handleDebuggerCaptureHit' },
      { tool: 'debugger_get_paused_state', method: 'handleDebuggerGetPausedState' },
      { tool: 'get_object_properties', method: 'handleGetObjectProperties' },
      { tool: 'get_scope_variables_enhanced', method: 'handleGetScopeVariablesEnhanced' },
      { tool: 'debugger_session', method: 'handleDebuggerSession' },
      { tool: 'watch', method: 'handleWatch' },
      { tool: 'blackbox_add', method: 'handleBlackboxAdd' },
      { tool: 'blackbox_add_common', method: 'handleBlackboxAddCommon' },
      { tool: 'blackbox_list', method: 'handleBlackboxList' },
    ],
  }),
  ...defineMethodRegistrations<AntiDebugToolHandlers, (typeof antidebugTools)[number]['name']>({
    domain: DOMAIN,
    depKey: 'antidebugHandlers',
    lookup: at,
    entries: [
      { tool: 'antidebug_bypass', method: 'handleAntidebugBypass', profiles: ['full'] },
      {
        tool: 'antidebug_detect_protections',
        method: 'handleAntiDebugDetectProtections',
        profiles: ['full'],
      },
    ],
  }),
];

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { DebuggerToolHandlers } = await import('@server/domains/debugger/index');
  await ensureDebuggerCore(ctx);
  if (!ctx.debuggerHandlers) {
    const pageController = ctx.pageController;
    ctx.debuggerHandlers = new DebuggerToolHandlers(
      ctx.debuggerManager!,
      ctx.runtimeInspector!,
      ctx.eventBus,
      pageController ? async () => pageController.getPage() : undefined,
    );
  }

  // Secondary: antidebugHandlers
  if (!ctx.antidebugHandlers) {
    const { AntiDebugToolHandlers } = await import('@server/domains/debugger/antidebug/index');
    ctx.antidebugHandlers = new AntiDebugToolHandlers(ctx.collector!);
  }

  return ctx.debuggerHandlers!;
}

// ── Document-expansion keywords (search retrieval layer) ──
// Query phrases bridging user vocabulary to this tool's vocabulary without
// duplicating name/description tokens. Folded into generated-tool-catalog by
// scripts/generate-domains-index.mjs; weighted SEARCH_SCENE_KEYWORD_WEIGHT.
const SCENE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  antidebug_bypass: ['get past anti debugging', 'defeat the debugger detection', '绕过反调试'],
  antidebug_detect_protections: [
    'what anti debug is active',
    'spot protection tricks',
    '检测反调试',
  ],
  blackbox_add: ['skip this library while stepping', 'mark code as library code', '加入黑盒'],
  blackbox_add_common: [
    'ignore common libraries when stepping',
    'blackbox vendor code',
    '黑盒常见库',
  ],
  blackbox_list: ['which files are blackboxed', 'show ignore list', '列出黑盒'],
  breakpoint: ['set a breakpoint here', 'stop on this line', '下断点'],
  debugger_capture_hit: ['capture the breakpoint hit', 'record pause context', '捕获断点命中'],
  debugger_disassemble: [
    'show the wasm or bytecode disassembly',
    'list low level instructions',
    '反汇编',
  ],
  debugger_evaluate: [
    'run an expression while paused',
    'evaluate in the paused frame',
    '断点内求值',
  ],
  debugger_get_paused_state: ['why are we paused', 'current pause reason', '暂停状态'],
  debugger_lifecycle: [
    'attach or detach the debugger',
    'manage debugger session',
    '调试器生命周期',
  ],
  debugger_pause: ['pause execution now', 'break into the debugger', '暂停执行'],
  debugger_resume: ['continue execution', 'let the page keep running', '恢复执行'],
  debugger_run_to_location: ['run until this spot', 'continue up to a location', '运行到指定位置'],
  debugger_session: ['start a debugging session', 'open debugger for this target', '开调试会话'],
  debugger_step: ['step one instruction', 'step into or over', '单步执行'],
  debugger_wait_for_paused: ['block until a pause happens', 'wait for breakpoint hit', '等待暂停'],
  get_call_stack: ['show the current call frames', 'what is on the stack', '调用栈'],
  get_object_properties: ['inspect this object fields', 'show object shape', '对象属性'],
  get_scope_variables_enhanced: [
    'list variables in this scope',
    'what is in scope now',
    '作用域变量',
  ],
  watch: ['watch this expression', 'track a value over time', '监视表达式'],
};

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  secondaryDepKeys: SECONDARY_DEP_KEYS,
  profiles: ['workflow', 'full'],
  ensure,

  prerequisites: {
    debugger_lifecycle: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
    ],
    breakpoint: [
      {
        condition: 'Browser must be launched',
        fix: 'Call browser_launch and debugger_lifecycle(enable) first',
      },
    ],
    debugger_run_to_location: [
      {
        condition: 'Browser must be launched',
        fix: 'Call browser_launch and debugger_lifecycle(enable) first',
      },
    ],
    debugger_disassemble: [
      {
        condition: 'Browser must be launched and debugger enabled',
        fix: 'Call browser_launch and debugger_lifecycle(enable); pause at a breakpoint or pass scriptId',
      },
    ],
  },

  registrations,

  // Document-expansion keywords for the retrieval layer (SCENE_KEYWORDS above).
  sceneKeywords: SCENE_KEYWORDS,
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
