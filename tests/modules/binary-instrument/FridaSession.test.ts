import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FridaSession } from '@modules/binary-instrument/FridaSession';
import { probeCommand } from '@modules/external/ToolProbe';

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_file, _args, _options, cb) => {
    cb(null, 'mocked_output', '');
  }),
}));

vi.mock('@modules/external/ToolProbe', () => ({
  probeCommand: vi.fn(),
}));

describe('FridaSession', () => {
  let session: FridaSession;

  beforeEach(() => {
    vi.clearAllMocks();
    session = new FridaSession();
    (probeCommand as any).mockResolvedValue({
      available: true,
      path: '/usr/bin/frida',
      version: '16.0.0',
    });
  });

  it('attaches and detaches', async () => {
    const id = await session.attach('1234');
    expect(id).toBeDefined();
    expect(session.listSessions()).toHaveLength(1);
    expect(session.hasSession(id)).toBe(true);

    await session.detach();
    expect(session.listSessions()[0]?.status).toBe('detached');
  });

  it('fails to attach if frida is not available', async () => {
    (probeCommand as any).mockResolvedValue({
      available: false,
      reason: 'Not installed',
    });

    await expect(session.attach('1234')).rejects.toThrow('Not installed');
  });

  it('executes script', async () => {
    const execFile = await import('node:child_process').then((m) => m.execFile as any);
    execFile.mockImplementation((_file: any, _args: any, _options: any, cb: any) => {
      cb(null, 'script_output', '');
    });

    await session.attach('1234');
    const result = await session.executeScript('console.log("hello");');
    expect(result.output).toBe('script_output');
    expect(result.error).toBeUndefined();
  });

  it('handles execution error', async () => {
    const execFile = await import('node:child_process').then((m) => m.execFile as any);
    execFile.mockImplementation((_file: any, _args: any, _options: any, cb: any) => {
      cb(new Error('frida crash'));
    });

    await session.attach('1234');
    const result = await session.executeScript('bad_script()');
    expect(result.error).toBe('frida crash');
    expect(session.listSessions()[0]?.status).toBe('error');
  });

  it('enumerates modules', async () => {
    const execFile = await import('node:child_process').then((m) => m.execFile as any);
    execFile.mockImplementation((_file: any, _args: any, _options: any, cb: any) => {
      cb(
        null,
        '[{"name": "libfoo.so", "base": "0x1000", "size": 4096, "path": "/lib/libfoo.so"}]',
        '',
      );
    });

    await session.attach('1234');
    const modules = await session.enumerateModules();
    expect(modules).toHaveLength(1);
    expect(modules[0]).toEqual({
      name: 'libfoo.so',
      base: '0x1000',
      size: 4096,
      path: '/lib/libfoo.so',
    });
  });

  it('enumerates functions', async () => {
    const execFile = await import('node:child_process').then((m) => m.execFile as any);
    execFile.mockImplementation((_file: any, _args: any, _options: any, cb: any) => {
      cb(null, '[{"name": "malloc", "address": "0x2000", "size": 0}]', '');
    });

    await session.attach('1234');
    const funcs = await session.enumerateFunctions('libc.so');
    expect(funcs).toHaveLength(1);
    expect(funcs[0]).toEqual({
      name: 'malloc',
      address: '0x2000',
      size: 0,
    });
  });

  it('finds symbols', async () => {
    const execFile = await import('node:child_process').then((m) => m.execFile as any);
    execFile.mockImplementation((_file: any, _args: any, _options: any, cb: any) => {
      cb(null, '[{"name": "free", "address": "0x3000", "demangled": "free"}]', '');
    });

    await session.attach('1234');
    const symbols = await session.findSymbols('free');
    expect(symbols).toHaveLength(1);
    expect(symbols[0]).toEqual({
      name: 'free',
      address: '0x3000',
      demangled: 'free',
    });
  });

  it('switches sessions', async () => {
    const id1 = await session.attach('1111');
    await session.attach('2222'); // attaches and sets to active

    expect(session.useSession('invalid')).toBe(false);
    expect(session.useSession(id1)).toBe(true);

    const execFile = await import('node:child_process').then((m) => m.execFile as any);
    execFile.mockImplementation((_file: any, _args: any, _options: any, cb: any) => {
      cb(null, 'ok', '');
    });

    await session.executeScript('test');
    expect(execFile.mock.calls[execFile.mock.calls.length - 1]?.[1]).toContain('1111');
  });

  it('parses fallback modules when execution fails', async () => {
    const execFile = await import('node:child_process').then((m) => m.execFile as any);
    execFile.mockImplementation((_file: any, _args: any, _options: any, cb: any) => {
      cb(new Error('crash'));
    });

    await session.attach('/bin/ls');
    const modules = await session.enumerateModules();
    expect(modules).toHaveLength(1);
    expect(modules[0]?.name).toBe('ls');
  });

  it('builds target args correctly', async () => {
    const execFile = await import('node:child_process').then((m) => m.execFile as any);

    await session.attach('1234');
    await session.executeScript('test');
    expect(execFile.mock.calls[execFile.mock.calls.length - 1]?.[1]).toContain('-p');

    await session.attach('/bin/ls');
    await session.executeScript('test');
    expect(execFile.mock.calls[execFile.mock.calls.length - 1]?.[1]).toContain('-f');

    await session.attach('com.example.app');
    await session.executeScript('test');
    expect(execFile.mock.calls[execFile.mock.calls.length - 1]?.[1]).toContain('-n');
  });
});
