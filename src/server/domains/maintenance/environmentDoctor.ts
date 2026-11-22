import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ToolRegistry } from '@modules/external/ToolRegistry';
import type { ProbeResult } from '@modules/external/ToolProbe';
import { GHIDRA_BRIDGE_ENDPOINT, IDA_BRIDGE_ENDPOINT } from '@src/constants';
import { getProjectRoot } from '@utils/outputPaths';
import { getArtifactRetentionConfig } from '@utils/artifactRetention';
import { probeBetterSqlite3 } from '@utils/betterSqlite3';
import { ioLimit } from '@utils/concurrency';
import { logger } from '@utils/logger';
import { readEnvNullableString, readEnvString } from '@src/config/environment';
import { getConfig } from '@utils/config';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

export type DoctorStatus = 'ok' | 'warn' | 'missing' | 'error';

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  detail: string;
}

export interface EnvironmentDoctorReport {
  success: boolean;
  generatedAt: string;
  runtime: {
    platform: NodeJS.Platform;
    arch: string;
    node: string;
    cwd: string;
    projectRoot: string;
  };
  packages: DoctorCheck[];
  commands: DoctorCheck[];
  bridges: DoctorCheck[];
  config: Record<string, unknown>;
  limitations: string[];
  recommendations: string[];
}

let sharedRegistry: ToolRegistry | null = null;
let sharedRegistryTimestamp = 0;
const REGISTRY_CACHE_TTL_MS = 120_000;

function getSharedRegistry(): ToolRegistry {
  const now = Date.now();
  if (!sharedRegistry || now - sharedRegistryTimestamp > REGISTRY_CACHE_TTL_MS) {
    sharedRegistry = new ToolRegistry();
    sharedRegistryTimestamp = now;
  }
  return sharedRegistry;
}

function resolvePackageJsonPath(packageName: string): string {
  let currentDir = dirname(require.resolve(packageName));

  while (true) {
    const packageJsonPath = join(currentDir, 'package.json');
    if (existsSync(packageJsonPath)) {
      return packageJsonPath;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(`Could not locate package.json for ${packageName}`);
    }
    currentDir = parentDir;
  }
}

function readInstalledPackageJson(packageName: string): { version?: string } {
  return require(resolvePackageJsonPath(packageName)) as { version?: string };
}

/**
 * Convert a single check's rejection into a warn entry so that one failing
 * sub-check (e.g. an endpoint probe) can never cascade into failing the whole
 * doctor report.
 */
function toSafeCheck(name: string, check: Promise<DoctorCheck>): Promise<DoctorCheck> {
  return check.catch((error: unknown) => ({
    name,
    status: 'warn' as DoctorStatus,
    detail: `Check failed: ${error instanceof Error ? error.message : String(error)}`,
  }));
}

/** External-tool probe with the same no-cascade guarantee (degrades to empty). */
function safeExternalProbe(registry: ToolRegistry): Promise<Record<string, ProbeResult>> {
  return registry.probeAll(true).catch((error: unknown) => {
    logger.warn(`[environmentDoctor] External tool probing failed: ${String(error)}`);
    return {};
  });
}

export async function runEnvironmentDoctor(options?: {
  includeBridgeHealth?: boolean;
}): Promise<EnvironmentDoctorReport> {
  const includeBridgeHealth = options?.includeBridgeHealth ?? true;
  const runtimeConfig = getConfig();
  const signatureRequiredOverride = readEnvNullableString('MCP_PLUGIN_SIGNATURE_REQUIRED', {
    trim: true,
  });
  const strictLoadOverride = readEnvNullableString('MCP_PLUGIN_STRICT_LOAD', { trim: true });
  const registry = getSharedRegistry();
  const externalResultsPromise = safeExternalProbe(registry);
  const gitCommandPromise = toSafeCheck(
    'git',
    ioLimit(() => checkCommand('git', ['--version'])),
  );
  const pythonCommandPromise = toSafeCheck(
    'python',
    ioLimit(() => checkCommand('python', ['--version'])),
  );
  const pnpmCommandPromise = toSafeCheck(
    'pnpm',
    ioLimit(() => checkPnpmCommand()),
  );
  const corepackCheckPromise = toSafeCheck(
    'corepack',
    ioLimit(() => checkCommand('corepack', ['--version'])),
  );
  const bridgesPromise = includeBridgeHealth
    ? Promise.all([
        toSafeCheck(
          'ghidra-bridge',
          ioLimit(() =>
            checkHttpEndpoint(
              'ghidra-bridge',
              `${GHIDRA_BRIDGE_ENDPOINT.replace(/\/$/, '')}/health`,
            ),
          ),
        ),
        toSafeCheck(
          'ida-bridge',
          ioLimit(() =>
            checkHttpEndpoint('ida-bridge', `${IDA_BRIDGE_ENDPOINT.replace(/\/$/, '')}/health`),
          ),
        ),
        toSafeCheck(
          'burp-mcp-sse',
          ioLimit(() =>
            checkHttpEndpoint(
              'burp-mcp-sse',
              readEnvString('BURP_MCP_SSE_URL', 'http://127.0.0.1:9876', { trim: true }),
            ),
          ),
        ),
      ])
    : Promise.resolve([] as DoctorCheck[]);

  const [externalResults, gitCommand, pythonCommand, pnpmCommand, corepackCheck, bridges] =
    await Promise.all([
      externalResultsPromise,
      gitCommandPromise,
      pythonCommandPromise,
      pnpmCommandPromise,
      corepackCheckPromise,
      bridgesPromise,
    ]);
  const corepackCommand = normalizeCorepackCheck(corepackCheck, pnpmCommand);

  const packages: DoctorCheck[] = [
    checkPackage('@modelcontextprotocol/core'),
    checkPackage('@modelcontextprotocol/node'),
    checkPackage('@modelcontextprotocol/server'),
    checkPackage('@modelcontextprotocol/client'),
    checkPackage('rebrowser-puppeteer-core'),
    checkBetterSqlite3(),
    checkPackage('camoufox-js', 'Optional Firefox anti-detect driver'),
    checkPackage('playwright-core', 'Optional browser automation dependency'),
    checkNativeMemory(),
  ];

  const commands: DoctorCheck[] = [
    gitCommand,
    pythonCommand,
    pnpmCommand,
    corepackCommand,
    ...Object.entries(externalResults).map(([name, result]) => ({
      name,
      status: (result.available ? 'ok' : 'missing') as DoctorStatus,
      detail: result.available
        ? `${result.path ?? 'PATH'}${result.version ? ` (${result.version})` : ''}`
        : (result.reason ?? 'Unavailable'),
    })),
  ];

  const limitations = buildPlatformLimitations();
  const recommendations = buildRecommendations(packages, commands, bridges, limitations);
  const success = [...packages, ...commands, ...bridges].every((item) => item.status !== 'error');

  return {
    success,
    generatedAt: new Date().toISOString(),
    runtime: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      cwd: process.cwd(),
      projectRoot: getProjectRoot(),
    },
    packages,
    commands,
    bridges,
    config: {
      transport: runtimeConfig.server.transport,
      toolProfile: runtimeConfig.mcp.toolProfile,
      pluginRoots: runtimeConfig.extensions.pluginRoots.join(',') || '<jshook-install>/plugins',
      workflowRoots:
        runtimeConfig.extensions.workflowRoots.join(',') || '<jshook-install>/workflows',
      pluginSignatureRequired:
        signatureRequiredOverride ??
        (runtimeConfig.extensions.signatureRequired ? 'true (production default)' : 'false'),
      pluginStrictLoad:
        strictLoadOverride ??
        (runtimeConfig.extensions.strictLoad ? 'true (production default)' : 'false'),
      artifactRetention: getArtifactRetentionConfig(),
    },
    limitations,
    recommendations,
  };
}

export function formatEnvironmentDoctorReport(report: EnvironmentDoctorReport): string {
  const lines: string[] = [];
  lines.push(`JSHook Environment Doctor — ${report.generatedAt}`);
  lines.push('');
  lines.push(
    `Runtime: ${report.runtime.platform} ${report.runtime.arch} | Node ${report.runtime.node}`,
  );
  lines.push(`CWD: ${report.runtime.cwd}`);
  lines.push(`Project root: ${report.runtime.projectRoot}`);
  lines.push('');
  lines.push('Packages:');
  for (const item of report.packages) lines.push(`- [${item.status}] ${item.name}: ${item.detail}`);
  lines.push('');
  lines.push('Commands:');
  for (const item of report.commands) lines.push(`- [${item.status}] ${item.name}: ${item.detail}`);
  if (report.bridges.length > 0) {
    lines.push('');
    lines.push('Bridge health:');
    for (const item of report.bridges)
      lines.push(`- [${item.status}] ${item.name}: ${item.detail}`);
  }
  lines.push('');
  lines.push('Config:');
  for (const [key, value] of Object.entries(report.config)) {
    lines.push(`- ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  }
  if (report.limitations.length > 0) {
    lines.push('');
    lines.push('Platform limitations:');
    for (const item of report.limitations) lines.push(`- ${item}`);
  }
  if (report.recommendations.length > 0) {
    lines.push('');
    lines.push('Recommendations:');
    for (const item of report.recommendations) lines.push(`- ${item}`);
  }
  lines.push('');
  lines.push(`Overall: ${report.success ? 'ok' : 'review warnings above'}`);
  return lines.join('\n');
}

function checkPackage(packageName: string, missingHint?: string): DoctorCheck {
  try {
    const packageJson = readInstalledPackageJson(packageName);
    return {
      name: packageName,
      status: 'ok',
      detail: packageJson.version ? `installed (${packageJson.version})` : 'installed',
    };
  } catch {
    return {
      name: packageName,
      status: 'missing',
      detail: missingHint ?? 'Not installed',
    };
  }
}

function checkBetterSqlite3(): DoctorCheck {
  const result = probeBetterSqlite3();
  return {
    name: 'better-sqlite3',
    status: result.status,
    detail: result.detail,
  };
}

function isPnpmOperational(pnpm: DoctorCheck): boolean {
  return pnpm.status === 'ok' || pnpm.detail.includes('npx fallback works');
}

async function checkPnpmCommand(): Promise<DoctorCheck> {
  const direct = await checkCommand('pnpm', ['--version']);
  if (direct.status === 'ok') {
    return direct;
  }

  const npxFallback = await checkCommand('npx', ['pnpm', '--version'], 10_000);
  if (npxFallback.status === 'ok') {
    return {
      name: 'pnpm',
      status: 'warn',
      detail: `direct pnpm command unavailable; npx fallback works (${npxFallback.detail})`,
    };
  }

  return direct;
}

function normalizeCorepackCheck(corepack: DoctorCheck, pnpm: DoctorCheck): DoctorCheck {
  if (corepack.status !== 'missing' || !isPnpmOperational(pnpm)) {
    return corepack;
  }

  return {
    name: corepack.name,
    status: 'warn',
    detail:
      process.platform === 'win32'
        ? pnpm.detail.includes('npx fallback works')
          ? 'corepack not found; use `npx pnpm` directly (common with nvm4w-managed Node on Windows)'
          : 'corepack not found; standalone pnpm is available (common with nvm4w-managed Node on Windows)'
        : pnpm.detail.includes('npx fallback works')
          ? 'corepack not found; use `npx pnpm` directly'
          : 'corepack not found; standalone pnpm is available',
  };
}

/**
 * Check koffi + platform-specific native library availability for memory tools.
 * Only loads/unloads the library — does NOT call any native functions (avoids SIGBUS on SIP macOS).
 */
function checkNativeMemory(): DoctorCheck {
  try {
    const koffiJson = readInstalledPackageJson('koffi');
    const koffiVersion = koffiJson.version ?? 'unknown';

    if (process.platform === 'win32') {
      return {
        name: 'native-memory',
        status: 'ok',
        detail: `koffi ${koffiVersion} — Win32 kernel32.dll available`,
      };
    }

    if (process.platform === 'darwin') {
      try {
        const koffi = require('koffi') as { load: (path: string) => { unload: () => void } };
        const lib = koffi.load('/usr/lib/libSystem.B.dylib');
        lib.unload();
        delete (require.cache as Record<string, unknown>)[require.resolve('koffi')];
        return {
          name: 'native-memory',
          status: 'ok',
          detail: `koffi ${koffiVersion} — macOS libSystem.B.dylib available (Mach APIs need root + SIP config)`,
        };
      } catch {
        return {
          name: 'native-memory',
          status: 'warn',
          detail: `koffi ${koffiVersion} installed but cannot load libSystem.B.dylib`,
        };
      }
    }

    return {
      name: 'native-memory',
      status: 'warn',
      detail:
        `koffi ${koffiVersion} — no native FFI memory provider for ${process.platform} (proc-based ops ` +
        `available on ` +
        `Linux)`,
    };
  } catch {
    return {
      name: 'native-memory',
      status: 'missing',
      detail: 'koffi not installed — native memory tools unavailable. Install with: pnpm add koffi',
    };
  }
}

async function checkCommand(command: string, args: string[], timeout = 4000): Promise<DoctorCheck> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout,
      windowsHide: true,
    });
    const detail = `${stdout || stderr}`.trim().split(/\r?\n/)[0] || 'available';
    return { name: command, status: 'ok', detail };
  } catch (error) {
    if (process.platform === 'win32') {
      try {
        const { stdout, stderr } = await execFileAsync('cmd', ['/c', command, ...args], {
          timeout,
          windowsHide: true,
        });
        const detail = `${stdout || stderr}`.trim().split(/\r?\n/)[0] || 'available';
        return { name: command, status: 'ok', detail: `${detail} (via cmd)` };
      } catch (cmdError) {
        return formatCommandError(command, cmdError);
      }
    }

    return formatCommandError(command, error);
  }
}

function formatCommandError(command: string, error: unknown): DoctorCheck {
  const detail = error instanceof Error ? error.message : String(error);
  const missing = /ENOENT|not recognized|not found/i.test(detail);
  return {
    name: command,
    status: missing ? 'missing' : 'warn',
    detail,
  };
}

async function checkHttpEndpoint(name: string, url: string): Promise<DoctorCheck> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    return {
      name,
      status: res.ok ? 'ok' : 'warn',
      detail: `${url} -> HTTP ${res.status}`,
    };
  } catch (error) {
    return {
      name,
      status: 'warn',
      detail: `${url} -> ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function buildPlatformLimitations(): string[] {
  const limitations: string[] = [];
  if (process.platform === 'darwin') {
    limitations.push(
      '26 cross-platform memory tools available (scan, pointer-chain, structure-analysis, heap). ' +
        '15 Windows-only tools unavailable (PE analysis, anti-cheat, code injection, speedhack, hardware breakpoints).',
    );
    limitations.push(
      'Native memory operations (mach_vm_read/write) require root privileges and may require SIP configuration on' +
        ' ARM64.',
    );
  } else if (process.platform === 'linux') {
    limitations.push(
      'Process management available via /proc. Native FFI memory provider not implemented — memory read/write ' +
        'uses /proc/pid/mem (requires root or CAP_SYS_PTRACE).',
    );
    limitations.push(
      'Camoufox runs on Linux, but some Chrome/CDP-heavy workflows are better served by the Chrome driver.',
    );
  } else if (process.platform !== 'win32') {
    limitations.push(
      `Platform ${process.platform} is not supported for native memory operations. Use Windows or macOS.`,
    );
  }
  return limitations;
}

function buildRecommendations(
  packages: DoctorCheck[],
  commands: DoctorCheck[],
  bridges: DoctorCheck[],
  limitations: string[],
): string[] {
  const recommendations: string[] = [];
  const pnpmCommand = commands.find((item) => item.name === 'pnpm');
  const corepackCommand = commands.find((item) => item.name === 'corepack');
  if (packages.some((item) => item.name === 'better-sqlite3' && item.status !== 'ok')) {
    recommendations.push(
      'Install or rebuild the optional SQLite trace backend with ' +
        '`pnpm add -O better-sqlite3@12.10.0` or `npm rebuild better-sqlite3 ' +
        '--foreground-scripts` under the active Node version if you need trace tooling.',
    );
  }
  if (packages.some((item) => item.name === 'camoufox-js' && item.status !== 'ok')) {
    recommendations.push(
      'Install optional browser dependencies with `pnpm run install:full` if you need Camoufox support.',
    );
  }
  if (commands.some((item) => item.name.startsWith('wabt.') && item.status !== 'ok')) {
    recommendations.push(
      'Install wabt if you need full WASM disassembly/decompilation; otherwise the server will stay in basic mode.',
    );
  }
  if (pnpmCommand && !isPnpmOperational(pnpmCommand)) {
    recommendations.push(
      'Install pnpm or enable Corepack (`corepack enable`) before running package-management workflows.',
    );
  } else if (pnpmCommand?.detail.includes('npx fallback works')) {
    recommendations.push(
      'Use `npx pnpm` directly on this machine or repair the local pnpm/Corepack shim if scripts expect bare `pnpm`.',
    );
  } else if (
    corepackCommand?.status === 'warn' &&
    corepackCommand.detail.includes('standalone pnpm')
  ) {
    recommendations.push(
      'Use `pnpm` or `npx pnpm` directly on this machine; `corepack` is optional and may be absent on ' +
        'nvm4w-managed Windows installs.',
    );
  }
  if (bridges.some((item) => item.status !== 'ok')) {
    recommendations.push(
      'Check local bridge endpoints (Ghidra / IDA / Burp) before relying on native-bridge workflows.',
    );
  }
  if (limitations.length > 0) {
    recommendations.push(
      'Review platform limitations before using process/memory tooling on non-Windows hosts.',
    );
  }
  return recommendations;
}
