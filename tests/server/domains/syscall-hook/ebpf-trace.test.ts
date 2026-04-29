import { describe, expect, it } from 'vitest';

import { syscallHookToolDefinitions } from '@server/domains/syscall-hook/definitions';
import { SyscallHookHandlers } from '@server/domains/syscall-hook/handlers.impl';

describe('SyscallHookHandlers — eBPF trace behavioral tests', () => {
  it('documents relative elapsed timestamps in the syscall event schema', async () => {
    const tool = syscallHookToolDefinitions.find(
      (candidate) => candidate.name === 'syscall_correlate_js',
    );

    expect(tool).toBeDefined();
    const properties = (tool?.inputSchema.properties ?? {}) as Record<string, unknown>;
    const syscallEvents = (properties['syscallEvents'] ?? {}) as Record<string, unknown>;
    const itemSchema = (syscallEvents['items'] ?? {}) as Record<string, unknown>;
    const itemProperties = (itemSchema['properties'] ?? {}) as Record<string, unknown>;

    expect(syscallEvents['type']).toBe('array');
    expect(itemProperties['timestamp']).toMatchObject({
      description: 'Relative elapsed time in milliseconds since bpftrace start',
      type: 'number',
    });
  });

  describe('handleSyscallEbpfTrace — simulated mode', () => {
    it('generates simulated events with correct structure', async () => {
      const handlers = new SyscallHookHandlers();
      const res = (await handlers.handleSyscallEbpfTrace({
        simulate: true,
        durationSec: 5,
        pid: 42,
      })) as Record<string, unknown>;
      expect(res.ok).toBe(true);
      expect(res.simulated).toBe(true);
      expect(res.pid).toBe(42);
      expect(res.durationSec).toBe(5);
      expect(res.events).toHaveLength(20);
      const ev0 = (res.events as Array<Record<string, unknown>>)[0];
      expect(ev0).toHaveProperty('timestamp');
      expect(ev0).toHaveProperty('pid');
      expect(ev0).toHaveProperty('syscall');
      expect(ev0).toHaveProperty('args');
      expect(ev0).toHaveProperty('returnValue');
    });

    it('uses custom syscalls when provided', async () => {
      const handlers = new SyscallHookHandlers();
      const res = (await handlers.handleSyscallEbpfTrace({
        simulate: true,
        syscalls: ['read', 'write'],
        durationSec: 2,
      })) as Record<string, unknown>;
      expect(res.ok).toBe(true);
      expect(res.syscallsTraced).toEqual(['read', 'write']);
      for (const ev of res.events as Array<Record<string, unknown>>) {
        expect(['read', 'write']).toContain(ev.syscall);
      }
    });

    it('returns relative simulated timestamps that start at zero and increase monotonically', async () => {
      const handlers = new SyscallHookHandlers();
      const res = (await handlers.handleSyscallEbpfTrace({
        simulate: true,
        durationSec: 3,
      })) as Record<string, unknown>;
      const timestamps = (res.events as Array<Record<string, unknown>>).map(
        (event) => event.timestamp as number,
      );

      expect(timestamps[0]).toBe(0);
      expect(timestamps.every((timestamp) => Number.isFinite(timestamp) && timestamp >= 0)).toBe(
        true,
      );
      expect(timestamps.slice(1).every((timestamp, index) => timestamp > timestamps[index]!)).toBe(
        true,
      );
    });
  });

  describe('handleSyscallEbpfTrace — script generation', () => {
    it('generates bpftrace script with interval exit', async () => {
      const handlers = new SyscallHookHandlers();
      const res = (await handlers.handleSyscallEbpfTrace({
        pid: 1234,
        durationSec: 15,
        syscalls: ['read', 'write', 'openat'],
      })) as Record<string, unknown>;
      expect(res.ok).toBe(true);
      expect(res.mode).toBe('script');
      expect(res.script).toBeDefined();
      const script = res.script as string;
      expect(script).toContain('interval:s:15');
      expect(script).toContain('exit()');
      expect(script).toContain('sys_enter_read');
      expect(script).toContain('sys_enter_write');
      expect(script).toContain('sys_enter_openat');
      expect(script).toContain('sys_exit_read');
      expect(script).toContain('pid == 1234');
    });

    it('generates script without PID filter when pid is 0', async () => {
      const handlers = new SyscallHookHandlers();
      const res = (await handlers.handleSyscallEbpfTrace({
        pid: 0,
        durationSec: 5,
        syscalls: ['read'],
      })) as Record<string, unknown>;
      expect(res.ok).toBe(true);
      const script = res.script as string;
      const lines = script.split('\n');
      const enterProbe = lines.find(
        (l) => l.includes('sys_enter_read') && !l.includes('tracepoint:'),
      );
      if (enterProbe) {
        expect(enterProbe).not.toContain('pid == 0');
      }
    });

    it('does not include unused @enter_args map', async () => {
      const handlers = new SyscallHookHandlers();
      const res = (await handlers.handleSyscallEbpfTrace({ durationSec: 5 })) as Record<
        string,
        unknown
      >;
      const script = res.script as string;
      expect(script).not.toContain('@enter_args');
      expect(script).toContain('@enter_ts');
    });

    it('rejects durationSec outside 1-300', async () => {
      const handlers = new SyscallHookHandlers();
      const res1 = (await handlers.handleSyscallEbpfTrace({ durationSec: 0 })) as Record<
        string,
        unknown
      >;
      expect(res1.ok).toBe(false);
      const res2 = (await handlers.handleSyscallEbpfTrace({ durationSec: 301 })) as Record<
        string,
        unknown
      >;
      expect(res2.ok).toBe(false);
    });

    it('includes correct tracepoint arg access syntax (args->)', async () => {
      const handlers = new SyscallHookHandlers();
      const res = (await handlers.handleSyscallEbpfTrace({
        durationSec: 5,
        syscalls: ['openat', 'read'],
      })) as Record<string, unknown>;
      const script = res.script as string;
      expect(script).toContain('args->pathname');
      expect(script).toContain('args->flags');
      expect(script).toContain('args->fd');
      expect(script).toContain('args->count');
    });

    it('rejects invalid syscall names', async () => {
      const handlers = new SyscallHookHandlers();
      const res = (await handlers.handleSyscallEbpfTrace({
        durationSec: 5,
        syscalls: ['read', 'EVIL; rm -rf /', 'write'],
      })) as Record<string, unknown>;
      expect(res.ok).toBe(false);
      expect(res.error as string).toContain('Invalid syscall names');
    });

    it('rejects pid with invalid type (fail-closed)', async () => {
      const handlers = new SyscallHookHandlers();
      const res = (await handlers.handleSyscallEbpfTrace({
        pid: 'not-a-number',
        durationSec: 5,
      })) as Record<string, unknown>;
      expect(res.ok).toBe(false);
      expect(res.error as string).toContain('non-negative integer');
    });

    it('rejects negative pid', async () => {
      const handlers = new SyscallHookHandlers();
      const res = (await handlers.handleSyscallEbpfTrace({
        pid: -1,
        durationSec: 5,
      })) as Record<string, unknown>;
      expect(res.ok).toBe(false);
      expect(res.error as string).toContain('non-negative integer');
    });

    it('rejects fractional pid', async () => {
      const handlers = new SyscallHookHandlers();
      const res = (await handlers.handleSyscallEbpfTrace({
        pid: 1.5,
        durationSec: 5,
      })) as Record<string, unknown>;
      expect(res.ok).toBe(false);
      expect(res.error as string).toContain('non-negative integer');
    });
  });
});
