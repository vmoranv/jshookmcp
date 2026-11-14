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
  antidebug_bypass: [
    'get past anti debugging',
    'defeat the debugger detection',
    'bypass the anti debug checks',
  ],
  antidebug_detect_protections: [
    'what anti debug is active',
    'spot protection tricks',
    'detect the anti debug tricks',
  ],
  blackbox_add: [
    'skip this library while stepping',
    'mark code as library code',
    'add a blackbox function',
  ],
  blackbox_add_common: [
    'ignore common libraries when stepping',
    'blackbox vendor code',
    'common blackbox library functions',
  ],
  blackbox_list: ['which files are blackboxed', 'show ignore list', 'list the blackbox functions'],
  breakpoint: [
    'set a breakpoint here',
    'stop on this line',
    'set a breakpoint',
    'pause execution when it reaches this line',
    'halt the program at this spot',
  ],
  debugger_capture_hit: [
    'capture the breakpoint hit',
    'record pause context',
    'capture a breakpoint hit',
  ],
  debugger_disassemble: [
    'show the wasm or bytecode disassembly',
    'list low level instructions',
    'disassemble the code',
  ],
  debugger_evaluate: [
    'run an expression while paused',
    'evaluate in the paused frame',
    'evaluate inside the breakpoint',
  ],
  debugger_get_paused_state: ['why are we paused', 'current pause reason', 'show the paused state'],
  debugger_lifecycle: [
    'attach or detach the debugger',
    'manage debugger session',
    'debugger session lifecycle',
  ],
  debugger_pause: ['pause execution now', 'break into the debugger', 'pause the execution'],
  debugger_resume: ['continue execution', 'let the page keep running', 'resume the execution'],
  debugger_run_to_location: [
    'run until this spot',
    'continue up to a location',
    'run to a specific location',
  ],
  debugger_session: [
    'start a debugging session',
    'open debugger for this target',
    'open a debug session',
  ],
  debugger_step: [
    'step one instruction',
    'step into or over',
    'step through the execution one step at a time',
    'advance to the next instruction',
    'single step the debugger',
  ],
  debugger_wait_for_paused: [
    'block until a pause happens',
    'wait for breakpoint hit',
    'wait for the debugger to pause',
  ],
  get_call_stack: ['show the current call frames', 'what is on the stack', 'read the call stack'],
  get_object_properties: [
    'inspect this object fields',
    'show object shape',
    'read the object properties',
  ],
  get_scope_variables_enhanced: [
    'list variables in this scope',
    'what is in scope now',
    'read the scope variables',
  ],
  watch: ['watch this expression', 'track a value over time', 'watch an expression'],
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
