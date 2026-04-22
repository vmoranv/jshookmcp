import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted mocks — available inside vi.mock factories
const { probeAllMock, execFileMock, mockFetch } = vi.hoisted(() => ({
  probeAllMock: vi.fn().mockResolvedValue({}),
  execFileMock: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock('@modules/external/ToolRegistry', () => ({
  ToolRegistry: class MockToolRegistry {
    probeAll = probeAllMock;
  },
}));

vi.mock('@utils/outputPaths', () => ({
  getProjectRoot: vi.fn(() => '/mock/project/root'),
}));

vi.mock('@utils/artifactRetention', () => ({
  getArtifactRetentionConfig: vi.fn(() => ({
    enabled: false,
    retentionDays: 0,
    maxTotalBytes: 0,
    cleanupIntervalMinutes: 0,
    cleanupOnStart: false,
  })),
}));

vi.mock('@src/constants', () => ({
  GHIDRA_BRIDGE_ENDPOINT: 'http://127.0.0.1:18080',
  IDA_BRIDGE_ENDPOINT: 'http://127.0.0.1:18081',
}));

vi.mock('node:child_process', () => {
  const custom = Symbol.for('nodejs.util.promisify.custom');
  (execFileMock as any)[custom] = execFileMock;
  return { execFile: execFileMock };
});

vi.stubGlobal('fetch', mockFetch);

import {
  runEnvironmentDoctor,
  formatEnvironmentDoctorReport,
  type EnvironmentDoctorReport,
} from '@utils/environmentDoctor';
// ToolRegistry is mocked as a real class in vi.mock above

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMinimalReport(overrides?: Partial<EnvironmentDoctorReport>): EnvironmentDoctorReport {
  return {
    success: true,
    generatedAt: '2026-01-01T00:00:00.000Z',
    runtime: {
      platform: 'win32',
      arch: 'x64',
      node: 'v22.0.0',
      cwd: '/work',
      projectRoot: '/project',
    },
    packages: [],
    commands: [],
    bridges: [],
    config: {},
    limitations: [],
    recommendations: [],
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ---------------------------------------------------------------------------
// runEnvironmentDoctor
// ---------------------------------------------------------------------------

describe('runEnvironmentDoctor', () => {
  beforeEach(() => {
    probeAllMock.mockReset().mockResolvedValue({});
    execFileMock.mockReset();
    mockFetch.mockReset();

    execFileMock.mockImplementation((cmd: string) => {
      if (cmd === 'git') return Promise.resolve({ stdout: 'git version 2.43.0', stderr: '' });
      if (cmd === 'python') return Promise.resolve({ stdout: 'Python 3.12.0', stderr: '' });
      if (cmd === 'pnpm') return Promise.resolve({ stdout: '10.28.2', stderr: '' });
      return Promise.resolve({ stdout: 'available', stderr: '' });
    });

    mockFetch.mockRejectedValue(new Error('connect ECONNREFUSED'));
  });

  it('returns a report with runtime info', async () => {
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    expect(report.runtime.platform).toBe(process.platform);
    expect(report.runtime.arch).toBe(process.arch);
    expect(report.runtime.node).toBe(process.version);
    expect(report.generatedAt).toBeDefined();
  });

  it('starts command probes in parallel with external tool probing', async () => {
    const probeDeferred = createDeferred<Record<string, never>>();
    const commandDeferreds = new Map<
      string,
      ReturnType<typeof createDeferred<{ stdout: string; stderr: string }>>
    >();

    probeAllMock.mockReturnValue(probeDeferred.promise);
    execFileMock.mockImplementation((cmd: string, args?: string[]) => {
      const targetCmd = cmd === 'cmd' ? (args?.[1] ?? cmd) : cmd;
      const deferred = createDeferred<{ stdout: string; stderr: string }>();
      commandDeferreds.set(targetCmd, deferred);
      return deferred.promise;
    });

    const reportPromise = runEnvironmentDoctor({ includeBridgeHealth: false });
    await Promise.resolve();

    expect(probeAllMock).toHaveBeenCalledOnce();
    expect(commandDeferreds.has('git')).toBe(true);
    expect(commandDeferreds.has('python')).toBe(true);
    expect(commandDeferreds.has('pnpm')).toBe(true);
    expect(commandDeferreds.has('corepack')).toBe(true);

    probeDeferred.resolve({});
    for (const deferred of commandDeferreds.values()) {
      deferred.resolve({ stdout: 'ok', stderr: '' });
    }

    const report = await reportPromise;
    expect(report.commands.find((c) => c.name === 'git')?.status).toBe('ok');
  });

  it('reports installed packages', async () => {
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    const mcpSdk = report.packages.find((p) => p.name === '@modelcontextprotocol/sdk');
    expect(mcpSdk).toBeDefined();
    expect(['ok', 'missing']).toContain(mcpSdk!.status);
  });

  it('includes better-sqlite3 health in package checks', async () => {
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    const sqlite = report.packages.find((p) => p.name === 'better-sqlite3');
    expect(sqlite).toBeDefined();
    expect(['ok', 'missing', 'warn']).toContain(sqlite!.status);
  });

  it('checks commands and reports status', async () => {
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    const git = report.commands.find((c) => c.name === 'git');
    expect(git).toBeDefined();
    expect(git!.status).toBe('ok');
    expect(git!.detail).toContain('git version');
  });

  it('reports missing commands with ENOENT as missing', async () => {
    execFileMock.mockImplementation((cmd: string, args?: string[]) => {
      const targetCmd = cmd === 'cmd' && args ? args[1] : cmd;
      if (targetCmd === 'python') return Promise.reject(new Error('ENOENT: python not found'));
      return Promise.resolve({ stdout: 'ok', stderr: '' });
    });

    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    const python = report.commands.find((c) => c.name === 'python');
    expect(python!.status).toBe('missing');
  });

  it('reports warn for non-ENOENT command errors', async () => {
    execFileMock.mockImplementation((cmd: string, args?: string[]) => {
      const targetCmd = cmd === 'cmd' && args ? args[1] : cmd;
      if (targetCmd === 'python') return Promise.reject(new Error('permission denied'));
      return Promise.resolve({ stdout: 'ok', stderr: '' });
    });

    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    const python = report.commands.find((c) => c.name === 'python');
    expect(python!.status).toBe('warn');
  });

  it('uses stderr when stdout is empty', async () => {
    execFileMock.mockImplementation((cmd: string) => {
      if (cmd === 'git') return Promise.resolve({ stdout: '', stderr: 'git version 2.43.0' });
      return Promise.resolve({ stdout: 'ok', stderr: '' });
    });

    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    const git = report.commands.find((c) => c.name === 'git');
    expect(git!.detail).toContain('git version 2.43.0');
  });

  it('falls back to "available" when stdout and stderr are empty', async () => {
    execFileMock.mockImplementation((cmd: string) => {
      if (cmd === 'git') return Promise.resolve({ stdout: '', stderr: '' });
      return Promise.resolve({ stdout: 'ok', stderr: '' });
    });

    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    const git = report.commands.find((c) => c.name === 'git');
    expect(git!.detail).toBe('available');
  });

  it('handles non-Error rejection from command', async () => {
    execFileMock.mockImplementation((cmd: string, args?: string[]) => {
      const targetCmd = cmd === 'cmd' && args ? args[1] : cmd;
      if (targetCmd === 'python') return Promise.reject('raw string error');
      return Promise.resolve({ stdout: 'ok', stderr: '' });
    });

    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    const python = report.commands.find((c) => c.name === 'python');
    expect(python!.detail).toBe('raw string error');
  });

  it('reports pnpm as warn when only npx fallback works', async () => {
    execFileMock.mockImplementation((cmd: string, args?: string[]) => {
      const targetCmd = cmd === 'cmd' && args ? args[1] : cmd;
      if (targetCmd === 'git') {
        return Promise.resolve({ stdout: 'git version 2.43.0', stderr: '' });
      }
      if (targetCmd === 'python') {
        return Promise.resolve({ stdout: 'Python 3.12.0', stderr: '' });
      }
      if (targetCmd === 'pnpm') {
        return Promise.reject(new Error('ENOENT: pnpm not found'));
      }
      if (targetCmd === 'npx') {
        return Promise.resolve({ stdout: '10.28.2', stderr: '' });
      }
      if (targetCmd === 'corepack') {
        return Promise.reject(new Error('ENOENT: corepack not found'));
      }
      return Promise.resolve({ stdout: 'ok', stderr: '' });
    });

    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    const pnpm = report.commands.find((c) => c.name === 'pnpm');
    const corepack = report.commands.find((c) => c.name === 'corepack');

    expect(pnpm!.status).toBe('warn');
    expect(pnpm!.detail).toContain('npx fallback works');
    expect(corepack!.status).toBe('warn');
    expect(corepack!.detail).toContain('npx pnpm');
  });

  it('recommends installing pnpm when neither pnpm nor npx fallback is available', async () => {
    execFileMock.mockImplementation((cmd: string, args?: string[]) => {
      const targetCmd = cmd === 'cmd' && args ? args[1] : cmd;
      if (targetCmd === 'git') {
        return Promise.resolve({ stdout: 'git version 2.43.0', stderr: '' });
      }
      if (targetCmd === 'python') {
        return Promise.resolve({ stdout: 'Python 3.12.0', stderr: '' });
      }
      if (targetCmd === 'pnpm') {
        return Promise.reject(new Error('ENOENT: pnpm not found'));
      }
      if (targetCmd === 'npx') {
        return Promise.reject(new Error('ENOENT: npx not found'));
      }
      if (targetCmd === 'corepack') {
        return Promise.reject(new Error('ENOENT: corepack not found'));
      }
      return Promise.resolve({ stdout: 'ok', stderr: '' });
    });

    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });

    expect(report.recommendations).toContain(
      'Install pnpm or enable Corepack (`corepack enable`) before running package-management workflows.',
    );
  });

  it('falls back to cmd /c on win32 when direct execution fails', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    let cmdCallCount = 0;

    execFileMock.mockImplementation((cmd: string, _args?: string[]) => {
      // First attempt fails
      if (cmd !== 'cmd') return Promise.reject(new Error('ENOENT'));
      // Second attempt via cmd succeeds
      cmdCallCount++;
      return Promise.resolve({ stdout: 'cmd version 1.0', stderr: '' });
    });

    try {
      const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
      const git = report.commands.find((c) => c.name === 'git');
      expect(git!.status).toBe('ok');
      expect(git!.detail).toContain('cmd version 1.0 (via cmd)');
      expect(cmdCallCount).toBeGreaterThan(0);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  it('recommends using pnpm directly when corepack is missing but pnpm is standalone on Windows', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });

    execFileMock.mockImplementation((cmd: string, args?: string[]) => {
      const targetCmd = cmd === 'cmd' && args ? args[1] : cmd;
      if (targetCmd === 'pnpm') return Promise.resolve({ stdout: '10.0.0', stderr: '' });
      if (targetCmd === 'corepack') return Promise.reject(new Error('ENOENT: corepack not found'));
      return Promise.resolve({ stdout: 'ok', stderr: '' });
    });

    try {
      const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
      expect(report.recommendations.some((r) => r.includes('`corepack` is optional'))).toBe(true);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  it('handles non-Error rejection from bridge fetch', async () => {
    mockFetch.mockRejectedValue('network down');
    const report = await runEnvironmentDoctor({ includeBridgeHealth: true });
    const ghidra = report.bridges.find((b) => b.name === 'ghidra-bridge');
    expect(ghidra!.status).toBe('warn');
    expect(ghidra!.detail).toContain('network down');
  });

  it('includes external tool registry results in commands', async () => {
    probeAllMock.mockResolvedValue({
      'wabt.wasm2wat': { available: true, path: '/usr/bin/wasm2wat', version: '1.0' },
      'wabt.wasm-decompile': { available: false, reason: 'Not installed' },
    });

    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    const wasm2wat = report.commands.find((c) => c.name === 'wabt.wasm2wat');
    expect(wasm2wat!.status).toBe('ok');
    const decompile = report.commands.find((c) => c.name === 'wabt.wasm-decompile');
    expect(decompile!.status).toBe('missing');
  });

  it('forces a fresh external tool probe for each doctor run', async () => {
    await runEnvironmentDoctor({ includeBridgeHealth: false });
    expect(probeAllMock).toHaveBeenCalledWith(true);
  });

  it('external tool uses PATH fallback when path is undefined', async () => {
    probeAllMock.mockResolvedValue({
      'tool.nop': { available: true },
    });
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    const nop = report.commands.find((c) => c.name === 'tool.nop');
    expect(nop!.detail).toBe('PATH');
  });

  it('external tool uses Unavailable fallback when reason is undefined', async () => {
    probeAllMock.mockResolvedValue({
      'tool.gone': { available: false },
    });
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    const gone = report.commands.find((c) => c.name === 'tool.gone');
    expect(gone!.status).toBe('missing');
    expect(gone!.detail).toBe('Unavailable');
  });

  it('external tool omits version when version is falsy', async () => {
    probeAllMock.mockResolvedValue({
      'tool.noversion': { available: true, path: '/usr/bin/x' },
    });
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    const t = report.commands.find((c) => c.name === 'tool.noversion');
    expect(t!.detail).toBe('/usr/bin/x');
    expect(t!.detail).not.toContain('(');
  });

  it('uses production defaults when NODE_ENV is production', async () => {
    const origSig = process.env.MCP_PLUGIN_SIGNATURE_REQUIRED;
    const origStrict = process.env.MCP_PLUGIN_STRICT_LOAD;
    const origEnv = process.env.NODE_ENV;
    delete process.env.MCP_PLUGIN_SIGNATURE_REQUIRED;
    delete process.env.MCP_PLUGIN_STRICT_LOAD;
    process.env.NODE_ENV = 'production';

    try {
      const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
      expect(report.config.pluginSignatureRequired).toBe('true (production default)');
      expect(report.config.pluginStrictLoad).toBe('true (production default)');
    } finally {
      process.env.MCP_PLUGIN_SIGNATURE_REQUIRED = origSig;
      process.env.MCP_PLUGIN_STRICT_LOAD = origStrict;
      process.env.NODE_ENV = origEnv;
    }
  });

  it('checks bridge health when includeBridgeHealth is true', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    const report = await runEnvironmentDoctor({ includeBridgeHealth: true });
    expect(report.bridges.length).toBeGreaterThan(0);
    const ghidra = report.bridges.find((b) => b.name === 'ghidra-bridge');
    expect(ghidra!.status).toBe('ok');
  });

  it('reports warn for bridge health failures', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    const report = await runEnvironmentDoctor({ includeBridgeHealth: true });
    const ghidra = report.bridges.find((b) => b.name === 'ghidra-bridge');
    expect(ghidra!.status).toBe('warn');
    expect(ghidra!.detail).toContain('ECONNREFUSED');
  });

  it('reports warn for non-ok HTTP status from bridge', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const report = await runEnvironmentDoctor({ includeBridgeHealth: true });
    const ghidra = report.bridges.find((b) => b.name === 'ghidra-bridge');
    expect(ghidra!.status).toBe('warn');
    expect(ghidra!.detail).toContain('500');
  });

  it('skips bridges when includeBridgeHealth is false', async () => {
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    expect(report.bridges).toHaveLength(0);
  });

  it('defaults includeBridgeHealth to true', async () => {
    mockFetch.mockRejectedValue(new Error('refused'));
    const report = await runEnvironmentDoctor();
    expect(report.bridges.length).toBeGreaterThan(0);
  });

  it('success is true when no checks have error status', async () => {
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    expect(report.success).toBe(true);
  });

  it('includes config from environment', async () => {
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    expect(report.config).toHaveProperty('transport');
    expect(report.config).toHaveProperty('toolProfile');
    expect(report.config).toHaveProperty('artifactRetention');
  });

  it('includes platform limitations', async () => {
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    if (process.platform === 'darwin') {
      expect(report.limitations.some((l) => l.includes('cross-platform memory tools'))).toBe(true);
      expect(report.limitations.some((l) => l.includes('SIP'))).toBe(true);
    } else if (process.platform === 'linux') {
      expect(report.limitations.some((l) => l.includes('/proc'))).toBe(true);
    }
  });

  it('includes native-memory check in packages', async () => {
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    const nativeMem = report.packages.find((p) => p.name === 'native-memory');
    expect(nativeMem).toBeDefined();
    expect(['ok', 'warn', 'missing']).toContain(nativeMem!.status);
  });

  it('recommends camoufox install when package is missing', async () => {
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    const camoufox = report.packages.find((p) => p.name === 'camoufox-js');
    if (camoufox && camoufox.status !== 'ok') {
      expect(report.recommendations.some((r) => r.includes('Camoufox'))).toBe(true);
    }
  });

  it('recommends fixing better-sqlite3 when trace backend is unavailable', async () => {
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    const sqlite = report.packages.find((p) => p.name === 'better-sqlite3');
    if (sqlite && sqlite.status !== 'ok') {
      expect(report.recommendations.some((r) => r.includes('better-sqlite3'))).toBe(true);
    }
  });

  it('recommends checking bridges when bridge health fails', async () => {
    mockFetch.mockRejectedValue(new Error('refused'));
    const report = await runEnvironmentDoctor({ includeBridgeHealth: true });
    expect(report.recommendations.some((r) => r.includes('bridge'))).toBe(true);
  });

  it('recommends wabt when wabt tools are missing', async () => {
    probeAllMock.mockResolvedValue({
      'wabt.wasm2wat': { available: false, reason: 'Not installed' },
    });
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    expect(report.recommendations.some((r) => r.includes('wabt'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildPlatformLimitations — platform-mocked tests
// ---------------------------------------------------------------------------

describe('buildPlatformLimitations (via runEnvironmentDoctor)', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    probeAllMock.mockReset().mockResolvedValue({});
    execFileMock.mockReset().mockResolvedValue({ stdout: 'ok', stderr: '' });
    mockFetch.mockReset().mockRejectedValue(new Error('refused'));
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('darwin: mentions cross-platform memory tools and SIP', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    expect(report.limitations.some((l) => l.includes('26 cross-platform memory tools'))).toBe(true);
    expect(report.limitations.some((l) => l.includes('SIP'))).toBe(true);
  });

  it('linux: mentions /proc and Camoufox', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    expect(report.limitations.some((l) => l.includes('/proc'))).toBe(true);
    expect(report.limitations.some((l) => l.includes('Camoufox'))).toBe(true);
  });

  it('win32: returns no limitations', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    expect(report.limitations).toHaveLength(0);
  });

  it('unsupported platform: mentions platform name', async () => {
    Object.defineProperty(process, 'platform', { value: 'freebsd' });
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    expect(report.limitations.some((l) => l.includes('freebsd'))).toBe(true);
    expect(report.limitations.some((l) => l.includes('not supported'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkNativeMemory — platform-mocked tests
// ---------------------------------------------------------------------------

describe('checkNativeMemory (via runEnvironmentDoctor)', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    probeAllMock.mockReset().mockResolvedValue({});
    execFileMock.mockReset().mockResolvedValue({ stdout: 'ok', stderr: '' });
    mockFetch.mockReset().mockRejectedValue(new Error('refused'));
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('darwin: reports ok with libSystem.B.dylib detail', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    const nativeMem = report.packages.find((p) => p.name === 'native-memory');
    expect(nativeMem).toBeDefined();
    expect(['ok', 'warn']).toContain(nativeMem!.status);
    expect(nativeMem!.detail).toContain('libSystem.B.dylib');
  });

  it('win32: reports ok with Win32 detail', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    const nativeMem = report.packages.find((p) => p.name === 'native-memory');
    expect(nativeMem).toBeDefined();
    expect(nativeMem!.status).toBe('ok');
    expect(nativeMem!.detail).toContain('Win32');
  });

  it('linux: reports warn with proc-based detail', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    const nativeMem = report.packages.find((p) => p.name === 'native-memory');
    expect(nativeMem).toBeDefined();
    expect(nativeMem!.status).toBe('warn');
    expect(nativeMem!.detail).toContain('proc-based');
  });
});

// ---------------------------------------------------------------------------
// formatEnvironmentDoctorReport
// ---------------------------------------------------------------------------

describe('formatEnvironmentDoctorReport', () => {
  it('includes runtime info in output', () => {
    const output = formatEnvironmentDoctorReport(makeMinimalReport());
    expect(output).toContain('win32 x64');
    expect(output).toContain('Node v22.0.0');
  });

  it('includes packages section', () => {
    const output = formatEnvironmentDoctorReport(
      makeMinimalReport({
        packages: [{ name: 'test-pkg', status: 'ok', detail: 'installed (1.0.0)' }],
      }),
    );
    expect(output).toContain('Packages:');
    expect(output).toContain('[ok] test-pkg: installed (1.0.0)');
  });

  it('includes commands section', () => {
    const output = formatEnvironmentDoctorReport(
      makeMinimalReport({
        commands: [{ name: 'git', status: 'ok', detail: 'git version 2.43.0' }],
      }),
    );
    expect(output).toContain('Commands:');
    expect(output).toContain('[ok] git');
  });

  it('includes bridge health section when bridges exist', () => {
    const output = formatEnvironmentDoctorReport(
      makeMinimalReport({
        bridges: [{ name: 'ghidra-bridge', status: 'warn', detail: 'refused' }],
      }),
    );
    expect(output).toContain('Bridge health:');
    expect(output).toContain('[warn] ghidra-bridge');
  });

  it('omits bridge section when bridges are empty', () => {
    const output = formatEnvironmentDoctorReport(makeMinimalReport({ bridges: [] }));
    expect(output).not.toContain('Bridge health:');
  });

  it('includes config section with JSON for objects', () => {
    const output = formatEnvironmentDoctorReport(
      makeMinimalReport({ config: { transport: 'stdio', nested: { key: 'value' } } }),
    );
    expect(output).toContain('transport: stdio');
    expect(output).toContain('nested: {"key":"value"}');
  });

  it('includes limitations when present', () => {
    const output = formatEnvironmentDoctorReport(
      makeMinimalReport({ limitations: ['Memory tools Windows-only'] }),
    );
    expect(output).toContain('Platform limitations:');
    expect(output).toContain('Memory tools Windows-only');
  });

  it('omits limitations section when empty', () => {
    const output = formatEnvironmentDoctorReport(makeMinimalReport({ limitations: [] }));
    expect(output).not.toContain('Platform limitations:');
  });

  it('includes recommendations when present', () => {
    const output = formatEnvironmentDoctorReport(
      makeMinimalReport({ recommendations: ['Install wabt for WASM support'] }),
    );
    expect(output).toContain('Recommendations:');
    expect(output).toContain('Install wabt');
  });

  it('shows overall ok when success is true', () => {
    const output = formatEnvironmentDoctorReport(makeMinimalReport({ success: true }));
    expect(output).toContain('Overall: ok');
  });

  it('shows review message when success is false', () => {
    const output = formatEnvironmentDoctorReport(makeMinimalReport({ success: false }));
    expect(output).toContain('Overall: review warnings above');
  });
});
