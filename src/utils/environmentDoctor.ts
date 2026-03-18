import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { ToolRegistry } from '@modules/external/ToolRegistry';
import { GHIDRA_BRIDGE_ENDPOINT, IDA_BRIDGE_ENDPOINT } from '@src/constants';
import { getProjectRoot } from '@utils/outputPaths';
import { getArtifactRetentionConfig } from '@utils/artifactRetention';

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

export async function runEnvironmentDoctor(options?: {
  includeBridgeHealth?: boolean;
}): Promise<EnvironmentDoctorReport> {
  const includeBridgeHealth = options?.includeBridgeHealth ?? true;
  const registry = new ToolRegistry();
  const externalResults = await registry.probeAll(true);

  const packages: DoctorCheck[] = [
    checkPackage('@modelcontextprotocol/sdk'),
    checkPackage('rebrowser-puppeteer-core'),
    checkPackage('camoufox-js', 'Optional Firefox anti-detect driver'),
    checkPackage('playwright-core', 'Optional browser automation dependency'),
  ];

  const commands: DoctorCheck[] = [
    await checkCommand('git', ['--version']),
    await checkCommand('python', ['--version']),
    await checkCommand('pnpm', ['--version']),
    ...Object.entries(externalResults).map(([name, result]) => ({
      name,
      status: (result.available ? 'ok' : 'missing') as DoctorStatus,
      detail: result.available
        ? `${result.path ?? 'PATH'}${result.version ? ` (${result.version})` : ''}`
        : (result.reason ?? 'Unavailable'),
    })),
  ];

  const bridges: DoctorCheck[] = includeBridgeHealth
    ? await Promise.all([
        checkHttpEndpoint('ghidra-bridge', `${GHIDRA_BRIDGE_ENDPOINT.replace(/\/$/, '')}/health`),
        checkHttpEndpoint('ida-bridge', `${IDA_BRIDGE_ENDPOINT.replace(/\/$/, '')}/health`),
        checkHttpEndpoint(
          'burp-mcp-sse',
          process.env.BURP_MCP_SSE_URL?.trim() || 'http://127.0.0.1:9876'
        ),
      ])
    : [];

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
      transport: (process.env.MCP_TRANSPORT ?? 'stdio').toLowerCase(),
      toolProfile: (process.env.MCP_TOOL_PROFILE ?? 'search').toLowerCase(),
      pluginRoots: process.env.MCP_PLUGIN_ROOTS ?? '<jshook-install>/plugins',
      workflowRoots: process.env.MCP_WORKFLOW_ROOTS ?? '<jshook-install>/workflows',
      pluginSignatureRequired:
        process.env.MCP_PLUGIN_SIGNATURE_REQUIRED ??
        (process.env.NODE_ENV === 'production' ? 'true (production default)' : 'false'),
      pluginStrictLoad:
        process.env.MCP_PLUGIN_STRICT_LOAD ??
        (process.env.NODE_ENV === 'production' ? 'true (production default)' : 'false'),
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
    `Runtime: ${report.runtime.platform} ${report.runtime.arch} | Node ${report.runtime.node}`
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
    const packageJsonPath = require.resolve(`${packageName}/package.json`);
    const packageJson = require(packageJsonPath) as { version?: string };
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

async function checkCommand(command: string, args: string[]): Promise<DoctorCheck> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: 4000,
      windowsHide: true,
    });
    const detail = `${stdout || stderr}`.trim().split(/\r?\n/)[0] || 'available';
    return { name: command, status: 'ok', detail };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const missing = /ENOENT|not recognized|not found/i.test(detail);
    return {
      name: command,
      status: missing ? 'missing' : 'warn',
      detail,
    };
  }
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
  if (process.platform !== 'win32') {
    limitations.push(
      'Memory write / injection tools are Windows-only; on Linux/macOS prefer browser hooks, network capture, or Frida-based alternatives.'
    );
  }
  if (process.platform === 'linux') {
    limitations.push(
      'Camoufox runs on Linux, but some Chrome/CDP-heavy workflows are better served by the Chrome driver.'
    );
  }
  if (process.platform === 'darwin') {
    limitations.push(
      'macOS users should expect some Windows-native process tooling to be unavailable.'
    );
  }
  return limitations;
}

function buildRecommendations(
  packages: DoctorCheck[],
  commands: DoctorCheck[],
  bridges: DoctorCheck[],
  limitations: string[]
): string[] {
  const recommendations: string[] = [];
  if (packages.some((item) => item.name === 'camoufox-js' && item.status !== 'ok')) {
    recommendations.push(
      'Install optional browser dependencies with `pnpm run install:full` if you need Camoufox support.'
    );
  }
  if (commands.some((item) => item.name.startsWith('wabt.') && item.status !== 'ok')) {
    recommendations.push(
      'Install wabt if you need full WASM disassembly/decompilation; otherwise the server will stay in basic mode.'
    );
  }
  if (bridges.some((item) => item.status !== 'ok')) {
    recommendations.push(
      'Check local bridge endpoints (Ghidra / IDA / Burp) before relying on native-bridge workflows.'
    );
  }
  if (limitations.length > 0) {
    recommendations.push(
      'Review platform limitations before using process/memory tooling on non-Windows hosts.'
    );
  }
  return recommendations;
}
