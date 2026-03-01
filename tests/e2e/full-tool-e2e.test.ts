import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MCPTestClient } from './helpers/mcp-client.js';
import { buildArgs } from './helpers/schema-builder.js';
import { getOverrides } from './overrides.js';
import { buildSkipSet } from './skip-list.js';
import { ALL_PHASES } from './phases/index.js';
import { applyContextCapture } from './context-capture.js';
import type { E2EConfig, E2EContext } from './helpers/types.js';

function flag(name: string, fallback: string): string {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(name);
  return i === -1 ? fallback : (argv[i + 1] ?? fallback);
}

function extractDomain(url: string): string {
  try { return '.' + new URL(url).hostname.replace(/^www\./, ''); }
  catch { return '.example.com'; }
}

const TARGET_URL = process.env.E2E_TARGET_URL || flag('--target-url', '');
const ARTIFACT_DIR = join(process.cwd(), '.tmp_mcp_artifacts');

const config: E2EConfig = {
  targetUrl: TARGET_URL,
  targetDomain: extractDomain(TARGET_URL),
  electronPath: flag('--electron-path', ''),
  miniappPath: flag('--miniapp-path', ''),
  asarPath: flag('--asar-path', ''),
  browserPath: flag('--browser-path', 'C:/Program Files/Google/Chrome/Application/chrome.exe'),
  perToolTimeout: Number(flag('--timeout', '30000')),
  skipSet: new Set((flag('--skip', '') || '').split(',').filter(Boolean)),
  artifactDir: ARTIFACT_DIR,
};

describe.skipIf(!TARGET_URL)('Full Tool E2E', { timeout: 300_000, sequential: true }, () => {
  const client = new MCPTestClient();
  const ctx: E2EContext = { scriptId: null, breakpointId: null, requestId: null, hookId: null, objectId: null };
  const alwaysSkip = buildSkipSet({ electronPath: config.electronPath, miniappPath: config.miniappPath });
  let overrides: Record<string, Record<string, unknown>> = {};
  let toolMap = new Map<string, { name: string; inputSchema?: Record<string, unknown> }>();

  beforeAll(async () => {
    await mkdir(ARTIFACT_DIR, { recursive: true });
    await client.connect();
    toolMap = client.getToolMap();
    overrides = getOverrides(ctx, config);
  });

  afterAll(async () => {
    const results = client.results;
    const pass = results.filter((r) => r.ok).length;
    const isErrorCount = results.filter((r) => r.isError).length;
    const report = {
      timestamp: new Date().toISOString(),
      targetUrl: TARGET_URL,
      serverToolCount: toolMap?.size ?? 0,
      tested: results.length,
      pass,
      fail: results.length - pass,
      isErrorCount,
      results,
    };
    const reportPath = join(ARTIFACT_DIR, 'e2e-full-report.json');
    try { await writeFile(reportPath, JSON.stringify(report, null, 2)); } catch { /* ignore */ }
    await client.cleanup();
  });

  for (const phase of ALL_PHASES) {
    describe(phase.name, { sequential: true, timeout: 120_000 }, () => {
      beforeAll(async () => {
        if (typeof phase.setup === 'function') {
          await phase.setup(async (name, args, timeout) => client.call(name, args, timeout ?? 45_000));
        } else if (Array.isArray(phase.setup)) {
          for (const setupTool of phase.setup) {
            if (config.skipSet.has(setupTool) || alwaysSkip.has(setupTool)) continue;
            const args = overrides[setupTool] ?? buildArgs(toolMap.get(setupTool)?.inputSchema, config);
            await client.call(setupTool, args, 45_000);
            await new Promise((r) => setTimeout(r, 200));
          }
        }
        if (phase.name === 'Browser Launch & Navigation') {
          await new Promise((r) => setTimeout(r, 4_000));
        }
      });

      for (const toolName of phase.tools) {
        it(toolName, async () => {
          if (config.skipSet.has(toolName) || alwaysSkip.has(toolName)) return;
          if (!toolMap.has(toolName)) return;

          overrides = getOverrides(ctx, config);
          const args = overrides[toolName] ?? buildArgs(toolMap.get(toolName)?.inputSchema, config);
          const parsed = await client.call(toolName, args, config.perToolTimeout);
          applyContextCapture(toolName, parsed, ctx, overrides);

          if (toolName === 'debugger_pause') {
            await new Promise((r) => setTimeout(r, 500));
          }

          const lastResult = client.results[client.results.length - 1];
          expect(lastResult?.isError, `${toolName} returned isError`).toBe(false);
        });
      }
    });
  }
});
