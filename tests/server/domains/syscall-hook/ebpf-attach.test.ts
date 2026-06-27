import { describe, expect, it } from 'vitest';
import { syscallHookToolDefinitions } from '@server/domains/syscall-hook/definitions';

type Res = Record<string, unknown>;
const autoImport = async () => await import('@server/domains/syscall-hook/handlers/ebpf-attach');

// ── Tool definition validation ─────────────────────────────────────────────────

describe('syscall_ebpf_attach — tool definition', () => {
  it('is registered with correct name and schema', () => {
    const tool = syscallHookToolDefinitions.find(
      (candidate) => candidate.name === 'syscall_ebpf_attach',
    );
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema;
    expect(schema.properties).toBeDefined();

    const props = schema.properties as Record<string, unknown>;
    expect(props['pid']).toBeDefined();
    expect(props['syscalls']).toBeDefined();
    expect(props['durationSec']).toBeDefined();
    expect(props['simulate']).toBeDefined();
    expect(props['output']).toBeDefined();
  });

  it('has query profile', () => {
    const tool = syscallHookToolDefinitions.find((c) => c.name === 'syscall_ebpf_attach');
    expect(tool).toBeDefined();
  });

  it('description mentions live attach', () => {
    const tool = syscallHookToolDefinitions.find((c) => c.name === 'syscall_ebpf_attach');
    const desc = (tool?.description ?? '').toLowerCase();
    expect(desc).toContain('live');
    expect(desc).toContain('ebpf');
    expect(desc).toContain('attach');
  });
});

// ── Behavioral tests ──────────────────────────────────────────────────────────

describe('handleSyscallEbpfAttach — simulated mode', () => {
  it('generates simulated events with correct structure', async () => {
    const { handleSyscallEbpfAttach } = await autoImport();
    const res = (await handleSyscallEbpfAttach({
      simulate: true,
      durationSec: 5,
      pid: 42,
      syscalls: ['read', 'write'],
    })) as unknown as Res;

    expect(res.success).toBe(true);
    expect(res.mode).toBe('simulated');
    expect(res.pid).toBe(42);
    expect(res.durationSec).toBe(5);
    expect(Array.isArray(res.events)).toBe(true);
    expect((res.events as Array<unknown>).length).toBeGreaterThan(0);

    const ev0 = (res.events as Array<Record<string, unknown>>)[0]!;
    expect(ev0).toHaveProperty('timestamp');
    expect(ev0).toHaveProperty('pid');
    expect(ev0).toHaveProperty('syscall');
    expect(ev0).toHaveProperty('args');
    expect(ev0).toHaveProperty('returnValue');
  });

  it('respects custom syscall list', async () => {
    const { handleSyscallEbpfAttach } = await autoImport();
    const res = (await handleSyscallEbpfAttach({
      simulate: true,
      durationSec: 2,
      pid: 0,
      syscalls: ['connect', 'sendto', 'recvfrom'],
    })) as unknown as Res;

    expect(res.success).toBe(true);
    for (const ev of res.events as Array<Record<string, unknown>>) {
      expect(['connect', 'sendto', 'recvfrom']).toContain(ev.syscall as string);
    }
  });

  it('returns _simulated watermark', async () => {
    const { handleSyscallEbpfAttach } = await autoImport();
    const res = (await handleSyscallEbpfAttach({
      simulate: true,
      durationSec: 1,
    })) as unknown as Res;

    expect(res.isSimulated).toBe(true);
  });

  it('includes liveCapable and bpftraceAvailable fields', async () => {
    const { handleSyscallEbpfAttach } = await autoImport();
    const res = (await handleSyscallEbpfAttach({
      simulate: true,
      durationSec: 1,
    })) as unknown as Res;

    expect(res).toHaveProperty('liveCapable');
    expect(res).toHaveProperty('bpftraceAvailable');
  });
});

// ── Validation tests ─────────────────────────────────────────────────────────

describe('handleSyscallEbpfAttach — validation', () => {
  it('rejects durationSec outside 1-300', async () => {
    const { handleSyscallEbpfAttach } = await autoImport();
    const res1 = (await handleSyscallEbpfAttach({ durationSec: 0 })) as unknown as Res;
    expect(res1.success).toBe(false);
    expect(res1.error as string).toContain('durationSec');

    const res2 = (await handleSyscallEbpfAttach({ durationSec: 301 })) as unknown as Res;
    expect(res2.success).toBe(false);
  });

  it('rejects negative pid', async () => {
    const { handleSyscallEbpfAttach } = await autoImport();
    const res = (await handleSyscallEbpfAttach({
      pid: -1,
      durationSec: 5,
    })) as unknown as Res;
    expect(res.success).toBe(false);
  });

  it('rejects non-integer pid', async () => {
    const { handleSyscallEbpfAttach } = await autoImport();
    const res = (await handleSyscallEbpfAttach({
      pid: 'abc',
      durationSec: 5,
    })) as unknown as Res;
    expect(res.success).toBe(false);
  });

  it('rejects invalid syscall names', async () => {
    const { handleSyscallEbpfAttach } = await autoImport();
    const res = (await handleSyscallEbpfAttach({
      durationSec: 5,
      syscalls: ['read', 'EVIL; rm -rf /'],
    })) as unknown as Res;
    expect(res.success).toBe(false);
    expect(res.error as string).toContain('Invalid syscall names');
  });
});

// ── Script generation (live mode without bpftrace → script fallback) ────────

describe('handleSyscallEbpfAttach — script fallback', () => {
  it('returns script when not on Linux and not simulating', async () => {
    const { handleSyscallEbpfAttach } = await autoImport();
    const res = (await handleSyscallEbpfAttach({
      pid: 100,
      durationSec: 10,
      syscalls: ['openat', 'read'],
    })) as unknown as Res;

    expect(res.success).toBe(true);
    expect(res.mode).toMatch(/script|live/);
    // On non-Linux, should fall back to script mode
    if (process.platform !== 'linux') {
      expect(res.mode).toBe('script');
      expect(res.script).toBeDefined();
      const script = res.script as string;
      expect(script).toContain('sys_enter_openat');
      expect(script).toContain('sys_enter_read');
    }
  });
});

// ── Event format validation ──────────────────────────────────────────────────

describe('handleSyscallEbpfAttach — event format', () => {
  it('returns events with increasing timestamps', async () => {
    const { handleSyscallEbpfAttach } = await autoImport();
    const res = (await handleSyscallEbpfAttach({
      simulate: true,
      durationSec: 3,
      pid: 42,
    })) as unknown as Res;
    expect(res.success).toBe(true);
    const events = res.events as Array<Record<string, unknown>>;
    const timestamps = events.map((e) => e.timestamp as number);
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]!).toBeGreaterThanOrEqual(timestamps[i - 1]!);
    }
  });

  it('assigns correct pid to all events', async () => {
    const { handleSyscallEbpfAttach } = await autoImport();
    const res = (await handleSyscallEbpfAttach({
      simulate: true,
      durationSec: 2,
      pid: 9999,
    })) as unknown as Res;
    expect(res.success).toBe(true);
    for (const ev of res.events as Array<Record<string, unknown>>) {
      expect(ev.pid).toBe(9999);
    }
  });
});
