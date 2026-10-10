import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GhidraAnalyzer } from '@modules/binary-instrument/GhidraAnalyzer';
import { probeCommand } from '@modules/external/ToolProbe';
import { PrerequisiteError } from '@errors/PrerequisiteError';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('@modules/external/ToolProbe', () => ({
  probeCommand: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

/**
 * Coverage for the stateless headless decompile path (kimi-cu report P2-6):
 * ghidra_decompile no longer depends on a plugin_ghidra_bridge HTTP server.
 */
describe('GhidraAnalyzer — decompileFunction headless backend', () => {
  let analyzer: GhidraAnalyzer;
  let execFile: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    execFile = (await import('node:child_process')).execFile as unknown as ReturnType<typeof vi.fn>;
    // Real execFile invokes the callback asynchronously and returns a ChildProcess;
    // a synchronous mock would hit the TDZ on the manual-timeout `timer` cleanup.
    execFile.mockImplementation(
      (
        _file: unknown,
        _args: unknown,
        _opts: unknown,
        cb: (e: unknown, o: string, s: string) => void,
      ) => {
        const child = { pid: 4242, kill: () => {} };
        setTimeout(() => cb(null, 'FUNCTION_NOT_FOUND:nothing', ''), 0);
        return child;
      },
    );
    (probeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      available: true,
      path: '/usr/bin/analyzeHeadless',
      version: '12.1.4',
    });
    analyzer = new GhidraAnalyzer();
  });

  async function writeTempBinary(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'jshook-ghidra-decompile-test-'));
    const binaryPath = join(dir, 'sample.bin');
    await writeFile(binaryPath, Buffer.from('MZfakebinary'), 'utf8');
    return binaryPath;
  }

  function mockOutput(stdout: string): void {
    execFile.mockImplementation(
      (
        _file: unknown,
        _args: unknown,
        _opts: unknown,
        cb: (e: unknown, o: string, s: string) => void,
      ) => {
        const child = { pid: 4242, kill: () => {} };
        setTimeout(() => cb(null, stdout, ''), 0);
        return child;
      },
    );
  }

  it('invokes analyzeHeadless with -import and -postScript', async () => {
    mockOutput('FUNCTION_NOT_FOUND:x');
    const binaryPath = await writeTempBinary();

    await analyzer.decompileFunction(binaryPath, 'main');

    const callArgs = execFile.mock.calls.at(-1)?.[1] as string[];
    expect(callArgs).toContain('-import');
    expect(callArgs).toContain('-postScript');
    expect(callArgs).toContain('BinaryInstrumentDecompileOne.java');
  });

  it('escapes quotes, backslashes and newlines in the function name (injection guard)', () => {
    const build = (
      analyzer as unknown as { buildFunctionDecompileScript(name: string): string }
    ).buildFunctionDecompileScript.bind(analyzer);
    const script = build('na"me\\X\ninjected');
    // The embedded Java literal is escaped: no raw quote/backslash/newline breakouts.
    expect(script).toContain('String target = "na\\"me\\\\Xinjected";');
    expect(script).not.toContain('"na"me');
    expect(script).not.toContain('\ninjected"');
    // NOT_FOUND fallback marker present for the miss path.
    expect(script).toContain('FUNCTION_NOT_FOUND:');
  });

  it('returns found=false with FUNCTION_NOT_FOUND marker', async () => {
    mockOutput('INFO: analyzed\nFUNCTION_NOT_FOUND:missing_fn\n');
    const binaryPath = await writeTempBinary();

    const result = await analyzer.decompileFunction(binaryPath, 'missing_fn');

    expect(result.found).toBe(false);
    expect(result.functions).toEqual([]);
    expect(result.rawOutput).toBeUndefined();
  });

  it('parses the emitted marker protocol into structured functions', async () => {
    mockOutput(
      [
        'INFO: Analyzing sample.bin',
        'FUNCTION_START',
        'NAME:main',
        'ADDRESS:00401000',
        'SIGNATURE:int main(void)',
        'DECOMPILED_START',
        'int main(void) {',
        '  return 0;',
        '}',
        'DECOMPILED_END',
        'FUNCTION_END',
      ].join('\r\n'),
    );
    const binaryPath = await writeTempBinary();

    const result = await analyzer.decompileFunction(binaryPath, 'main');

    expect(result.found).toBe(true);
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0]).toMatchObject({
      name: 'main',
      address: '0x00401000',
      signature: 'int main(void)',
    });
    expect(result.functions[0]?.decompiled).toContain('return 0;');
  });

  it('reports found=false with output tail when markers never appear (CLI/analysis failure)', async () => {
    mockOutput('ERROR: Something unrelated to our protocol');
    const binaryPath = await writeTempBinary();

    const result = await analyzer.decompileFunction(binaryPath, 'main');

    expect(result.found).toBe(false);
    expect(result.functions).toEqual([]);
    expect(result.rawOutput).toContain('ERROR: Something unrelated');
  });

  it('throws PrerequisiteError when analyzeHeadless is unavailable', async () => {
    // Inject the probe cache directly: the real probe chain falls back to a
    // filesystem discovery scan (env → home dirs → PATH), which finds the
    // host's actual Ghidra install and would defeat a probeCommand mock.
    (
      analyzer as unknown as {
        ghidraProbe: { available: boolean; reason?: string };
      }
    ).ghidraProbe = { available: false, reason: 'not on PATH' };
    const binaryPath = await writeTempBinary();

    await expect(analyzer.decompileFunction(binaryPath, 'main')).rejects.toThrow(PrerequisiteError);
    expect(execFile).not.toHaveBeenCalled();
  });

  it('does not blow up when the headless run rejects (timeout/kill path surfaces the error)', async () => {
    execFile.mockImplementation(
      (
        _file: unknown,
        _args: unknown,
        _opts: unknown,
        cb: (e: unknown, o: string, s: string) => void,
      ) => {
        const child = { pid: 4242, kill: () => {} };
        setTimeout(() => cb(new Error('analyzeHeadless timed out after 100ms'), '', ''), 0);
        return child;
      },
    );
    const binaryPath = await writeTempBinary();

    await expect(analyzer.decompileFunction(binaryPath, 'main')).rejects.toThrow(
      'analyzeHeadless timed out',
    );
  });
});
