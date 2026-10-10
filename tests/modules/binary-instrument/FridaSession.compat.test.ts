import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FridaSession } from '@modules/binary-instrument/FridaSession';
import { probeCommand } from '@modules/external/ToolProbe';

vi.mock('@modules/external/ToolProbe', () => ({
  probeCommand: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

/**
 * Coverage for the kimi-cu report improvements:
 * - R-01: the frida 17 compatibility shim is prepended to every injected script
 * - R-02: keepAlive parks the script with a recv().wait() latch
 * - R-03: non-zero CLI exits preserve stdout/stderr/exitCode
 */
describe('FridaSession — compat shim / keepAlive / error passthrough', () => {
  let session: FridaSession;
  let execFile: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    execFile = (await import('node:child_process')).execFile as unknown as ReturnType<typeof vi.fn>;
    execFile.mockImplementation(
      (
        _file: unknown,
        _args: unknown,
        _opts: unknown,
        cb: (e: unknown, o: string, s: string) => void,
      ) => {
        cb(null, '[]', '');
      },
    );
    (probeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      available: true,
      path: '/usr/bin/frida',
      version: '16.0.0',
    });
    session = new FridaSession();
    await session.attach('1234');
  });

  /** The script argv passed after the -e flag. */
  function injectedScript(): string {
    const args = execFile.mock.calls.at(-1)?.[1] as string[];
    const flag = args.indexOf('-e');
    expect(flag).toBeGreaterThanOrEqual(0);
    return args[flag + 1] as string;
  }

  it('prepends the idempotent frida 17 compat shim to every injected script', async () => {
    await session.executeScript('console.log("hi");');

    const script = injectedScript();
    expect(script).toContain('__jshookShim');
    expect(script).toContain(
      'Module.findExportByName = function (m, n) { return Process.getModuleByName(m).findExportByName(n); }',
    );
    expect(script).toContain('Process.getCurrentPid');
    // User script survives after the shim.
    expect(script.endsWith('console.log("hi");')).toBe(true);
  });

  it('injects the shim for internal commands too (enumerateModules)', async () => {
    await session.enumerateModules();
    expect(injectedScript()).toContain('__jshookShim');
  });

  it('appends the recv().wait() latch when keepAlive is requested', async () => {
    await session.executeScript('console.log("armed");', { keepAlive: true });

    const script = injectedScript();
    expect(script).toContain('recv(function () {}).wait();');
    expect(script).toContain('console.log("armed");');
  });

  it('skips the latch when the script manages its own lifecycle via rpc.exports', async () => {
    await session.executeScript('rpc.exports = { done: function () {} };', { keepAlive: true });

    expect(injectedScript()).not.toContain('recv(');
  });

  it('does not inject the latch by default', async () => {
    await session.executeScript('console.log("plain");');

    expect(injectedScript()).not.toContain('recv(');
  });

  it('preserves stdout/stderr/exitCode when the CLI exits non-zero (R-03)', async () => {
    execFile.mockImplementation(
      (
        _file: unknown,
        _args: unknown,
        _opts: unknown,
        cb: (e: unknown, o: string, s: string) => void,
      ) => {
        const error = Object.assign(new Error('Command failed: frida'), {
          code: 1,
          stdout: 'hook armed\npartial output',
          stderr: 'TypeError: cannot read properties of undefined\n    at foo (script:1:1)',
        });
        cb(error, '', '');
      },
    );

    const result = await session.executeScript('boom');

    expect(result.output).toBe('hook armed\npartial output');
    expect(result.error).toContain('TypeError: cannot read properties of undefined');
    expect(result.stderr).toContain('TypeError');
    expect(result.exitCode).toBe(1);
  });

  it('recovers the captured streams when a timeout kill leaves error.stdout empty (frida 17.12.0)', async () => {
    // Verified on a real Windows host: execFile timeout kills deliver the
    // captured output via the callback parameters while error.stdout /
    // error.stderr stay EMPTY. execFileUtf8 must attach them before rejecting.
    execFile.mockImplementation(
      (
        _file: unknown,
        _args: unknown,
        _opts: unknown,
        cb: (e: unknown, o: string, s: string) => void,
      ) => {
        const error = Object.assign(new Error('Command failed: frida'), { code: undefined });
        cb(error, 'imm\r\nafter4s\r\n', '');
      },
    );

    const result = await session.executeScript('x', { keepAlive: true, timeoutMs: 12_000 });

    expect(result.output).toBe('imm\r\nafter4s');
    expect(result.exitCode).toBeUndefined();
  });

  it('falls back to the error message when the failure carries no streams (spawn errors)', async () => {
    execFile.mockImplementation(
      (
        _file: unknown,
        _args: unknown,
        _opts: unknown,
        cb: (e: unknown, o: string, s: string) => void,
      ) => {
        const error = new Error('spawn frida ENOENT');
        cb(error, '', '');
      },
    );

    const result = await session.executeScript('x');

    expect(result.output).toBe('');
    expect(result.error).toBe('spawn frida ENOENT');
    expect(result.exitCode).toBeUndefined();
    expect(result.stderr).toBeUndefined();
  });

  it('keeps raw stderr on success-with-warnings so warnings are not lost', async () => {
    execFile.mockImplementation(
      (
        _file: unknown,
        _args: unknown,
        _opts: unknown,
        cb: (e: unknown, o: string, s: string) => void,
      ) => {
        cb(null, 'ok output', 'WARN: deprecated API\n');
      },
    );

    const result = await session.executeScript('x');

    expect(result.output).toBe('ok output');
    expect(result.error).toBe('WARN: deprecated API');
    expect(result.stderr).toBe('WARN: deprecated API\n');
  });

  it('parses numeric string exit codes from the CLI error', async () => {
    execFile.mockImplementation(
      (
        _file: unknown,
        _args: unknown,
        _opts: unknown,
        cb: (e: unknown, o: string, s: string) => void,
      ) => {
        const error = Object.assign(new Error('Command failed'), {
          code: '127',
          stdout: '',
          stderr: 'command not found',
        });
        cb(error, '', '');
      },
    );

    const result = await session.executeScript('x');

    expect(result.exitCode).toBe(127);
  });
});
