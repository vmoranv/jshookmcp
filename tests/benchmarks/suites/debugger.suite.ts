/**
 * Debugger domain benchmark (offline blackbox pattern subset — no live browser required).
 *
 * Ground truth:
 *  - blackbox_add: normalizes shell wildcard (e.g. *react*.js -> .*react.*\.js) into regex
 *  - blackbox_add_common: installs 13 standard vendor library patterns (react, vue, lodash, etc.)
 *  - blackbox_list: returns all active blackboxed regex patterns in deterministic array
 */
import { BlackboxHandlers } from '@server/domains/debugger/handlers/blackbox-handlers';
import { BlackboxManager } from '@modules/debugger/BlackboxManager';
import { DebuggerToolHandlers } from '@server/domains/debugger/handlers';
import { AntiDebugToolHandlers } from '@server/domains/debugger/antidebug/handlers';
import { body, expectSuccess, type BenchSuite } from '../harness';

function createBlackboxFixture() {
  const cdpSession = {
    send: async () => ({}),
  } as never;
  const blackboxManager = new BlackboxManager(cdpSession);
  const debuggerManager = {
    ensureAdvancedFeatures: async () => {},
    getBlackboxManager: () => blackboxManager,
  } as never;
  const handlers = new BlackboxHandlers({ debuggerManager });
  return { blackboxManager, handlers };
}

/**
 * Stub CDP debugger stack for the contract cases.
 *
 * Every tool below is exercised through its REAL handler with an injected
 * `DebuggerManager` whose methods are deterministic no-ops. That isolates the
 * logic under test — argument/dispatch validation, "not enabled" and
 * "not paused" admission, pause/resume reporting, blackbox registry wiring —
 * from CDP. Nothing here fabricates a paused state: `waitForPaused` returns
 * null / throws exactly like an idle debugger, so "no live debugger" answers
 * stay honest.
 */
interface DebuggerStubOptions {
  paused?: {
    reason: string;
    callFrames: Array<{
      callFrameId?: string;
      functionName?: string;
      url?: string;
      location?: { scriptId: string; lineNumber: number; columnNumber?: number };
    }>;
    hitBreakpoints?: string[];
  } | null;
  waitThrows?: Error;
  enabled?: boolean;
}

function createDebuggerFixture(options: DebuggerStubOptions = {}) {
  const state = {
    enabled: options.enabled ?? false,
    paused: options.paused ?? null,
    calls: [] as string[],
  };
  const breakpoints: Array<Record<string, unknown>> = [];

  const eventManager = {
    setEventListenerBreakpoint: async () => 'bp-event-1',
    removeEventListenerBreakpoint: async () => undefined,
    setEventListenerBreakpointsByCategory: async () => ['bp-cat-1'],
  };
  const xhrManager = {
    setXHRBreakpoint: async () => 'bp-xhr-1',
    removeXHRBreakpoint: async () => undefined,
    listXHRBreakpoints: () => [],
  };
  const watchManager = {
    addWatch: () => ({ id: 'w1' }),
    removeWatch: () => true,
    listWatches: () => [],
    getAllWatches: () => [],
    evaluateAll: async () => [],
  };

  const debuggerManager = {
    init: async () => void (state.enabled = true),
    initAdvancedFeatures: async () => undefined,
    enable: async () => void (state.enabled = true),
    disable: async () => void (state.enabled = false),
    ensureAdvancedFeatures: async () => undefined,
    isEnabled: () => state.enabled,
    getEventManager: () => eventManager,
    getXHRManager: () => xhrManager,
    getWatchManager: () => watchManager,
    getBlackboxManager: () => new BlackboxManager({ send: async () => ({}) } as never),
    setBreakpoint: async () => {
      const id = `bp-${breakpoints.length + 1}`;
      breakpoints.push({ breakpointId: id });
      return { breakpointId: id };
    },
    removeBreakpoint: async () => {
      breakpoints.pop();
      return true;
    },
    listBreakpoints: () => [...breakpoints],
    setPauseOnExceptions: async () => undefined,
    pause: async () => {
      state.calls.push('pause');
      if (!state.paused) state.paused = { reason: 'other', callFrames: [], hitBreakpoints: [] };
    },
    resume: async () => {
      state.calls.push('resume');
      state.paused = null;
    },
    stepInto: async () => void state.calls.push('stepInto'),
    stepOver: async () => void state.calls.push('stepOver'),
    stepOut: async () => void state.calls.push('stepOut'),
    getPausedState: () => state.paused,
    listSavedSessions: async () => [],
    waitForPaused: async () => {
      if (options.waitThrows) throw options.waitThrows;
      if (!state.paused) throw new Error('Timeout waiting for paused event');
      return state.paused;
    },
  };

  const runtimeInspector = {
    init: async () => undefined,
    evaluate: async (expression: string) => ({ success: true, result: { value: expression } }),
    getProperties: async () => [],
    getCallStack: async () => (state.paused ? { callFrames: state.paused.callFrames } : null),
  };

  const handlers = new DebuggerToolHandlers(debuggerManager as never, runtimeInspector as never);
  return { handlers, state, breakpoints };
}

/** Call a debugger tool and flatten the ToolResponse; handler throws become text. */
async function callDebugger(
  run: () => Promise<unknown>,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; text: string }> {
  try {
    const response = await run();
    return { ok: true, body: body(response) };
  } catch (error) {
    return { ok: false, text: error instanceof Error ? error.message : String(error) };
  }
}

export const debuggerSuite: BenchSuite = {
  name: 'debugger-blackbox',
  domain: 'debugger',
  description:
    'Offline-pure blackbox pattern registry: wildcard normalization, common library presets, pattern listing',
  cases: [
    {
      name: 'blackbox_add/normalizes-wildcard-pattern',
      tool: 'blackbox_add',
      origin: 'homemade',
      reference: 'normalizes shell wildcard *react*.js to regex pattern and confirms addition',
      run: () => {
        const { handlers } = createBlackboxFixture();
        return handlers.handleBlackboxAdd({ urlPattern: '*react*.js' });
      },
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (b.success !== true || b.urlPattern !== '*react*.js')
          return `unexpected blackbox_add response: ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'blackbox_add_common/installs-vendor-presets',
      tool: 'blackbox_add_common',
      origin: 'homemade',
      reference:
        'installs standard vendor library patterns (jquery, react, vue, angular, lodash, webpack)',
      run: () => {
        const { handlers } = createBlackboxFixture();
        return handlers.handleBlackboxAddCommon({});
      },
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (b.success !== true)
          return `unexpected blackbox_add_common response: ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'blackbox_list/enumerates-patterns',
      tool: 'blackbox_list',
      origin: 'homemade',
      reference: 'lists all registered normalized blackbox patterns',
      run: async () => {
        const { handlers } = createBlackboxFixture();
        await handlers.handleBlackboxAddCommon({});
        await handlers.handleBlackboxAdd({ urlPattern: '*custom-auth*.js' });
        return handlers.handleBlackboxList({});
      },
      validate: (v: unknown) => {
        const b = expectSuccess(v);
        if (b.success !== true || !Array.isArray(b.patterns))
          return `expected patterns array, got: ${JSON.stringify(b)}`;
        if (b.patterns.length < 13)
          return `expected >=13 patterns after add_common + custom, got ${b.patterns.length}`;
        const text = JSON.stringify(b.patterns);
        if (!text.includes('custom-auth')) return 'missing custom pattern in blackbox_list output';
        return true;
      },
    },

    // ── Contract batch 2026-11-12 (autoresearch) ────────────────────────────
    // 18 debugger tools are CDP-bound. Each case drives the real handler with an
    // injected DebuggerManager stub and asserts the admission/dispatch logic:
    // arg validation by name, "not enabled"/"not paused" honesty, pause/resume
    // reporting, and the blackbox registry path.
    {
      name: 'debugger_lifecycle/rejects-unknown-action',
      tool: 'debugger_lifecycle',
      origin: 'homemade',
      reference:
        'dispatch contract: lifecycle accepts only enable/disable and names both when given anything else',
      run: async () => {
        const { handlers } = createDebuggerFixture();
        return callDebugger(() => handlers.handleDebuggerLifecycle({ action: 'restart' }));
      },
      validate: (v) => expectRefusal(v, /enable, disable/),
    },
    {
      name: 'debugger_lifecycle/enable-reports-enabled',
      tool: 'debugger_lifecycle',
      origin: 'homemade',
      reference:
        'lifecycle contract: enable initializes the manager and reports the resulting enabled state',
      run: async () => {
        const { handlers, state } = createDebuggerFixture();
        const result = await callDebugger(() =>
          handlers.handleDebuggerLifecycle({ action: 'enable' }),
        );
        return { result, enabled: state.enabled };
      },
      validate: (v) => {
        const r = v as Record<string, unknown>;
        if (r['enabled'] !== true) return `manager should be enabled after the call`;
        const res = r['result'] as { ok: boolean; body?: Record<string, unknown>; text?: string };
        if (!res?.ok) return `enable threw: ${res?.text}`;
        return expectBodyMentions(res.body, /enabl/i);
      },
    },
    {
      name: 'debugger_pause/reports-pause-outcome',
      tool: 'debugger_pause',
      origin: 'homemade',
      reference:
        'pause contract: the handler requests a pause and answers with the observed pause state (message + paused flag), never inventing a stack',
      run: async () => {
        const { handlers, state } = createDebuggerFixture();
        const result = await callDebugger(() => handlers.handleDebuggerPause({}));
        return { result, calls: state.calls };
      },
      validate: (v) => {
        const r = v as Record<string, unknown>;
        const calls = r['calls'] as string[];
        if (!calls.includes('pause')) return `pause was not requested: ${JSON.stringify(calls)}`;
        const res = r['result'] as { ok: boolean; body?: Record<string, unknown>; text?: string };
        if (!res?.ok) return `pause threw: ${res?.text}`;
        if (typeof res.body?.['message'] !== 'string')
          return `message missing: ${JSON.stringify(res.body)}`;
        if (res.body?.['callFrames'] !== undefined) return `must not fabricate call frames`;
        return true;
      },
    },
    {
      name: 'debugger_resume/reports-resume-outcome',
      tool: 'debugger_resume',
      origin: 'homemade',
      reference:
        'resume contract: the handler calls resume and states whether the debugger had been paused',
      run: async () => {
        const { handlers, state } = createDebuggerFixture();
        const result = await callDebugger(() => handlers.handleDebuggerResume({}));
        return { result, calls: state.calls };
      },
      validate: (v) => {
        const r = v as Record<string, unknown>;
        const calls = r['calls'] as string[];
        if (!calls.includes('resume')) return `resume was not requested: ${JSON.stringify(calls)}`;
        const res = r['result'] as { ok: boolean; body?: Record<string, unknown>; text?: string };
        if (!res?.ok) return `resume threw: ${res?.text}`;
        return typeof res.body?.['message'] === 'string'
          ? true
          : `message missing: ${JSON.stringify(res.body)}`;
      },
    },
    {
      name: 'debugger_run_to_location/requires-lineNumber',
      tool: 'debugger_run_to_location',
      origin: 'homemade',
      reference:
        'argument contract: run_to_location needs a line number and rejects the call by name without it',
      run: async () => {
        const { handlers } = createDebuggerFixture();
        return callDebugger(() => handlers.handleDebuggerRunToLocation({}));
      },
      validate: (v) => expectRefusal(v, /lineNumber/),
    },
    {
      name: 'debugger_step/refused-while-disabled',
      tool: 'debugger_step',
      origin: 'homemade',
      reference:
        'admission contract: stepping needs an enabled debugger and reports "Debugger not enabled" rather than silently doing nothing',
      run: async () => {
        const { handlers } = createDebuggerFixture({ enabled: false });
        return callDebugger(() => handlers.handleDebuggerStep({ direction: 'over' }));
      },
      validate: (v) => expectRefusal(v, /Debugger not enabled/i),
    },
    {
      name: 'breakpoint/rejects-unknown-action',
      tool: 'breakpoint',
      origin: 'homemade',
      reference:
        'dispatch contract: the unified breakpoint tool lists the valid types when given an invalid action/type pair',
      run: async () => {
        const { handlers } = createDebuggerFixture();
        return callDebugger(() => handlers.handleBreakpoint({ action: 'toggle', type: 'code' }));
      },
      validate: (v) => expectRefusal(v, /Valid types: code/i),
    },
    {
      name: 'breakpoint/list-empty-when-none-set',
      tool: 'breakpoint',
      origin: 'homemade',
      reference:
        'list contract: with no breakpoints set the listing is an empty array with count 0 — no placeholder entries',
      run: async () => {
        const { handlers } = createDebuggerFixture();
        return callDebugger(() => handlers.handleBreakpoint({ action: 'list' }));
      },
      validate: (v) => {
        const res = v as { ok: boolean; body?: Record<string, unknown>; text?: string };
        if (!res?.ok) return `list threw: ${res.text}`;
        if (res.body?.['count'] !== 0) return `count should be 0: ${JSON.stringify(res.body)}`;
        const list = res.body?.['breakpoints'] as unknown[] | undefined;
        return Array.isArray(list) && list.length === 0
          ? true
          : `breakpoints must be an empty array`;
      },
    },
    {
      name: 'get_call_stack/not-paused-honest',
      tool: 'get_call_stack',
      origin: 'homemade',
      reference:
        'admission contract: with no paused call stack the tool answers success=false and tells the caller to set a breakpoint — never an empty "successful" stack',
      run: async () => {
        const { handlers } = createDebuggerFixture();
        return callDebugger(() => handlers.handleGetCallStack({}));
      },
      validate: (v) => {
        const res = v as { ok: boolean; body?: Record<string, unknown>; text?: string };
        if (!res?.ok) return `call stack threw: ${res.text}`;
        if (res.body?.['success'] !== false)
          return `expected success=false when not paused: ${JSON.stringify(res.body)}`;
        return /paused state|breakpoint/i.test(String(res.body?.['message'] ?? ''))
          ? true
          : `message should explain the pause prerequisite`;
      },
    },
    {
      name: 'debugger_get_paused_state/not-paused-honest',
      tool: 'debugger_get_paused_state',
      origin: 'homemade',
      reference:
        'admission contract: paused-state inspection with no paused frame reports "not paused" instead of returning a fabricated pause reason',
      run: async () => {
        const { handlers } = createDebuggerFixture();
        return callDebugger(() => handlers.handleDebuggerGetPausedState({}));
      },
      validate: (v) => {
        const res = v as { ok: boolean; body?: Record<string, unknown>; text?: string };
        if (!res?.ok) return `paused state threw: ${res.text}`;
        const text = JSON.stringify(res.body);
        if (!/not paused|no paused/i.test(text))
          return `expected a not-paused answer: ${text.slice(0, 200)}`;
        if (res.body?.['reason'] !== undefined) return `must not report a pause reason when idle`;
        return true;
      },
    },
    {
      name: 'debugger_wait_for_paused/reports-timeout-honestly',
      tool: 'debugger_wait_for_paused',
      origin: 'homemade',
      reference:
        'wait contract: when no pause arrives the handler reports success=false with the timeout text (or throws a classified error) — it never claims a pause',
      run: async () => {
        const { handlers } = createDebuggerFixture({ paused: null });
        return callDebugger(() => handlers.handleDebuggerWaitForPaused({ timeout: 1 }));
      },
      validate: (v) => {
        const res = v as { ok: boolean; body?: Record<string, unknown>; text?: string };
        if (!res.ok) {
          return /Timeout waiting for paused/i.test(res.text)
            ? true
            : `unexpected throw: ${res.text}`;
        }
        if (res.body?.['paused'] !== false && res.body?.['success'] !== false)
          return `must not report a pause: ${JSON.stringify(res.body)}`;
        return true;
      },
    },
    {
      name: 'debugger_capture_hit/no-pause-no-frames',
      tool: 'debugger_capture_hit',
      origin: 'homemade',
      reference:
        'capture contract: without a pause the capture reports failure with zero frames captured instead of inventing a stack snapshot',
      run: async () => {
        const { handlers } = createDebuggerFixture({ paused: null });
        return callDebugger(() => handlers.handleDebuggerCaptureHit({ timeout: 1 }));
      },
      validate: (v) => {
        const res = v as { ok: boolean; body?: Record<string, unknown>; text?: string };
        if (!res.ok) {
          return /Timeout waiting for paused/i.test(res.text)
            ? true
            : `unexpected throw: ${res.text}`;
        }
        if (res.body?.['success'] !== false)
          return `expected failure without a pause: ${JSON.stringify(res.body).slice(0, 200)}`;
        const frames = res.body?.['frames'] ?? res.body?.['callFrames'];
        if (Array.isArray(frames) && frames.length !== 0) return `must not invent frames`;
        return true;
      },
    },
    {
      name: 'debugger_disassemble/requires-scriptId-or-pause',
      tool: 'debugger_disassemble',
      origin: 'homemade',
      reference:
        'admission contract: disassembly needs a resolved script (explicit scriptId or a paused location) and says so when neither is available',
      run: async () => {
        const { handlers } = createDebuggerFixture({ paused: null });
        return callDebugger(() => handlers.handleDebuggerDisassemble({}));
      },
      validate: (v) => expectRefusal(v, /scriptId|pause at a breakpoint/i),
    },
    {
      name: 'debugger_evaluate/global-context-returns-result',
      tool: 'debugger_evaluate',
      origin: 'homemade',
      reference:
        'evaluate contract: the global context path evaluates the expression and returns its result without needing a paused frame',
      run: async () => {
        const { handlers } = createDebuggerFixture();
        return callDebugger(() =>
          handlers.handleDebuggerEvaluate({ expression: '1+1', context: 'global' }),
        );
      },
      validate: (v) => {
        const res = v as { ok: boolean; body?: Record<string, unknown>; text?: string };
        if (!res?.ok) return `evaluate threw: ${res.text}`;
        if (res.body?.['success'] !== true) return `expected success: ${JSON.stringify(res.body)}`;
        if (res.body?.['result'] === undefined) return `result missing`;
        return true;
      },
    },
    {
      name: 'get_object_properties/requires-objectId',
      tool: 'get_object_properties',
      origin: 'homemade',
      reference:
        'argument contract: property inspection needs an objectId from a paused scope and rejects the call by name without one',
      run: async () => {
        const { handlers } = createDebuggerFixture();
        return callDebugger(() => handlers.handleGetObjectProperties({}));
      },
      validate: (v) => expectRefusal(v, /objectId/),
    },
    {
      name: 'get_scope_variables_enhanced/requires-frame-context',
      tool: 'get_scope_variables_enhanced',
      origin: 'homemade',
      reference:
        'admission contract: scope inspection needs a paused frame (or callFrameId) and reports the missing prerequisite instead of empty scopes',
      run: async () => {
        const { handlers } = createDebuggerFixture({ paused: null });
        return callDebugger(() => handlers.handleGetScopeVariablesEnhanced({}));
      },
      validate: (v) => {
        const res = v as { ok: boolean; body?: Record<string, unknown>; text?: string };
        if (!res.ok) return res.text.length > 0 ? true : `threw without a message`;
        if (res.body?.['success'] === false) {
          return String(res.body?.['error'] ?? res.body?.['message'] ?? '').length > 0
            ? true
            : `failure without a named reason`;
        }
        const scopes = res.body?.['scopes'];
        if (Array.isArray(scopes) && scopes.length === 0)
          return `must not report empty scopes as success`;
        return true;
      },
    },
    {
      name: 'watch/list-empty-when-none-added',
      tool: 'watch',
      origin: 'homemade',
      reference: 'list contract: an empty watch registry reports zero watches (no synthetic rows)',
      run: async () => {
        const { handlers } = createDebuggerFixture();
        return callDebugger(() => handlers.handleWatch({ action: 'list' }));
      },
      validate: (v) => {
        const res = v as { ok: boolean; body?: Record<string, unknown>; text?: string };
        if (!res?.ok) return `watch list threw: ${res.text}`;
        const watches = res.body?.['watches'] ?? res.body?.['expressions'];
        if (Array.isArray(watches)) return watches.length === 0 ? true : `expected no watches`;
        return res.body?.['count'] === 0
          ? true
          : `expected an empty watch listing: ${JSON.stringify(res.body)}`;
      },
    },
    {
      name: 'debugger_session/lists-no-persisted-sessions',
      tool: 'debugger_session',
      origin: 'homemade',
      reference:
        'persistence contract: listing with nothing saved reports zero sessions rather than a fabricated session entry',
      run: async () => {
        const { handlers } = createDebuggerFixture();
        return callDebugger(() => handlers.handleDebuggerSession({ action: 'list' }));
      },
      validate: (v) => {
        const res = v as { ok: boolean; body?: Record<string, unknown>; text?: string };
        if (!res?.ok) return `session list threw: ${res.text}`;
        const sessions = res.body?.['sessions'];
        if (Array.isArray(sessions)) return sessions.length === 0 ? true : `expected no sessions`;
        return res.body?.['count'] === 0
          ? true
          : `expected zero sessions: ${JSON.stringify(res.body)}`;
      },
    },
    {
      name: 'antidebug_detect_protections/reports-page-findings',
      tool: 'antidebug_detect_protections',
      origin: 'homemade',
      reference:
        'detection contract: the in-page probe findings (protections/count/evidence) are surfaced verbatim, with nothing invented host-side',
      run: () => runAntidebugDetect(),
      validate: (v) => {
        const b = v as Record<string, unknown>;
        if (b['success'] === false) return `detect failed: ${JSON.stringify(b).slice(0, 160)}`;
        if (b['detected'] !== true || b['count'] !== 2)
          return `probe findings not surfaced: ${JSON.stringify(b).slice(0, 200)}`;
        const protections = b['protections'] as string[];
        if (!Array.isArray(protections) || !protections.includes('timing'))
          return `protections not carried through: ${JSON.stringify(protections)}`;
        return true;
      },
    },
    {
      name: 'antidebug_bypass/all-injects-four-scripts',
      tool: 'antidebug_bypass',
      origin: 'homemade',
      reference:
        'bypass contract: the "all" path reports every applied bypass type and injects one script per type into the current page and per new document',
      run: () => runAntidebugBypass({}),
      validate: (v) => {
        const r = v as Record<string, unknown>;
        const b = r['body'] as Record<string, unknown>;
        if (b['success'] !== true) return `bypass failed: ${JSON.stringify(b).slice(0, 200)}`;
        const injected = b['injected'] as string[];
        if (!Array.isArray(injected) || injected.length !== 4)
          return `expected 4 injected bypasses, got ${JSON.stringify(injected)}`;
        for (const kind of [
          'bypassDebuggerStatement',
          'bypassTiming',
          'bypassStackTrace',
          'bypassConsoleDetect',
        ]) {
          if (!injected.includes(kind)) return `missing bypass ${kind}`;
        }
        if (Number(r['perDocument']) !== 4) return `expected 4 evaluateOnNewDocument scripts`;
        return true;
      },
    },
    {
      name: 'antidebug_bypass/single-type-applies-only-that-script',
      tool: 'antidebug_bypass',
      origin: 'homemade',
      reference:
        'bypass contract: requesting one type applies exactly that bypass and honours persistent=false (current page only)',
      run: () => runAntidebugBypass({ types: ['timing'], maxDrift: 20, persistent: false }),
      validate: (v) => {
        const r = v as Record<string, unknown>;
        const b = r['body'] as Record<string, unknown>;
        if (b['success'] !== true) return `bypass failed: ${JSON.stringify(b).slice(0, 200)}`;
        const applied = b['applied'] as string[];
        if (!Array.isArray(applied) || applied.length !== 1 || applied[0] !== 'timing')
          return `expected only the timing bypass, got ${JSON.stringify(applied)}`;
        if (b['persistent'] !== false) return `persistent flag not reported as false`;
        if (Number(r['perDocument']) !== 0)
          return `persistent=false must not inject per-document scripts`;
        return true;
      },
    },
  ],
};

/** Assert a handler rejected the call by naming the expected token. */
function expectRefusal(v: unknown, expect: RegExp): true | string {
  const res = v as { ok: boolean; body?: Record<string, unknown>; text?: string };
  const text = res.ok ? JSON.stringify(res.body) : String(res.text);
  return expect.test(text) ? true : `refusal does not match ${expect}: ${text.slice(0, 220)}`;
}

/** Assert a shaped success body carries an enabling confirmation. */
function expectBodyMentions(
  bodyValue: Record<string, unknown> | undefined,
  expect: RegExp,
): true | string {
  if (!bodyValue) return `no response body`;
  if (bodyValue['success'] === false)
    return `unexpected failure: ${JSON.stringify(bodyValue).slice(0, 200)}`;
  return expect.test(JSON.stringify(bodyValue))
    ? true
    : `confirmation missing ${expect}: ${JSON.stringify(bodyValue).slice(0, 200)}`;
}

/** Stub page that answers the antidebug detect probe with fixed findings. */
function antidebugPage() {
  const perDocument: string[] = [];
  const currentPage: string[] = [];
  const page = {
    createCDPSession: async () => ({ send: async () => ({}), detach: async () => undefined }),
    evaluateOnNewDocument: async (script: string) => void perDocument.push(script),
    evaluate: async (fn: unknown) => {
      void currentPage.push(String(fn));
      return {
        detected: true,
        count: 2,
        protections: ['debugger-statement', 'timing'],
        recommendations: ['review'],
        evidence: { samples: 1 },
      };
    },
  };
  return { page, perDocument, currentPage };
}

async function runAntidebugDetect(): Promise<Record<string, unknown>> {
  const { page } = antidebugPage();
  const handlers = new AntiDebugToolHandlers({ getActivePage: async () => page } as never);
  return body(await handlers.handleAntiDebugDetectProtections({}));
}

async function runAntidebugBypass(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { page, perDocument } = antidebugPage();
  const handlers = new AntiDebugToolHandlers({ getActivePage: async () => page } as never);
  const out = body(await handlers.handleAntidebugBypass(args));
  return { body: out, perDocument: perDocument.length };
}
