/**
 * Launch-attribution signals: the three facts that turn "which tool failed"
 * into "why the browser did not come up".
 *
 * Each test pins one decision the signal is supposed to drive, because the
 * signal only has value if a failure WITH stderr and a failure WITHOUT it are
 * distinguishable — the whole point is that those two have different owners.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginStderrCapture,
  detectEntrypoint,
  installLaunchSignals,
  launchSignalAttrs,
  noopStderrCapture,
  readLaunchSignalsForCwd,
  resetLaunchSignals,
} from '@server/observability/launchSignals';

beforeEach(() => {
  // Pin the kind: under vitest the process runs through a node_modules shim,
  // so auto-detection reports `bin`. `library` keeps this fixture's value
  // distinguishable from the detection default in the other assertions.
  resetLaunchSignals();
  installLaunchSignals({ entrypoint: 'library' });
  vi.spyOn(process, 'cwd').mockReturnValue('/work/none');
});

afterEach(() => {
  resetLaunchSignals();
  vi.restoreAllMocks();
});

describe('launchSignalAttrs', () => {
  it('always carries entrypoint and nothing else when no launch was recorded', () => {
    expect(launchSignalAttrs()).toEqual({ entrypoint: 'library' });
  });

  it('omits stderr_empty when no browser launch happened (absence, not false)', () => {
    // A call that never touched a browser must not grow `stderr_empty:false`,
    // which downstream would read as "captured stderr and it was non-empty".
    const attrs = launchSignalAttrs();
    expect(attrs).not.toHaveProperty('stderr_empty');
    expect(attrs).not.toHaveProperty('browser_mode');
  });

  it('reports stderr_empty:false when the binary printed something', () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/work/project-a');
    installLaunchSignals({ stderrByteCount: () => 42, browserMode: () => 'launch' });
    expect(launchSignalAttrs('/work/project-a')).toEqual({
      stderr_empty: false,
      browser_mode: 'launch',
      entrypoint: 'library',
    });
  });

  it('reports stderr_empty:true when nothing executed (missing binary / permission)', () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/work/project-b');
    installLaunchSignals({ stderrByteCount: () => 0, browserMode: () => 'launch' });
    expect(launchSignalAttrs('/work/project-b')).toMatchObject({ stderr_empty: true });
  });

  it('attributes each cwd to its own launch instead of the latest one', () => {
    // Two agents sharing one server: the second launch must not rewrite the
    // first agent's attribution, or every tool call from agent A reads as B's.
    vi.spyOn(process, 'cwd').mockReturnValueOnce('/work/a');
    installLaunchSignals({ stderrByteCount: () => 0, browserMode: () => 'launch' });
    vi.spyOn(process, 'cwd').mockReturnValueOnce('/work/b');
    installLaunchSignals({ stderrByteCount: () => 99, browserMode: () => 'connect' });

    expect(launchSignalAttrs('/work/a')).toMatchObject({
      stderr_empty: true,
      browser_mode: 'launch',
    });
    expect(launchSignalAttrs('/work/b')).toMatchObject({
      stderr_empty: false,
      browser_mode: 'connect',
    });
    expect(readLaunchSignalsForCwd('/work/never')).toBeNull();
  });

  it('carries the installed entrypoint kind', () => {
    installLaunchSignals({ entrypoint: 'bin' });
    expect(launchSignalAttrs()).toEqual({ entrypoint: 'bin' });
  });
});

describe('detectEntrypoint', () => {
  it('treats a shim inside node_modules as the bin executable', () => {
    expect(
      detectEntrypoint([
        'C:/Program Files/nodejs/node.exe',
        'C:/Users/x/AppData/Roaming/npm/node_modules/@jshookmcp/jshook/dist/index.mjs',
      ]),
    ).toBe('bin');
  });

  it('treats a packaged executable as the bin executable', () => {
    expect(detectEntrypoint(['/usr/local/bin/jshook'])).toBe('bin');
  });

  it('treats `node dist/index.mjs` as a library start', () => {
    expect(detectEntrypoint(['/usr/bin/node', 'dist/index.mjs'])).toBe('library');
  });
});

describe('beginStderrCapture', () => {
  it('counts bytes without swallowing them from the real stderr', () => {
    const original = process.stderr.write;
    const seen: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      seen.push(String(chunk));
      return true;
    }) as never);

    const capture = beginStderrCapture();
    process.stderr.write('browser: failed to start\n');
    capture.stop();
    process.stderr.write('after stop\n');

    expect(capture.bytesSoFar()).toBe(Buffer.byteLength('browser: failed to start\n'));
    expect(seen).toEqual(['browser: failed to start\n', 'after stop\n']);
    process.stderr.write = original;
  });

  it('preserves observed bytes on a failed launch (stderr distinguishes "refused" from "never ran")', () => {
    vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as never);
    const capture = beginStderrCapture();
    process.stderr.write('sandbox denied\n');
    capture.markFailed();
    expect(capture.bytesSoFar()).toBe(Buffer.byteLength('sandbox denied\n'));
    capture.stop();
  });

  it('reference-counts overlapping captures so out-of-order stop cannot detach one', () => {
    const original = process.stderr.write;
    vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as never);
    const outer = beginStderrCapture();
    const inner = beginStderrCapture();
    process.stderr.write('abc');
    // Stopping the outer capture first must leave the inner one counting.
    outer.stop();
    process.stderr.write('de');
    inner.stop();
    expect(outer.bytesSoFar()).toBe(3);
    expect(inner.bytesSoFar()).toBe(5);
    process.stderr.write = original;
  });

  it('restores the original write exactly once', () => {
    vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as never);
    const capture = beginStderrCapture();
    capture.stop();
    capture.stop();
    expect(capture.isInstalled()).toBe(true);
    expect(() => process.stderr.write('x')).not.toThrow();
  });

  it('noop capture reports itself uninstalled', () => {
    const capture = noopStderrCapture();
    expect(capture.isInstalled()).toBe(false);
    expect(capture.bytesSoFar()).toBe(0);
    capture.stop();
    capture.markFailed();
  });
});
