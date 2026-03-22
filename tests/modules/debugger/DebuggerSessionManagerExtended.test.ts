import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

import { DebuggerSessionManager } from '@modules/debugger/DebuggerSessionManager';

describe('DebuggerSessionManager - session lifecycle', () => {
  let workDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dbg-sess-ext-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(workDir);
  });

  afterEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    cwdSpy.mockRestore();
    await rm(workDir, { recursive: true, force: true });
  });

  it('exports session with empty breakpoints map', () => {
    const managerMock = {
      getBreakpoints: () => new Map(),
      getPauseOnExceptionsState: () => 'none',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;

    const sm = new DebuggerSessionManager(managerMock);
    const session = sm.exportSession();

    expect(session.version).toBe('1.0');
    expect(session.breakpoints).toHaveLength(0);
    expect(session.pauseOnExceptions).toBe('none');
    expect(session.metadata).toEqual({});
  });

  it('exports session with multiple breakpoints and preserves location fields', () => {
    const managerMock = {
      getBreakpoints: () =>
        new Map([
          [
            'bp1',
            {
              location: {
                url: 'https://a.js',
                scriptId: 'sid-1',
                lineNumber: 10,
                columnNumber: 5,
              },
              condition: 'x > 0',
              enabled: true,
            },
          ],
          [
            'bp2',
            {
              location: { lineNumber: 20 },
              enabled: false,
            },
          ],
        ]),
      getPauseOnExceptionsState: () => 'all',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;

    const sm = new DebuggerSessionManager(managerMock);
    const session = sm.exportSession({ description: 'test session' });

    expect(session.breakpoints).toHaveLength(2);
    expect(session.breakpoints[0]!.condition).toBe('x > 0');
    expect(session.breakpoints[0]!.location.lineNumber).toBe(10);
    expect(session.pauseOnExceptions).toBe('all');
    expect(session.metadata).toEqual({ description: 'test session' });
  });

  it('saves session to a custom file path within cwd', async () => {
    const managerMock = {
      getBreakpoints: () => new Map(),
      getPauseOnExceptionsState: () => 'none',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;

    const sm = new DebuggerSessionManager(managerMock);
    const customDir = join(workDir, 'custom');
    await mkdir(customDir, { recursive: true });
    const customPath = join(customDir, 'my-session.json');
    const savedPath = await sm.saveSession(customPath);

    expect(savedPath).toContain('my-session.json');
    const content = await readFile(savedPath, 'utf-8');
    const parsed = JSON.parse(content);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parsed.version).toBe('1.0');
  });

  it('saves session to default path when no filePath given', async () => {
    const managerMock = {
      getBreakpoints: () => new Map(),
      getPauseOnExceptionsState: () => 'uncaught',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;

    const sm = new DebuggerSessionManager(managerMock);
    const savedPath = await sm.saveSession();

    expect(savedPath).toContain('debugger-sessions');
    expect(savedPath).toMatch(/session-\d+\.json$/);
    const content = await readFile(savedPath, 'utf-8');
    const parsed = JSON.parse(content);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parsed.pauseOnExceptions).toBe('uncaught');
  });

  it('rejects saving to a path outside cwd and tmp', async () => {
    const managerMock = {
      getBreakpoints: () => new Map(),
      getPauseOnExceptionsState: () => 'none',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;

    const sm = new DebuggerSessionManager(managerMock);

    await expect(sm.saveSession('/etc/passwd/session.json')).rejects.toThrow(
      'filePath must be within the current working directory or system temp dir'
    );
  });
});

describe('DebuggerSessionManager - importSession', () => {
  let workDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dbg-imp-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(workDir);
  });

  afterEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    cwdSpy.mockRestore();
    await rm(workDir, { recursive: true, force: true });
  });

  it('throws when debugger is not enabled', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const managerMock = { isEnabled: () => false } as any;
    const sm = new DebuggerSessionManager(managerMock);

    await expect(
      sm.importSession({
        version: '1.0',
        timestamp: Date.now(),
        breakpoints: [],
        pauseOnExceptions: 'none',
      })
    ).rejects.toThrow('Debugger must be enabled');
  });

  it('accepts string JSON as input', async () => {
    const managerMock = {
      isEnabled: () => true,
      clearAllBreakpoints: vi.fn().mockResolvedValue(undefined),
      setBreakpointByUrl: vi.fn().mockResolvedValue(undefined),
      setPauseOnExceptions: vi.fn().mockResolvedValue(undefined),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;

    const sm = new DebuggerSessionManager(managerMock);
    const sessionStr = JSON.stringify({
      version: '1.0',
      timestamp: Date.now(),
      breakpoints: [{ location: { url: 'https://a.js', lineNumber: 1 }, enabled: true }],
      pauseOnExceptions: 'uncaught',
    });

    await sm.importSession(sessionStr);

    expect(managerMock.setBreakpointByUrl).toHaveBeenCalledTimes(1);
    expect(managerMock.setPauseOnExceptions).toHaveBeenCalledWith('uncaught');
  });

  it('warns on version mismatch but still imports', async () => {
    const managerMock = {
      isEnabled: () => true,
      clearAllBreakpoints: vi.fn().mockResolvedValue(undefined),
      setPauseOnExceptions: vi.fn().mockResolvedValue(undefined),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;

    const sm = new DebuggerSessionManager(managerMock);
    await sm.importSession({
      version: '2.0',
      timestamp: Date.now(),
      breakpoints: [],
      pauseOnExceptions: 'none',
    });

    expect(loggerState.warn).toHaveBeenCalledWith(
      expect.stringContaining('Session version mismatch: 2.0')
    );
  });

  it('skips breakpoints with neither url nor scriptId', async () => {
    const managerMock = {
      isEnabled: () => true,
      clearAllBreakpoints: vi.fn().mockResolvedValue(undefined),
      setBreakpointByUrl: vi.fn().mockResolvedValue(undefined),
      setBreakpoint: vi.fn().mockResolvedValue(undefined),
      setPauseOnExceptions: vi.fn().mockResolvedValue(undefined),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;

    const sm = new DebuggerSessionManager(managerMock);
    await sm.importSession({
      version: '1.0',
      timestamp: Date.now(),
      breakpoints: [{ location: { lineNumber: 0 }, enabled: true }],
      pauseOnExceptions: 'none',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any);

    expect(managerMock.setBreakpointByUrl).not.toHaveBeenCalled();
    expect(managerMock.setBreakpoint).not.toHaveBeenCalled();
    expect(loggerState.warn).toHaveBeenCalledWith(
      'Breakpoint has neither url nor scriptId, skipping',
      expect.anything()
    );
  });

  it('handles failed breakpoint restoration gracefully', async () => {
    const managerMock = {
      isEnabled: () => true,
      clearAllBreakpoints: vi.fn().mockResolvedValue(undefined),
      setBreakpointByUrl: vi.fn().mockRejectedValue(new Error('Failed to set')),
      setPauseOnExceptions: vi.fn().mockResolvedValue(undefined),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;

    const sm = new DebuggerSessionManager(managerMock);
    await sm.importSession({
      version: '1.0',
      timestamp: Date.now(),
      breakpoints: [{ location: { url: 'https://a.js', lineNumber: 1 }, enabled: true }],
      pauseOnExceptions: 'none',
    });

    expect(loggerState.error).toHaveBeenCalledWith(
      'Failed to restore breakpoint:',
      expect.any(Error),
      expect.anything()
    );
  });

  it('does not call setPauseOnExceptions when session has no pauseOnExceptions', async () => {
    const managerMock = {
      isEnabled: () => true,
      clearAllBreakpoints: vi.fn().mockResolvedValue(undefined),
      setPauseOnExceptions: vi.fn().mockResolvedValue(undefined),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;

    const sm = new DebuggerSessionManager(managerMock);
    await sm.importSession({
      version: '1.0',
      timestamp: Date.now(),
      breakpoints: [],
      pauseOnExceptions: '',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any);

    expect(managerMock.setPauseOnExceptions).not.toHaveBeenCalled();
  });

  it('imports breakpoints by scriptId when url is absent', async () => {
    const managerMock = {
      isEnabled: () => true,
      clearAllBreakpoints: vi.fn().mockResolvedValue(undefined),
      setBreakpointByUrl: vi.fn().mockResolvedValue(undefined),
      setBreakpoint: vi.fn().mockResolvedValue(undefined),
      setPauseOnExceptions: vi.fn().mockResolvedValue(undefined),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;

    const sm = new DebuggerSessionManager(managerMock);
    await sm.importSession({
      version: '1.0',
      timestamp: Date.now(),
      breakpoints: [
        {
          location: { scriptId: 's1', lineNumber: 10, columnNumber: 3 },
          condition: 'y>0',
          enabled: true,
        },
      ],
      pauseOnExceptions: 'none',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any);

    expect(managerMock.setBreakpoint).toHaveBeenCalledWith({
      scriptId: 's1',
      lineNumber: 10,
      columnNumber: 3,
      condition: 'y>0',
    });
    expect(managerMock.setBreakpointByUrl).not.toHaveBeenCalled();
  });
});

describe('DebuggerSessionManager - loadSessionFromFile', () => {
  let workDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dbg-load-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(workDir);
  });

  afterEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    cwdSpy.mockRestore();
    await rm(workDir, { recursive: true, force: true });
  });

  it('loads session from a file and imports it', async () => {
    const sessionData = {
      version: '1.0',
      timestamp: Date.now(),
      breakpoints: [{ location: { url: 'https://a.js', lineNumber: 5 }, enabled: true }],
      pauseOnExceptions: 'all',
    };

    const filePath = join(workDir, 'load-test.json');
    await writeFile(filePath, JSON.stringify(sessionData));

    const managerMock = {
      isEnabled: () => true,
      clearAllBreakpoints: vi.fn().mockResolvedValue(undefined),
      setBreakpointByUrl: vi.fn().mockResolvedValue(undefined),
      setPauseOnExceptions: vi.fn().mockResolvedValue(undefined),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;

    const sm = new DebuggerSessionManager(managerMock);
    await sm.loadSessionFromFile(filePath);

    expect(managerMock.setBreakpointByUrl).toHaveBeenCalledTimes(1);
    expect(managerMock.setPauseOnExceptions).toHaveBeenCalledWith('all');
  });

  it('rejects loading a file outside allowed paths', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const managerMock = {} as any;
    const sm = new DebuggerSessionManager(managerMock);

    await expect(sm.loadSessionFromFile('/etc/shadow')).rejects.toThrow(
      'filePath must be within the current working directory or system temp dir'
    );
  });
});

describe('DebuggerSessionManager - listSavedSessions', () => {
  let workDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dbg-list-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(workDir);
  });

  afterEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    cwdSpy.mockRestore();
    await rm(workDir, { recursive: true, force: true });
  });

  it('returns empty array when debugger-sessions directory does not exist', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const managerMock = {} as any;
    const sm = new DebuggerSessionManager(managerMock);
    const sessions = await sm.listSavedSessions();

    expect(sessions).toEqual([]);
  });

  it('ignores non-JSON files in the sessions directory', async () => {
    const sessionsDir = join(workDir, 'debugger-sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, 'session.json'),
      JSON.stringify({ version: '1.0', timestamp: 1000, breakpoints: [] })
    );
    await writeFile(join(sessionsDir, 'readme.txt'), 'not a session');
    await writeFile(join(sessionsDir, 'backup.bak'), 'backup data');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const managerMock = {} as any;
    const sm = new DebuggerSessionManager(managerMock);
    const sessions = await sm.listSavedSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.timestamp).toBe(1000);
  });

  it('handles malformed JSON files gracefully', async () => {
    const sessionsDir = join(workDir, 'debugger-sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(join(sessionsDir, 'bad.json'), '{invalid json');
    await writeFile(
      join(sessionsDir, 'good.json'),
      JSON.stringify({ version: '1.0', timestamp: 5000, breakpoints: [], metadata: { id: 'good' } })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const managerMock = {} as any;
    const sm = new DebuggerSessionManager(managerMock);
    const sessions = await sm.listSavedSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.metadata).toEqual({ id: 'good' });
    expect(loggerState.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to read session file'),
      expect.anything()
    );
  });

  it('sorts sessions by descending timestamp', async () => {
    const sessionsDir = join(workDir, 'debugger-sessions');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, 'first.json'),
      JSON.stringify({
        version: '1.0',
        timestamp: 100,
        breakpoints: [],
        metadata: { id: 'oldest' },
      })
    );
    await writeFile(
      join(sessionsDir, 'second.json'),
      JSON.stringify({
        version: '1.0',
        timestamp: 300,
        breakpoints: [],
        metadata: { id: 'newest' },
      })
    );
    await writeFile(
      join(sessionsDir, 'third.json'),
      JSON.stringify({
        version: '1.0',
        timestamp: 200,
        breakpoints: [],
        metadata: { id: 'middle' },
      })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const managerMock = {} as any;
    const sm = new DebuggerSessionManager(managerMock);
    const sessions = await sm.listSavedSessions();

    expect(sessions).toHaveLength(3);
    expect(sessions[0]!.metadata!.id).toBe('newest');
    expect(sessions[1]!.metadata!.id).toBe('middle');
    expect(sessions[2]!.metadata!.id).toBe('oldest');
  });
});

describe('DebuggerSessionManager - validateFilePath', () => {
  let workDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dbg-val-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(workDir);
  });

  afterEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    cwdSpy.mockRestore();
    await rm(workDir, { recursive: true, force: true });
  });

  it('allows saving to tmp directory', async () => {
    const managerMock = {
      getBreakpoints: () => new Map(),
      getPauseOnExceptionsState: () => 'none',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;

    const sm = new DebuggerSessionManager(managerMock);
    const tmpPath = join(tmpdir(), 'test-session.json');

    const savedPath = await sm.saveSession(tmpPath);

    expect(savedPath).toContain('test-session.json');
    // Clean up
    const { rm: rmFile } = await import('node:fs/promises');
    await rmFile(savedPath, { force: true });
  });

  it('allows saving to subdirectory of cwd', async () => {
    const managerMock = {
      getBreakpoints: () => new Map(),
      getPauseOnExceptionsState: () => 'none',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;

    const sm = new DebuggerSessionManager(managerMock);
    const nestedDir = join(workDir, 'sub', 'deep');
    await mkdir(nestedDir, { recursive: true });
    const nestedPath = join(nestedDir, 'session.json');

    const savedPath = await sm.saveSession(nestedPath);

    expect(savedPath).toContain('session.json');
    const content = await readFile(savedPath, 'utf-8');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(JSON.parse(content).version).toBe('1.0');
  });
});
