import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { FridaSession, diagnoseFridaError } from '@modules/binary-instrument/FridaSession';
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
  let capturedScript = '';

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
        // Scripts are now injected via a temp file (`-l <file>`); capture its
        // content while it still exists so assertions see the real payload.
        const args = _args as string[];
        const li = args.indexOf('-l');
        if (li >= 0) {
          try {
            capturedScript = readFileSync(args[li + 1] as string, 'utf8');
          } catch {
            capturedScript = '';
          }
        }
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

  /** Script payload: inline `-e` for short scripts, temp-file contents for `-l`. */
  function injectedScript(): string {
    const args = execFile.mock.calls.at(-1)?.[1] as string[];
    const inline = args.indexOf('-e');
    if (inline >= 0) return args[inline + 1] as string;
    expect(capturedScript.length).toBeGreaterThan(0);
    return capturedScript;
  }

  it('prepends the idempotent frida 17 compat shim to every injected script', async () => {
    await session.executeScript('console.log("hi");');

    const script = injectedScript();
    expect(script).toContain('__jshookShim');
    // frida 17: global lookups must not route a null module through
    // Process.getModuleByName(null) (that throws and breaks attach).
    expect(script).toContain('Module.getGlobalExportByName');
    expect(script).toContain('m === null || m === undefined');
    expect(script).not.toContain('return Process.getModuleByName(m).findExportByName(n);');
    expect(script).toContain('Process.getCurrentPid');
    // User script survives after the shim.
    expect(script.endsWith('console.log("hi");')).toBe(true);
  });

  it('uses a temp script file (-l) when the script exceeds the inline limit', async () => {
    const long = 'console.log("' + 'x'.repeat(3000) + '");';
    await session.executeScript(long);

    const args = execFile.mock.calls.at(-1)?.[1] as string[];
    expect(args).toContain('-l');
    expect(args).not.toContain('-e');
    expect(capturedScript).toContain('x'.repeat(100));
  });

  it('resolves a null module through the global export lookup, never getModuleByName(null)', async () => {
    await session.executeScript('Module.findExportByName(null, "getpid");');
    const script = injectedScript();
    // The global branch returns before the string-module branch runs.
    const globalBranch = script.indexOf('if (m === null || m === undefined)');
    const stringBranch = script.indexOf('(typeof m === "string") ? Process.getModuleByName(m)');
    expect(globalBranch).toBeGreaterThan(-1);
    expect(stringBranch).toBeGreaterThan(globalBranch);
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

  it('treats a keepAlive timeout that captured output as success, not an error', async () => {
    execFile.mockImplementation(
      (
        _file: unknown,
        _args: unknown,
        _opts: unknown,
        cb: (e: unknown, o: string, s: string) => void,
      ) => {
        const error = Object.assign(new Error('Command failed: frida'), {
          killed: true,
          signal: 'SIGTERM',
          code: null,
        });
        cb(error, '[enter] getpid @ 0x1\n[leave] getpid => 42\n', '');
      },
    );

    const result = await session.executeScript('hook', { keepAlive: true, timeoutMs: 2_000 });

    expect(result.error).toBeUndefined();
    expect(result.timedOut).toBe(true);
    expect(result.output).toContain('[leave] getpid => 42');
  });

  it('keeps a keepAlive timeout with no output as an error', async () => {
    execFile.mockImplementation(
      (
        _file: unknown,
        _args: unknown,
        _opts: unknown,
        cb: (e: unknown, o: string, s: string) => void,
      ) => {
        const error = Object.assign(new Error('Command failed: frida'), {
          killed: true,
          signal: 'SIGTERM',
          code: null,
        });
        cb(error, '', '');
      },
    );

    const result = await session.executeScript('hook', { keepAlive: true, timeoutMs: 2_000 });

    expect(result.error).toBeDefined();
    expect(result.timedOut).toBe(true);
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

  it('maps a client/server version skew to actionable remediation', () => {
    const diagnosis = diagnoseFridaError(
      'Failed to enumerate processes: unable to communicate with remote frida-server; please ensure that major versions match and that the remote Frida has the feature you are trying to use',
    );
    expect(diagnosis?.cause).toBe('version-mismatch');
    expect(diagnosis?.remediation).toContain('frida==');
  });

  it('maps a refused connection to a start-the-server hint', () => {
    const diagnosis = diagnoseFridaError('Failed to connect: connection refused');
    expect(diagnosis?.cause).toBe('server-not-running');
    expect(diagnosis?.remediation).toContain('frida-server');
  });

  it('returns null for unrelated script errors so real bugs are not misclassified', () => {
    expect(diagnoseFridaError('TypeError: cannot read properties of undefined')).toBeNull();
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
