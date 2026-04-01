import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSpawn = vi.hoisted(() => vi.fn());
const mockReadFile = vi.hoisted(() => vi.fn());
const mockPathExists = vi.hoisted(() => vi.fn());
const mockParseStringArg = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}));

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
}));

vi.mock('@server/domains/platform/handlers/platform-utils', () => ({
  toTextResponse: (payload: Record<string, unknown>) => ({
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  }),
  toErrorResponse: (tool: string, error: unknown) => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          success: false,
          tool,
          error: error instanceof Error ? error.message : String(error),
        }),
      },
    ],
  }),
  parseStringArg: mockParseStringArg,
  pathExists: mockPathExists,
}));

vi.stubGlobal('fetch', mockFetch);

type JsonPayload = Record<string, unknown>;

function parse(result: { content: Array<{ text?: string }> }): JsonPayload {
  return JSON.parse(result.content[0]!.text!) as JsonPayload;
}

function makeFuseBuffer(
  overrides: Partial<{ runAsNode: boolean; inspectArgs: boolean; nodeOptions: boolean }> = {},
) {
  const sentinel = 'dL7pKGdnNz796PbbjQWNKmHXBZIA';
  const buffer = Buffer.alloc(64);
  buffer.write(sentinel, 0, 'ascii');
  const base = sentinel.length;
  buffer[base] = overrides.runAsNode === false ? 0 : 0x31;
  buffer[base + 2] = overrides.nodeOptions === false ? 0 : 0x31;
  buffer[base + 3] = overrides.inspectArgs === false ? 0 : 0x31;
  return buffer;
}

async function loadModule() {
  vi.resetModules();
  return await import('@server/domains/platform/handlers/electron-dual-cdp');
}

describe('electron_launch_debug', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathExists.mockResolvedValue(false);
    mockParseStringArg.mockImplementation((args: Record<string, unknown>, key: string) => {
      const value = args[key];
      return typeof value === 'string' ? value : undefined;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should error on non-existent exePath', async () => {
    const { handleElectronLaunchDebug } = await loadModule();

    const result = parse(
      await handleElectronLaunchDebug({
        exePath: 'C:\\nonexistent\\path\\app.exe',
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('does not exist');
  });

  it('should require exePath', async () => {
    const { handleElectronLaunchDebug } = await loadModule();
    const result = parse(await handleElectronLaunchDebug({}));
    expect(result.success).toBe(false);
  });

  it('should launch with fuse warnings and register a status session', async () => {
    const { handleElectronLaunchDebug, handleElectronDebugStatus } = await loadModule();

    mockPathExists.mockResolvedValueOnce(true);
    mockReadFile.mockResolvedValueOnce(
      makeFuseBuffer({ runAsNode: false, inspectArgs: false, nodeOptions: false }),
    );
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => 'ready',
    });
    mockSpawn.mockReturnValue({ pid: 4242, unref: vi.fn() });

    const launch = parse(
      await handleElectronLaunchDebug({
        exePath: 'C:\\Electron\\electron.exe',
        mainPort: 9333,
        rendererPort: 9334,
        args: ['--foo'],
        waitMs: 0,
      }),
    );

    expect(launch.success).toBe(true);
    expect(launch.sessionId).toBe('electron-4242');
    expect(launch.fuseWarnings).toHaveLength(3);
    expect(mockSpawn).toHaveBeenCalledWith(
      'C:\\Electron\\electron.exe',
      ['--inspect=9333', '--remote-debugging-port=9334', '--foo'],
      expect.objectContaining({ detached: true, stdio: 'ignore' }),
    );

    const status = parse(await handleElectronDebugStatus({ sessionId: 'electron-4242' }));
    expect(status.success).toBe(true);
    expect(status.main.alive).toBe(true);
    expect(status.renderer.alive).toBe(true);
  });
});

describe('electron_debug_status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathExists.mockResolvedValue(false);
    mockParseStringArg.mockImplementation((args: Record<string, unknown>, key: string) => {
      const value = args[key];
      return typeof value === 'string' ? value : undefined;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return empty sessions list when no sessions launched', async () => {
    const { handleElectronDebugStatus } = await loadModule();
    const result = parse(await handleElectronDebugStatus({}));

    expect(result.success).toBe(true);
    expect(Array.isArray(result.sessions)).toBe(true);
    expect((result.sessions as unknown[]).length).toBe(0);
  });

  it('should return error for non-existent session ID', async () => {
    const { handleElectronDebugStatus } = await loadModule();
    const result = parse(
      await handleElectronDebugStatus({
        sessionId: 'electron-nonexistent',
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('No session found');
  });
});
