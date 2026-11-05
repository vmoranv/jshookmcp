/**
 * MCP 2.0 concurrency hardening — (F) regression.
 *
 * The analysis/memory domain binds used to read a module-level `globalContext`
 * that `ensure(ctx)` overwrote on every lazy init. Concurrent /mcp/v2 requests
 * (each with its own facade ctx) could therefore have their progress/sampling
 * routed to the "last ensured" context instead of their own.
 *
 * The fix injects a stable, process-level runtime core once into `deps` under
 * `__runtimeCore`; bind closures read from `deps`, never mutable module state.
 * This test binds one registration twice with different cores, interleaves the
 * invocations, and asserts each closure uses its OWN injected event bus.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  debouncerBuses: [] as unknown[],
}));

vi.mock('@server/EventBus', () => ({
  createProgressDebouncer: (bus: unknown) => {
    mocks.debouncerBuses.push(bus);
    return () => undefined;
  },
}));
vi.mock('@server/domains/shared/registry', () => ({
  ensureBrowserCore: vi.fn(async () => undefined),
  toolLookup: () => (name: string) => ({ name }),
}));
vi.mock('@server/domains/analysis/definitions', () => ({
  coreTools: [{ name: 'collect_code' }],
}));
vi.mock('@server/domains/analysis/index', () => ({
  CoreAnalysisHandlers: vi.fn(),
}));
vi.mock('@modules/deobfuscator/LLMDeobfuscator', () => ({
  LLMDeobfuscator: vi.fn(() => ({ isAvailable: () => false })),
}));
vi.mock('@server/domains/shared/modules', () => ({
  Deobfuscator: vi.fn(),
  AdvancedDeobfuscator: vi.fn(),
  ObfuscationDetector: vi.fn(),
  CodeAnalyzer: vi.fn(),
  CryptoDetector: vi.fn(),
  HookManager: vi.fn(),
}));
vi.mock('@modules/deobfuscator/JScramblerDeobfuscator', () => ({
  JScramberDeobfuscator: vi.fn(),
}));
vi.mock('@modules/deobfuscator/PackerDeobfuscator', () => ({
  UniversalUnpacker: vi.fn(),
}));
vi.mock('@modules/deobfuscator/VMDeobfuscator', () => ({ VMDeobfuscator: vi.fn() }));
vi.mock('@modules/deobfuscator/webcrack-worker', () => ({ getWebcrackPool: () => ({}) }));
vi.mock('@modules/deobfuscator/jscrambler-worker', () => ({ getJscramblerPool: () => ({}) }));
vi.mock('@modules/deobfuscator/decode-string-array-worker', () => ({
  getDecodeStringArrayPool: () => ({}),
}));

import manifest from '@server/domains/analysis/manifest';

interface FakeCore {
  eventBus: { emit: ReturnType<typeof vi.fn> };
  samplingBridge: object;
}

function fakeCore(tag: string): FakeCore {
  return {
    eventBus: { emit: vi.fn(async () => undefined), tag } as unknown as FakeCore['eventBus'],
    samplingBridge: { tag },
  };
}

function bindWith(deps: Record<string, unknown>): (args: Record<string, unknown>) => unknown {
  const registration = manifest.registrations.find((r) => r.tool.name === 'collect_code');
  if (!registration) throw new Error('collect_code registration missing');
  return registration.bind(deps) as (args: Record<string, unknown>) => unknown;
}

describe('analysis manifest binds use the injected per-deps runtime core', () => {
  beforeEach(() => {
    mocks.debouncerBuses.length = 0;
    vi.clearAllMocks();
  });

  it('routes progress to each bind own eventBus, with no cross-request leakage', () => {
    const coreA = fakeCore('A');
    const coreB = fakeCore('B');
    const handler = { handleCollectCode: vi.fn(async () => ({ ok: true })) };

    const depsA = {
      coreAnalysisHandlers: handler,
      __runtimeCore: coreA,
    };
    const depsB = {
      coreAnalysisHandlers: handler,
      __runtimeCore: coreB,
    };

    const boundA = bindWith(depsA);
    const boundB = bindWith(depsB);

    // Interleave: bind order and invocation order deliberately differ. Under
    // the old globalContext this would read whichever ctx was ensured last.
    boundA({ _meta: { progressToken: 'tok-a' } });
    boundB({ _meta: { progressToken: 'tok-b' } });
    boundA({ _meta: { progressToken: 'tok-a2' } });

    expect(mocks.debouncerBuses).toEqual([coreA.eventBus, coreB.eventBus, coreA.eventBus]);
    // Each debouncer got its own bus — B did not capture A's (or vice versa).
    expect(mocks.debouncerBuses[0]).toBe(coreA.eventBus);
    expect(mocks.debouncerBuses[1]).toBe(coreB.eventBus);
  });

  it('does not create a progress debouncer when no runtime core is injected', () => {
    const handler = { handleCollectCode: vi.fn(async () => ({ ok: true })) };
    const bound = bindWith({ coreAnalysisHandlers: handler });

    bound({ _meta: { progressToken: 'tok' } });

    expect(mocks.debouncerBuses).toHaveLength(0);
    expect(handler.handleCollectCode).toHaveBeenCalledTimes(1);
  });
});
