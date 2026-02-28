import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { DebuggerSessionManager } from '../../../src/modules/debugger/DebuggerSessionManager.js';

describe('DebuggerSessionManager', () => {
  let cwdBefore: string;
  let workDir: string;

  beforeEach(async () => {
    cwdBefore = process.cwd();
    workDir = await mkdtemp(join(tmpdir(), 'dbg-session-'));
    process.chdir(workDir);
  });

  afterEach(async () => {
    process.chdir(cwdBefore);
    await rm(workDir, { recursive: true, force: true });
  });

  it('exports session with breakpoints and metadata', () => {
    const managerMock = {
      getBreakpoints: () =>
        new Map([
          [
            'bp1',
            {
              location: { url: 'https://a.js', lineNumber: 1, columnNumber: 2 },
              condition: 'x>0',
              enabled: true,
            },
          ],
        ]),
      getPauseOnExceptionsState: () => 'uncaught',
    } as any;

    const sessionManager = new DebuggerSessionManager(managerMock);
    const session = sessionManager.exportSession({ tag: 'unit' });

    expect(session.version).toBe('1.0');
    expect(session.breakpoints).toHaveLength(1);
    expect(session.pauseOnExceptions).toBe('uncaught');
    expect(session.metadata).toEqual({ tag: 'unit' });
  });

  it('throws when importing session while debugger is disabled', async () => {
    const managerMock = { isEnabled: () => false } as any;
    const sessionManager = new DebuggerSessionManager(managerMock);

    await expect(
      sessionManager.importSession({
        version: '1.0',
        timestamp: Date.now(),
        breakpoints: [],
        pauseOnExceptions: 'none',
      } as any)
    ).rejects.toThrow('Debugger must be enabled');
  });

  it('imports url/script breakpoints and applies pauseOnExceptions', async () => {
    const managerMock = {
      isEnabled: vi.fn(() => true),
      clearAllBreakpoints: vi.fn().mockResolvedValue(undefined),
      setBreakpointByUrl: vi.fn().mockResolvedValue(undefined),
      setBreakpoint: vi.fn().mockResolvedValue(undefined),
      setPauseOnExceptions: vi.fn().mockResolvedValue(undefined),
    } as any;

    const sessionManager = new DebuggerSessionManager(managerMock);
    await sessionManager.importSession({
      version: '1.0',
      timestamp: Date.now(),
      breakpoints: [
        { location: { url: 'https://a.js', lineNumber: 3 }, enabled: true },
        { location: { scriptId: 's1', lineNumber: 7 }, enabled: true },
        { location: { lineNumber: 0 }, enabled: true },
      ],
      pauseOnExceptions: 'all',
    } as any);

    expect(managerMock.clearAllBreakpoints).toHaveBeenCalledTimes(1);
    expect(managerMock.setBreakpointByUrl).toHaveBeenCalledTimes(1);
    expect(managerMock.setBreakpoint).toHaveBeenCalledTimes(1);
    expect(managerMock.setPauseOnExceptions).toHaveBeenCalledWith('all');
  });

  it('saves session JSON to disk (default path)', async () => {
    const managerMock = {
      getBreakpoints: () => new Map(),
      getPauseOnExceptionsState: () => 'none',
    } as any;
    const sessionManager = new DebuggerSessionManager(managerMock);
    const savedPath = await sessionManager.saveSession(undefined, { source: 'test' });

    const content = await readFile(savedPath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(savedPath).toContain('debugger-sessions');
    expect(parsed.metadata).toEqual({ source: 'test' });
  });

  it('lists saved sessions sorted by descending timestamp and skips invalid files', async () => {
    const sessionsDir = join(workDir, 'debugger-sessions');
    await mkdir(sessionsDir, { recursive: true });

    await writeFile(
      join(sessionsDir, 'a.json'),
      JSON.stringify({ version: '1.0', timestamp: 1000, breakpoints: [], metadata: { id: 'a' } })
    );
    await writeFile(
      join(sessionsDir, 'b.json'),
      JSON.stringify({ version: '1.0', timestamp: 2000, breakpoints: [], metadata: { id: 'b' } })
    );
    await writeFile(join(sessionsDir, 'broken.json'), '{not-json');

    const managerMock = {} as any;
    const sessionManager = new DebuggerSessionManager(managerMock);
    const sessions = await sessionManager.listSavedSessions();

    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.metadata?.id).toBe('b');
    expect(sessions[1]?.metadata?.id).toBe('a');
  });
});

