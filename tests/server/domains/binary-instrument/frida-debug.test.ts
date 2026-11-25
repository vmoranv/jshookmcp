import { describe, expect, it, vi } from 'vitest';
import { R } from '@server/domains/shared/ResponseBuilder';
import { FridaHandlers } from '@server/domains/binary-instrument/handlers/frida-handlers';
import type { BinaryInstrumentState } from '@server/domains/binary-instrument/handlers/shared';
import type { FridaSession } from '@modules/binary-instrument';

vi.mock('@modules/external/ToolProbe', () => ({ probeCommand: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

function parse(res: unknown): Record<string, unknown> {
  return R.parse<Record<string, unknown>>(res as Parameters<typeof R.parse>[0]);
}

function makeHandlers(executeScript: ReturnType<typeof vi.fn>): FridaHandlers {
  const session = {
    getAvailability: vi.fn(async () => ({ available: true, path: 'frida' })),
    useSession: vi.fn(() => true),
    hasSession: vi.fn(() => true),
    listSessions: vi.fn(() => []),
    getSessionDiagnostics: vi.fn(() => undefined),
    executeScript,
  } as unknown as FridaSession;
  return new FridaHandlers({ fridaSession: session } as BinaryInstrumentState);
}

describe('FridaHandlers — breakpoint / backtrace / stalker', () => {
  it('frida_breakpoint_address resolves moduleName+offset and captures regs+backtrace', async () => {
    const executeScript = vi.fn(async () => ({ output: 'JSHOOK' }));
    const handlers = makeHandlers(executeScript);

    const res = parse(
      await handlers.handleFridaBreakpointAddress({
        sessionId: 's1',
        moduleName: 'libunet.so',
        offset: 0x5cb1c0,
        argCount: 4,
      } as Record<string, unknown>),
    );

    expect(res.success).toBe(true);
    expect(res.capability).toBe('frida_breakpoint_address');
    const script = (executeScript.mock.calls[0] as unknown[] | undefined)?.[0] as string;
    expect(script).toContain('Process.getModuleByName("libunet.so").base.add(');
    expect(script).toContain('Interceptor.attach');
    expect(script).toContain('Thread.backtrace');
    expect(script).toContain('Backtracer.ACCURATE');
    expect(script).toContain('for (var i=0;i<4;i++)');
    expect(executeScript).toHaveBeenCalledWith(expect.any(String), {
      keepAlive: true,
      timeoutMs: 12_000,
    });
  });

  it('frida_backtrace uses symbol lookup and slices to maxFrames', async () => {
    const executeScript = vi.fn(async () => ({ output: 'JSHOOK' }));
    const handlers = makeHandlers(executeScript);

    const res = parse(
      await handlers.handleFridaBacktrace({
        sessionId: 's1',
        moduleName: 'libunet.so',
        symbol: 'SSL_write',
        maxFrames: 16,
      } as Record<string, unknown>),
    );

    expect(res.success).toBe(true);
    const script = (executeScript.mock.calls[0] as unknown[] | undefined)?.[0] as string;
    expect(script).toContain('Module.findExportByName("libunet.so", "SSL_write")');
    expect(script).toContain('Thread.backtrace');
    expect(script).toContain('.slice(0, 16)');
  });

  it('frida_stalker_trace emits follow/parse with maxEvents and onLeave unfollow', async () => {
    const executeScript = vi.fn(async () => ({ output: 'JSHOOK' }));
    const handlers = makeHandlers(executeScript);

    const res = parse(
      await handlers.handleFridaStalkerTrace({
        sessionId: 's1',
        address: '0x7000',
        maxEvents: 1234,
      } as Record<string, unknown>),
    );

    expect(res.success).toBe(true);
    const script = (executeScript.mock.calls[0] as unknown[] | undefined)?.[0] as string;
    expect(script).toContain('ptr("0x7000")');
    expect(script).toContain('Stalker.follow');
    expect(script).toContain('Stalker.parse');
    expect(script).toContain('count >= 1234');
    expect(script).toContain('Stalker.unfollow');
  });

  it('rejects a debug target without address/symbol/module+offset', async () => {
    const handlers = makeHandlers(vi.fn(async () => ({ output: '' })));
    const res = parse(
      await handlers.handleFridaBreakpointAddress({ sessionId: 's1' } as Record<string, unknown>),
    );
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('Provide address, symbol, or moduleName+offset');
  });
});
