import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
vi.mock('node:util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:util')>();
  return { ...actual, promisify: vi.fn(() => execFileMock) };
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
    runtime: { platform: 'win32', arch: 'x64', node: 'v22.0.0', cwd: '/work', projectRoot: '/project' },
    packages: [],
    commands: [],
    bridges: [],
    config: {},
    limitations: [],
    recommendations: [],
    ...overrides,
  };
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

  it('reports installed packages', async () => {
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    const mcpSdk = report.packages.find((p) => p.name === '@modelcontextprotocol/sdk');
    expect(mcpSdk).toBeDefined();
    expect(['ok', 'missing']).toContain(mcpSdk!.status);
  });

  it('checks commands and reports status', async () => {
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    const git = report.commands.find((c) => c.name === 'git');
    expect(git).toBeDefined();
    expect(git!.status).toBe('ok');
    expect(git!.detail).toContain('git version');
  });

  it('reports missing commands with ENOENT as missing', async () => {
    execFileMock.mockImplementation((cmd: string) => {
      if (cmd === 'python') return Promise.reject(new Error('ENOENT: python not found'));
      return Promise.resolve({ stdout: 'ok', stderr: '' });
    });

    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    const python = report.commands.find((c) => c.name === 'python');
    expect(python!.status).toBe('missing');
  });

  it('reports warn for non-ENOENT command errors', async () => {
    execFileMock.mockImplementation((cmd: string) => {
      if (cmd === 'python') return Promise.reject(new Error('permission denied'));
      return Promise.resolve({ stdout: 'ok', stderr: '' });
    });

    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    const python = report.commands.find((c) => c.name === 'python');
    expect(python!.status).toBe('warn');
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
    if (process.platform !== 'win32') {
      expect(report.limitations.some((l) => l.includes('Windows-only'))).toBe(true);
    }
  });

  it('recommends camoufox install when package is missing', async () => {
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    const camoufox = report.packages.find((p) => p.name === 'camoufox-js');
    if (camoufox && camoufox.status !== 'ok') {
      expect(report.recommendations.some((r) => r.includes('Camoufox'))).toBe(true);
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
      makeMinimalReport({ packages: [{ name: 'test-pkg', status: 'ok', detail: 'installed (1.0.0)' }] }),
    );
    expect(output).toContain('Packages:');
    expect(output).toContain('[ok] test-pkg: installed (1.0.0)');
  });

  it('includes commands section', () => {
    const output = formatEnvironmentDoctorReport(
      makeMinimalReport({ commands: [{ name: 'git', status: 'ok', detail: 'git version 2.43.0' }] }),
    );
    expect(output).toContain('Commands:');
    expect(output).toContain('[ok] git');
  });

  it('includes bridge health section when bridges exist', () => {
    const output = formatEnvironmentDoctorReport(
      makeMinimalReport({ bridges: [{ name: 'ghidra-bridge', status: 'warn', detail: 'refused' }] }),
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
