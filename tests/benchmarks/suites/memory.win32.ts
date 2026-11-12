/**
 * memory domain — Win32 engine-wired contract cases (Route A).
 *
 * Runs ONLY on Windows with koffi present (repo rule for FFI modules: an
 * env-gated runtime test rather than a mock). Everything asserted here is
 * engine-independent logic reachable once the real engines are wired:
 * the empty breakpoint registry, freeze-export over an empty controller,
 * empty undo/redo stacks, and the argument validation that runs before any
 * native call.
 */
import { MemoryScanHandlers } from '@server/domains/memory/handlers.impl';
import { hardwareBreakpointEngine } from '@native/HardwareBreakpoint';
import { speedhack } from '@native/Speedhack';
import { MemoryController } from '@native/MemoryController';
import { MemoryScanner } from '@native/MemoryScanner';
import { NativeMemoryManager } from '@native/NativeMemoryManager';
import * as platformFactory from '@native/platform/factory';
import { body } from '../harness';

type Args = Record<string, unknown>;

/**
 * True when the Win32 engines are actually importable and constructible.
 *
 * `process.platform === 'win32'` alone is not enough: koffi is an optional
 * dependency, and the engines load kernel32/ntdll through it. A missing koffi
 * must skip these cases rather than fail them.
 */
export function win32EnginesAvailable(): boolean {
  if (process.platform !== 'win32') return false;
  try {
    void new MemoryController();
    return typeof hardwareBreakpointEngine.attach === 'function';
  } catch {
    return false;
  }
}

/** Handlers with the real Win32 engines wired (mirrors manifest.ts's IS_WIN32 branch). */
function win32Handlers(): Record<string, (a: Args) => Promise<unknown>> {
  const createProvider = (platformFactory as unknown as { createPlatformProvider: () => unknown })
    .createPlatformProvider;
  const provider = createProvider();
  const manager = new NativeMemoryManager(provider as never);
  const scanner = new MemoryScanner(manager as never, provider as never);
  const memCtrl = new MemoryController(provider as never);

  return new MemoryScanHandlers(
    scanner as never,
    {} as never,
    {} as never,
    {} as never,
    hardwareBreakpointEngine as never,
    null as never,
    null as never,
    {} as never,
    memCtrl as never,
    speedhack as never,
    null as never,
    null as never,
    null as never,
  ) as unknown as Record<string, (a: Args) => Promise<unknown>>;
}

const flatten = (res: unknown): Args => body(res) as Args;

/** Renderer of a handler call: response body, or the thrown message. */
async function callEngine(run: () => Promise<unknown>): Promise<Args> {
  try {
    return flatten(await run());
  } catch (error) {
    return { thrown: error instanceof Error ? error.message : String(error) };
  }
}

const text = (b: Args): string => JSON.stringify(b);

export const memoryWin32Cases = [
  {
    name: 'memory_breakpoint/empty-registry-survives-engine-wiring',
    tool: 'memory_breakpoint',
    origin: 'homemade' as const,
    reference:
      'registry contract: with the real Win32 breakpoint engine wired and nothing set, the listing is an empty array with count 0 and the engine mode reported — no placeholder rows',
    skip: () => !win32EnginesAvailable(),
    skipReason: 'requires Windows + koffi',
    run: () => callEngine(() => win32Handlers()['handleBreakpointDispatch']!({ action: 'list' })),
    validate: (v: unknown) => {
      const b = v as Args;
      if (b['success'] !== true) return `expected success: ${text(b).slice(0, 200)}`;
      if (b['count'] !== 0) return `count should be 0, got ${String(b['count'])}`;
      const list = b['breakpoints'];
      if (!Array.isArray(list) || list.length !== 0) return 'breakpoints must be an empty array';
      return typeof b['mode'] === 'string' ? true : 'engine mode not reported';
    },
  },
  {
    name: 'memory_breakpoint/set-requires-pid',
    tool: 'memory_breakpoint',
    origin: 'homemade' as const,
    reference:
      'argument contract: setting a breakpoint needs a pid (resolved before any debug-register allocation)',
    skip: () => !win32EnginesAvailable(),
    skipReason: 'requires Windows + koffi',
    run: () => callEngine(() => win32Handlers()['handleBreakpointDispatch']!({ action: 'set' })),
    validate: (v: unknown) => {
      const s = text(v as Args);
      return /Invalid PID/i.test(s) ? true : `expected a pid error: ${s.slice(0, 200)}`;
    },
  },
  {
    name: 'memory_breakpoint/remove-requires-breakpointId',
    tool: 'memory_breakpoint',
    origin: 'homemade' as const,
    reference: 'argument contract: removing a breakpoint names the missing breakpointId',
    skip: () => !win32EnginesAvailable(),
    skipReason: 'requires Windows + koffi',
    run: () => callEngine(() => win32Handlers()['handleBreakpointDispatch']!({ action: 'remove' })),
    validate: (v: unknown) => {
      const s = text(v as Args);
      return /breakpointId/i.test(s) ? true : `expected a breakpointId error: ${s.slice(0, 200)}`;
    },
  },
  {
    name: 'memory_freeze_export/empty-controller-reports-zero',
    tool: 'memory_freeze_export',
    origin: 'homemade' as const,
    reference:
      'export contract: with a real MemoryController and no active freezes the export is an empty array with count 0 — never a fabricated entry',
    skip: () => !win32EnginesAvailable(),
    skipReason: 'requires Windows + koffi',
    run: () => callEngine(() => win32Handlers()['handleFreezeExport']!({})),
    validate: (v: unknown) => {
      const b = v as Args;
      if (b['success'] !== true) return `expected success: ${text(b).slice(0, 200)}`;
      const freezes = b['freezes'];
      if (!Array.isArray(freezes) || freezes.length !== 0) return 'freezes must be an empty array';
      return b['count'] === 0 ? true : `count should be 0, got ${String(b['count'])}`;
    },
  },
  {
    name: 'memory_freeze_export/rejects-negative-pid',
    tool: 'memory_freeze_export',
    origin: 'homemade' as const,
    reference:
      'argument contract: the pid filter is validated and a negative value is refused by name',
    skip: () => !win32EnginesAvailable(),
    skipReason: 'requires Windows + koffi',
    run: () => callEngine(() => win32Handlers()['handleFreezeExport']!({ pid: -5 })),
    validate: (v: unknown) => {
      const s = text(v as Args);
      return /Invalid PID/i.test(s) ? true : `expected a pid error: ${s.slice(0, 200)}`;
    },
  },
  {
    name: 'memory_write_history/undo-on-empty-stack-is-honest',
    tool: 'memory_write_history',
    origin: 'homemade' as const,
    reference:
      'undo contract: with nothing recorded, undo reports undone:false and entry:null rather than inventing a reverted write',
    skip: () => !win32EnginesAvailable(),
    skipReason: 'requires Windows + koffi',
    run: () => callEngine(() => win32Handlers()['handleWriteHistoryDispatch']!({ action: 'undo' })),
    validate: (v: unknown) => {
      const b = v as Args;
      if (b['success'] !== true) return `expected success: ${text(b).slice(0, 200)}`;
      if (b['undone'] !== false) return `undone should be false, got ${String(b['undone'])}`;
      return b['entry'] === null ? true : 'entry should be null on an empty stack';
    },
  },
  {
    name: 'memory_write_history/redo-on-empty-stack-is-honest',
    tool: 'memory_write_history',
    origin: 'homemade' as const,
    reference:
      'redo contract: with nothing undone, redo reports redone:false and entry:null rather than replaying a phantom write',
    skip: () => !win32EnginesAvailable(),
    skipReason: 'requires Windows + koffi',
    run: () => callEngine(() => win32Handlers()['handleWriteHistoryDispatch']!({ action: 'redo' })),
    validate: (v: unknown) => {
      const b = v as Args;
      if (b['success'] !== true) return `expected success: ${text(b).slice(0, 200)}`;
      if (b['redone'] !== false) return `redone should be false, got ${String(b['redone'])}`;
      return b['entry'] === null ? true : 'entry should be null on an empty stack';
    },
  },
  {
    name: 'memory_speedhack/rejects-missing-pid',
    tool: 'memory_speedhack',
    origin: 'homemade' as const,
    reference:
      'argument contract: with the real Speedhack engine wired, a set without a pid is refused by name before timer hooking',
    skip: () => !win32EnginesAvailable(),
    skipReason: 'requires Windows + koffi',
    run: () => callEngine(() => win32Handlers()['handleSpeedhackDispatch']!({ action: 'set' })),
    validate: (v: unknown) => {
      const s = text(v as Args);
      return /Invalid PID/i.test(s) ? true : `expected a pid error: ${s.slice(0, 200)}`;
    },
  },
  {
    name: 'memory_find_accesses/requires-hex-address',
    tool: 'memory_find_accesses',
    origin: 'homemade' as const,
    reference:
      'argument contract: with the real breakpoint engine wired, a watch without a hex address is refused before any DR register is allocated',
    skip: () => !win32EnginesAvailable(),
    skipReason: 'requires Windows + koffi',
    run: () => callEngine(() => win32Handlers()['handleFindAccesses']!({})),
    validate: (v: unknown) => {
      const s = text(v as Args);
      return /address must be a hex address/i.test(s)
        ? true
        : `expected a hex-address error: ${s.slice(0, 200)}`;
    },
  },
];
