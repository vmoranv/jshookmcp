/**
 * environmentDoctor edge-case tests — require-mocked scenarios.
 *
 * These tests use vi.mock('node:module') to intercept createRequire, allowing
 * us to simulate missing packages (koffi not installed, koffi.load failure,
 * camoufox-js missing) for full branch coverage of checkPackage and
 * checkNativeMemory.
 *
 * Separated from environmentDoctor.test.ts because they need to control the
 * module-level `require` captured at import time.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — available inside vi.mock factories
// ---------------------------------------------------------------------------

const { probeAllMock, execFileMock, mockFetch, blockedPackages, koffiLoadShouldFail, koffiVersionless, versionlessPackages } = vi.hoisted(
  () => ({
    probeAllMock: vi.fn().mockResolvedValue({}),
    execFileMock: vi.fn(),
    mockFetch: vi.fn(),
    /** Set of package patterns that should cause require.resolve to throw */
    blockedPackages: new Set<string>(),
    /** If true, koffi.load() will throw (simulates libSystem.B.dylib failure) */
    koffiLoadShouldFail: { value: false },
    /** If true, koffi/package.json returns {} (no version field) */
    koffiVersionless: { value: false },
    /** Set of packages whose package.json should return {} (no version) */
    versionlessPackages: new Set<string>(),
  }),
);

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

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

// Intercept createRequire to inject a proxy require that respects blockedPackages
vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>();
  return {
    ...actual,
    createRequire: (url: string) => {
      const realRequire = actual.createRequire(url);

      // Proxy to intercept resolve & require for blocked packages
      const proxyRequire = Object.assign(
        (id: string) => {
          // Return versionless koffi package.json if flag is set
          if (id.endsWith('koffi/package.json') && koffiVersionless.value) {
            return {}; // no version field
          }
          // Return versionless package.json for packages in the set
          for (const pkg of versionlessPackages) {
            if (id.endsWith(`${pkg}/package.json`)) {
              return {}; // no version field
            }
          }
          // Block koffi itself if koffi is blocked, or simulate load failure
          if (id === 'koffi' && !blockedPackages.has('koffi')) {
            // koffi is "installed" but may have load failure
            if (koffiLoadShouldFail.value) {
              return {
                load: () => {
                  throw new Error('mock: cannot load dylib');
                },
              };
            }
          }
          for (const pattern of blockedPackages) {
            if (id === pattern || id.startsWith(`${pattern}/`)) {
              throw new Error(`Cannot find module '${id}'`);
            }
          }
          return realRequire(id);
        },
        {
          resolve: (id: string) => {
            for (const pattern of blockedPackages) {
              if (id === pattern || id.startsWith(`${pattern}/`)) {
                throw new Error(`Cannot find module '${id}'`);
              }
            }
            return realRequire.resolve(id);
          },
        },
      );

      return proxyRequire;
    },
  };
});

vi.stubGlobal('fetch', mockFetch);

import { runEnvironmentDoctor } from '@utils/environmentDoctor';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('environmentDoctor edge cases (require-mocked)', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    probeAllMock.mockReset().mockResolvedValue({});
    execFileMock.mockReset().mockResolvedValue({ stdout: 'ok', stderr: '' });
    mockFetch.mockReset().mockRejectedValue(new Error('refused'));
    blockedPackages.clear();
    koffiLoadShouldFail.value = false;
    koffiVersionless.value = false;
    versionlessPackages.clear();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    blockedPackages.clear();
    koffiLoadShouldFail.value = false;
    koffiVersionless.value = false;
    versionlessPackages.clear();
  });

  // ── checkPackage catch branch (L163) ──

  it('reports missing status when camoufox-js is not installed', async () => {
    blockedPackages.add('camoufox-js');
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    const camoufox = report.packages.find((p) => p.name === 'camoufox-js');
    expect(camoufox).toBeDefined();
    expect(camoufox!.status).toBe('missing');
  });

  it('reports missing with custom hint when package has missingHint', async () => {
    blockedPackages.add('playwright-core');
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    const pw = report.packages.find((p) => p.name === 'playwright-core');
    expect(pw).toBeDefined();
    expect(pw!.status).toBe('missing');
    expect(pw!.detail).toContain('Optional browser automation');
  });

  // ── checkNativeMemory outer catch (L216) — koffi not installed ──

  it('reports native-memory as missing when koffi is not installed', async () => {
    blockedPackages.add('koffi');
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    const nativeMem = report.packages.find((p) => p.name === 'native-memory');
    expect(nativeMem).toBeDefined();
    expect(nativeMem!.status).toBe('missing');
    expect(nativeMem!.detail).toContain('koffi not installed');
  });

  // ── checkNativeMemory darwin inner catch (L201) — koffi load failure ──

  it('reports native-memory as warn when koffi.load throws on darwin', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    koffiLoadShouldFail.value = true;
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    const nativeMem = report.packages.find((p) => p.name === 'native-memory');
    expect(nativeMem).toBeDefined();
    expect(nativeMem!.status).toBe('warn');
    expect(nativeMem!.detail).toContain('cannot load libSystem.B.dylib');
  });

  // ── buildRecommendations camoufox branch (L296) ──

  it('recommends camoufox install when camoufox-js package is missing', async () => {
    blockedPackages.add('camoufox-js');
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    expect(report.recommendations.some((r) => r.includes('Camoufox'))).toBe(true);
    expect(report.recommendations.some((r) => r.includes('pnpm run install:full'))).toBe(true);
  });

  // ── buildRecommendations limitations branch (L310-313) ──

  it('recommends reviewing platform limitations on non-Windows', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    expect(report.limitations.length).toBeGreaterThan(0);
    expect(
      report.recommendations.some((r) => r.includes('Review platform limitations')),
    ).toBe(true);
  });

  // ── checkNativeMemory koffiVersion ?? 'unknown' branch (L179) ──

  it('uses "unknown" when koffi package.json has no version field', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    koffiVersionless.value = true;
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    const nativeMem = report.packages.find((p) => p.name === 'native-memory');
    expect(nativeMem).toBeDefined();
    expect(nativeMem!.detail).toContain('koffi unknown');
  });

  // ── checkPackage version falsy branch (L160) ──

  it('reports "installed" when package has no version field', async () => {
    versionlessPackages.add('rebrowser-puppeteer-core');
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    const pkg = report.packages.find((p) => p.name === 'rebrowser-puppeteer-core');
    expect(pkg).toBeDefined();
    expect(pkg!.status).toBe('ok');
    expect(pkg!.detail).toBe('installed');
  });

  // ── checkPackage missingHint ?? 'Not installed' branch (L166) ──

  it('uses default "Not installed" when missing package has no missingHint', async () => {
    // @modelcontextprotocol/sdk has no missingHint argument
    blockedPackages.add('@modelcontextprotocol/sdk');
    const report = await runEnvironmentDoctor({ includeBridgeHealth: false });
    const sdk = report.packages.find((p) => p.name === '@modelcontextprotocol/sdk');
    expect(sdk).toBeDefined();
    expect(sdk!.status).toBe('missing');
    expect(sdk!.detail).toBe('Not installed');
  });
});
