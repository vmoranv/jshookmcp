/**
 * Maintenance domain benchmark — GPU vendor classification against the OFFICIAL
 * detect-gpu benchmark database (pmndrs/detect-gpu, PassMark-backed per-vendor JSON).
 *
 * The fixture files in fixtures/detect-gpu-d-*.json are the real database entries the
 * official library ships; sampled entries must classify to their vendor.
 */
import { CoreMaintenanceHandlers } from '@server/domains/maintenance/handlers';
import { SandboxToolHandlers } from '@server/domains/maintenance/handlers.sandbox';
import { ExtensionManagementHandlers } from '@server/domains/maintenance/handlers.extensions';
import { listExtensions, reloadExtensions } from '@server/extensions/ExtensionManager';
import type { MCPServerContext } from '@server/MCPServer.context';
import { TokenBudgetManager } from '@utils/TokenBudgetManager';
import { UnifiedCacheManager } from '@utils/UnifiedCacheManager';
import { body, type BenchSuite } from '../harness';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const realTokenBudget = new TokenBudgetManager();
const realCacheManager = new UnifiedCacheManager();
const handlers = new CoreMaintenanceHandlers({
  tokenBudget: realTokenBudget,
  unifiedCache: realCacheManager,
} as never);

const extCtx = {
  extensionPluginsById: new Map(),
  extensionPluginRuntimeById: new Map(),
  extensionWorkflowsById: new Map(),
  extensionWorkflowRuntimeById: new Map(),
  extensionToolsByName: new Map(),
  pluginExtensionToolNames: new Set(),
  listExtensions: function () {
    return listExtensions(this as unknown as MCPServerContext);
  },
  reloadExtensions: function () {
    return reloadExtensions(this as unknown as MCPServerContext);
  },
} as unknown as MCPServerContext;

const extHandlers = new ExtensionManagementHandlers(extCtx);
const sandboxHandlers = new SandboxToolHandlers(extCtx);

const snapTargetDir = mkdtempSync(join(tmpdir(), 'jshook-bench-snap-'));
writeFileSync(join(snapTargetDir, 'state.txt'), 'version 1 content');
process.once('exit', () => {
  try {
    require('node:fs').rmSync(snapTargetDir, { recursive: true, force: true });
  } catch {}
});

interface BenchEntry {
  name: string;
  vendor: string;
}

/** Sample real entries from the official per-vendor database files. */
function sampleOfficialGpus(perVendor = 6): BenchEntry[] {
  const vendorFiles: Array<[string, string]> = [
    ['d-geforce.json', 'nvidia'],
    ['d-nvidia.json', 'nvidia'],
    ['d-apple.json', 'apple'],
    ['d-intel.json', 'intel'],
    ['d-amd.json', 'amd'],
    ['d-radeon.json', 'amd'],
  ];
  const out: BenchEntry[] = [];
  for (const [file, vendor] of vendorFiles) {
    const path = join(ROOT, 'tests/benchmarks/fixtures', `detect-gpu-${file}`);
    let data: unknown[];
    try {
      data = JSON.parse(readFileSync(path, 'utf8')) as unknown[];
    } catch {
      continue;
    }
    let taken = 0;
    for (const entry of data) {
      if (taken >= perVendor) break;
      if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue;
      const name = entry[0] as string;
      if (name.length < 6 || !/[a-z]/.test(name) || !/\d/.test(name)) continue; // skip junk rows
      out.push({ name, vendor });
      taken += 1;
    }
  }
  return out;
}

export const maintenanceSuite: BenchSuite = {
  name: 'maintenance',
  domain: 'maintenance',
  description:
    'GPU vendor classification sampled from the official detect-gpu benchmark database (per-vendor entries)',
  cases: [
    {
      name: 'maintenance_detect_gpu/official-database-sample',
      tool: 'maintenance_detect_gpu',
      origin: 'external-vector',
      reference:
        'pmndrs/detect-gpu benchmark database (fixtures/detect-gpu-d-*.json): sampled official entries must classify to their vendor',
      run: async () => {
        const gpus = sampleOfficialGpus();
        if (gpus.length === 0) return { sampled: 0, results: [] };
        const results = [];
        for (const gpu of gpus) {
          const r = body(await handlers.handleDetectGpu({ webglRenderer: gpu.name }));
          results.push({ expected: gpu.vendor, response: r });
        }
        return { sampled: gpus.length, results };
      },
      validate: (v) => {
        const { sampled, results } = v as {
          sampled: number;
          results: Array<{ expected: string; response: Record<string, unknown> }>;
        };
        if (sampled < 12)
          return `only ${sampled} official entries sampled — fixture files missing? run pnpm bench:fetch-fixtures`;
        let correct = 0;
        const misses: string[] = [];
        for (const { expected, response } of results) {
          const text = JSON.stringify(response).toLowerCase();
          if (text.includes(expected)) correct += 1;
          else misses.push(expected);
        }
        // classification accuracy over the official sample — percentage is the native unit
        const accuracy = (correct / sampled) * 100;
        if (accuracy < 80)
          return `official-sample classification accuracy ${accuracy.toFixed(1)}% (${correct}/${sampled}); misses: ${misses.slice(0, 3).join(',')}`;
        return true;
      },
    },
    {
      name: 'maintenance_detect_gpu/cross-vendor-exclusivity',
      tool: 'maintenance_detect_gpu',
      origin: 'homemade',
      reference:
        'official NVIDIA and Apple entries must classify exclusively (no cross-vendor leakage)',
      run: async () => {
        const gpus = sampleOfficialGpus(4);
        const nvidia = gpus.find((g) => g.vendor === 'nvidia');
        const apple = gpus.find((g) => g.vendor === 'apple');
        if (!nvidia || !apple) return { skipped: true };
        const n = JSON.stringify(
          body(await handlers.handleDetectGpu({ webglRenderer: nvidia.name })),
        ).toLowerCase();
        const a = JSON.stringify(
          body(await handlers.handleDetectGpu({ webglRenderer: apple.name })),
        ).toLowerCase();
        return { n, a };
      },
      validate: (v) => {
        const { skipped, n, a } = v as { skipped?: boolean; n?: string; a?: string };
        if (skipped) return true;
        if (n!.includes('apple') && !n!.includes('nvidia'))
          return 'NVIDIA entry classified as apple';
        if (a!.includes('nvidia') && !a!.includes('apple'))
          return 'Apple entry classified as nvidia';
        return true;
      },
    },
    {
      name: 'get_token_budget_stats/stats-structure-contract',
      tool: 'get_token_budget_stats',
      origin: 'homemade',
      reference:
        'invokes handleGetTokenBudgetStats and verifies presence of maxTokens and usagePercentage',
      run: async () => {
        return handlers.handleGetTokenBudgetStats();
      },
      validate: (v: unknown) => {
        const b = body(v);
        if (typeof b.maxTokens !== 'number')
          return `expected maxTokens number, got: ${typeof b.maxTokens}`;
        if (typeof b.usagePercentage !== 'number')
          return `expected usagePercentage number, got: ${typeof b.usagePercentage}`;
        return true;
      },
    },
    {
      name: 'manual_token_cleanup/cleanup-contract',
      tool: 'manual_token_cleanup',
      origin: 'homemade',
      reference:
        'invokes handleManualTokenCleanup and reports structured before/after/freed results',
      run: async () => {
        return handlers.handleManualTokenCleanup();
      },
      validate: (v: unknown) => {
        const b = body(v);
        if (b.message !== 'Manual cleanup completed')
          return `expected completion message, got: ${b.message}`;
        if (!b.freed) return `expected freed stats field, got: ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'reset_token_budget/reset-contract',
      tool: 'reset_token_budget',
      origin: 'homemade',
      reference: 'invokes handleResetTokenBudget and resets usage back to 0',
      run: async () => {
        return handlers.handleResetTokenBudget();
      },
      validate: (v: unknown) => {
        const b = body(v);
        if (b.currentUsage !== 0) return `expected currentUsage=0, got: ${b.currentUsage}`;
        return true;
      },
    },
    {
      name: 'get_cache_stats/global-stats-contract',
      tool: 'get_cache_stats',
      origin: 'homemade',
      reference:
        'invokes handleGetCacheStats via real UnifiedCacheManager and returns totalSize and totalEntries',
      run: async () => {
        return handlers.handleGetCacheStats();
      },
      validate: (v: unknown) => {
        const b = body(v);
        if (typeof b.totalEntries !== 'number')
          return `expected totalEntries number, got: ${typeof b.totalEntries}`;
        return true;
      },
    },

    // ── Coverage batch 2026-11-11 (autoresearch): offline maintenance & snapshot tools ──
    {
      name: 'clear_all_caches/clears-caches',
      tool: 'clear_all_caches',
      origin: 'homemade',
      reference: 'clears all caches via real UnifiedCacheManager and returns confirmation message',
      run: () => handlers.handleClearAllCaches(),
      validate: (v: unknown) => {
        const b = body(v);
        if (!String(b.message ?? '').includes('cleared'))
          return `expected cleared confirmation, got: ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'smart_cache_cleanup/target-eviction',
      tool: 'smart_cache_cleanup',
      origin: 'homemade',
      reference: 'evicts stale cache entries targeting max size via UnifiedCacheManager',
      run: () => handlers.handleSmartCacheCleanup(1024),
      validate: (v: unknown) => {
        const b = body(v);
        if (b.success === false) return `cleanup failed: ${b.error}`;
        return true;
      },
    },
    {
      name: 'cleanup_artifacts/dry-run-policy',
      tool: 'cleanup_artifacts',
      origin: 'homemade',
      reference: 'runs artifact retention cleanup policy in dryRun mode without deleting files',
      run: () => handlers.handleCleanupArtifacts({ dryRun: true }),
      validate: (v: unknown) => {
        const b = body(v);
        if (b.success === false) return `artifact cleanup failed: ${b.error}`;
        return true;
      },
    },
    {
      name: 'doctor_environment/diagnostics-summary',
      tool: 'doctor_environment',
      origin: 'homemade',
      reference: 'runs environment doctor checks and returns diagnostics report',
      run: () => handlers.handleEnvironmentDoctor({ includeBridgeHealth: false }),
      validate: (v: unknown) => {
        const b = body(v);
        if (b.success === false) return `doctor failed: ${b.error}`;
        const text = JSON.stringify(b);
        if (!text.includes('platform') && !text.includes('node') && !text.includes('status'))
          return `doctor missing basic environment diagnostic fields: ${text.slice(0, 200)}`;
        return true;
      },
    },
    {
      name: 'snapshot_create/shadow-git-snapshot',
      tool: 'snapshot_create',
      origin: 'homemade',
      reference: 'creates shadow-git snapshot of temp target directory and returns snapshotId',
      run: () =>
        handlers.handleSnapshotCreate({
          targetDir: snapTargetDir,
          label: 'bench-snap-v1',
        }),
      validate: (v: unknown) => {
        const b = body(v);
        if (typeof b.snapshotId !== 'string' || b.snapshotId.length === 0)
          return `expected non-empty snapshotId, got: ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'snapshot_list/records-history',
      tool: 'snapshot_list',
      origin: 'homemade',
      reference: 'lists recorded shadow-git snapshots for target directory',
      run: () => handlers.handleSnapshotList({ targetDir: snapTargetDir }),
      validate: (v: unknown) => {
        const b = body(v);
        if (Number(b.count) < 1 || !Array.isArray(b.snapshots))
          return `expected count >= 1 snapshots, got: ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'snapshot_restore/revert-modified-file',
      tool: 'snapshot_restore',
      origin: 'homemade',
      reference: 'restores shadow-git snapshot and reverts modified file content',
      run: async () => {
        const listRes = body(await handlers.handleSnapshotList({ targetDir: snapTargetDir }));
        const snapshots = (listRes.snapshots as Array<{ id?: string }>) ?? [];
        const snapshotId = snapshots[0]?.id;
        if (!snapshotId) throw new Error('No snapshot found to restore');
        // Mutate target file
        writeFileSync(join(snapTargetDir, 'state.txt'), 'version 2 modified');
        const res = await handlers.handleSnapshotRestore({
          targetDir: snapTargetDir,
          snapshotId,
        });
        const currentContent = readFileSync(join(snapTargetDir, 'state.txt'), 'utf8');
        return { res: body(res), currentContent };
      },
      validate: (v: unknown) => {
        const { res, currentContent } = v as {
          res?: Record<string, unknown>;
          currentContent?: string;
        };
        if (res?.success === false) return `restore failed: ${res.error}`;
        if (currentContent !== 'version 1 content')
          return `expected file reverted to 'version 1 content', got: '${currentContent}'`;
        return true;
      },
    },

    // ── Coverage batch 2026-11-11 (autoresearch): extension management & sandbox tools ──
    {
      name: 'execute_sandbox_script/eval-quickjs-wasm',
      tool: 'execute_sandbox_script',
      origin: 'homemade',
      reference: 'executes JS code in isolated QuickJS WebAssembly runtime with MCP bridge',
      run: () => sandboxHandlers.handleExecuteSandboxScript({ code: '6 * 7' }),
      validate: (v: unknown) => {
        const text = JSON.stringify(v);
        if (!text.includes('42')) return `expected 42 in sandbox result, got ${text.slice(0, 200)}`;
        return true;
      },
    },
    {
      name: 'list_extensions/lists-runtime-extensions',
      tool: 'list_extensions',
      origin: 'homemade',
      reference: 'queries loaded plugins, workflows, and extension tools via ExtensionManager',
      run: () => extHandlers.handleListExtensions({}),
      validate: (v: unknown) => {
        const b = body(v);
        if (b.success !== true || !Array.isArray(b.plugins) || !Array.isArray(b.workflows))
          return `unexpected list_extensions payload: ${JSON.stringify(b).slice(0, 200)}`;
        return true;
      },
    },
    {
      name: 'reload_extensions/reloads-extension-roots',
      tool: 'reload_extensions',
      origin: 'homemade',
      reference: 'reloads extension configurations from configured roots with mutex',
      run: async () => {
        const { initRegistry } = await import('@server/registry/index');
        await initRegistry();
        return extHandlers.handleReloadExtensions();
      },
      validate: (v: unknown) => {
        const b = body(v);
        if (b.success !== true)
          return `unexpected reload_extensions payload: ${JSON.stringify(b).slice(0, 200)}`;
        return true;
      },
    },
  ],
};
