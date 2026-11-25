/**
 * Android backend for syscall_ebpf_attach.
 *
 * The tool must REUSE the host pipeline: buildBpftraceScript generates the
 * program, parseBpftraceJsonl parses the stream, and only the executor moves
 * from a host child_process to `adb shell su -c`. These tests prove the adb
 * branch pushes the same script, reuses the parser, and reports an honest
 * script fallback when the device has no bpftrace.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

const mockSpawn = vi.hoisted(() => vi.fn());
const mockExecFile = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

function makeChild(): EventEmitter & {
  stdout: Readable;
  stderr: Readable;
  kill: ReturnType<typeof vi.fn>;
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: Readable;
    stderr: Readable;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.kill = vi.fn();
  return child;
}

/**
 * Fake adb: answer the capability probe and the trace-style probe, then
 * swallow push/rm. `style` mirrors what the device would report for
 * `test -f /sys/kernel/btf/vmlinux` + `test -d .../events/syscalls`.
 */
function adbExecImpl(deviceHasBpftrace: boolean, style: 'kprobe' | 'tracepoint' = 'kprobe') {
  return (
    _file: string,
    args: string[],
    _opts: unknown,
    cb: (error: unknown, stdout: string, stderr: string) => void,
  ) => {
    const joined = args.join(' ');
    if (joined.includes('/sys/kernel/btf/vmlinux')) {
      cb(null, style === 'tracepoint' ? 'btf\ntps\n' : '', '');
      return;
    }
    if (joined.includes('command -v bpftrace') || joined.includes('test -x')) {
      cb(null, deviceHasBpftrace ? '/system/bin/bpftrace\n' : '', '');
      return;
    }
    cb(null, '', '');
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

type Res = Record<string, unknown>;

describe('syscall_ebpf_attach — adb backend', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
    mockExecFile.mockReset();
  });

  it('runs the generated program on the device via adb and reuses the parser', async () => {
    mockExecFile.mockImplementation(adbExecImpl(true));
    const child = makeChild();
    mockSpawn.mockReturnValue(child);

    const { handleSyscallEbpfAttach } =
      await import('@server/domains/syscall-hook/handlers/ebpf-attach');
    const promise = handleSyscallEbpfAttach({
      device: 'adb',
      serial: 'c3c3ff6b',
      pid: 7,
      durationSec: 1,
      syscalls: ['read'],
    });

    await waitFor(() => mockSpawn.mock.calls.length > 0);
    const [command, argv] = mockSpawn.mock.calls[0] as [string, string[]];
    // Honors ADB_PATH when set (this host points at the Android SDK adb).
    expect(command.toLowerCase()).toContain('adb');
    expect(argv.join(' ')).toContain('-s c3c3ff6b');
    expect(argv.join(' ')).toContain('su -c');
    // Same generated program is pushed to the device.
    expect(
      mockExecFile.mock.calls.some((call) =>
        String((call[1] as string[] | undefined)?.join(' ')).includes('push'),
      ),
    ).toBe(true);

    child.stdout.push(
      '{"type":"enter","elapsedMs":3,"pid":7,"tid":9,"syscall":"tracepoint:syscalls:sys_enter_read","args":""}\n',
    );
    child.stdout.push(
      '{"type":"exit","elapsedMs":4,"pid":7,"tid":9,"syscall":"tracepoint:syscalls:sys_exit_read","ret":1,"durationUs":10}\n',
    );
    child.stdout.push(null);
    child.stderr.push(null);
    await new Promise((resolve) => setTimeout(resolve, 20));
    child.emit('close', 0);

    const res = (await promise) as unknown as Res;
    expect(res.success).toBe(true);
    expect(res.mode).toBe('live');
    expect(res.scope).toBe('device-kernel');
    expect(res.backend).toBe('adb-bpftrace');
    expect(res.device).toBe('c3c3ff6b');
    expect(res.events).toHaveLength(1);
    expect((res.events as Array<Record<string, unknown>>)[0]).toMatchObject({
      pid: 7,
      syscall: 'read',
      returnValue: 1,
    });
  });

  it('parses kprobe-mode JSONL (bare syscall name) and pairs enter/exit', async () => {
    mockExecFile.mockImplementation(adbExecImpl(true));
    const child = makeChild();
    mockSpawn.mockReturnValue(child);

    const { handleSyscallEbpfAttach } =
      await import('@server/domains/syscall-hook/handlers/ebpf-attach');
    const promise = handleSyscallEbpfAttach({
      device: 'adb',
      serial: 'c3c3ff6b',
      pid: 7,
      durationSec: 1,
      syscalls: ['openat'],
    });

    await waitFor(() => mockSpawn.mock.calls.length > 0);
    child.stdout.push(
      '{"type":"enter","elapsedMs":3,"pid":7,"tid":9,"syscall":"openat","args":""}\n',
    );
    child.stdout.push('{"type":"exit","elapsedMs":4,"pid":7,"tid":9,"syscall":"openat","ret":5}\n');
    child.stdout.push(null);
    child.stderr.push(null);
    await new Promise((resolve) => setTimeout(resolve, 20));
    child.emit('close', 0);

    const res = (await promise) as unknown as Res;
    expect(res.events).toHaveLength(1);
    expect((res.events as Array<Record<string, unknown>>)[0]).toMatchObject({
      pid: 7,
      syscall: 'openat',
      returnValue: 5,
    });
  });

  it('returns a device-kernel script + honest fix when the device lacks bpftrace', async () => {
    mockExecFile.mockImplementation(adbExecImpl(false));

    const { handleSyscallEbpfAttach } =
      await import('@server/domains/syscall-hook/handlers/ebpf-attach');
    const res = (await handleSyscallEbpfAttach({
      device: 'adb',
      serial: 'c3c3ff6b',
      pid: 1,
      durationSec: 2,
      syscalls: ['openat'],
    })) as unknown as Res;

    expect(res.success).toBe(true);
    expect(res.mode).toBe('script');
    expect(res.scope).toBe('device-kernel');
    expect(res.backend).toBe('adb-bpftrace');
    expect(res.bpftraceAvailable).toBe(false);
    // No BTF on this device -> BTF-free kprobe program, not a tracepoint one.
    expect(res.probeStyle).toBe('kprobe');
    expect(String(res.script)).toContain('kprobe:__arm64_sys_openat');
    expect(String(res.script)).not.toContain('args->');
    expect(String(res.fix)).toContain('BTF');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('uses tracepoint style when the device has BTF and syscall tracepoints', async () => {
    mockExecFile.mockImplementation(adbExecImpl(false, 'tracepoint'));

    const { handleSyscallEbpfAttach } =
      await import('@server/domains/syscall-hook/handlers/ebpf-attach');
    const res = (await handleSyscallEbpfAttach({
      device: 'adb',
      serial: 'c3c3ff6b',
      pid: 1,
      durationSec: 2,
      syscalls: ['openat'],
    })) as unknown as Res;

    expect(res.probeStyle).toBe('tracepoint');
    expect(String(res.script)).toContain('tracepoint:syscalls:sys_enter_openat');
  });

  it('rejects device=adb without a serial', async () => {
    const { handleSyscallEbpfAttach } =
      await import('@server/domains/syscall-hook/handlers/ebpf-attach');
    const res = (await handleSyscallEbpfAttach({
      device: 'adb',
      pid: 1,
      durationSec: 1,
      syscalls: ['read'],
    })) as unknown as Res;

    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('serial');
  });

  it('rejects a serial with shell metacharacters', async () => {
    const { handleSyscallEbpfAttach } =
      await import('@server/domains/syscall-hook/handlers/ebpf-attach');
    const res = (await handleSyscallEbpfAttach({
      device: 'adb',
      serial: 'c3c3ff6b;rm -rf /',
      pid: 1,
      durationSec: 1,
      syscalls: ['read'],
    })) as unknown as Res;

    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('Invalid device serial');
  });
});
