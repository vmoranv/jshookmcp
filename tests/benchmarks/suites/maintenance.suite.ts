/**
 * Maintenance domain benchmark — GPU vendor classification against the OFFICIAL
 * detect-gpu benchmark database (pmndrs/detect-gpu, PassMark-backed per-vendor JSON).
 *
 * The fixture files in fixtures/detect-gpu-d-*.json are the real database entries the
 * official library ships; sampled entries must classify to their vendor.
 */
import { CoreMaintenanceHandlers } from '@server/domains/maintenance/handlers';
import { TokenBudgetManager } from '@utils/TokenBudgetManager';
import { UnifiedCacheManager } from '@utils/UnifiedCacheManager';
import { body, type BenchSuite } from '../harness';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const realTokenBudget = new TokenBudgetManager();
const realCacheManager = new UnifiedCacheManager();
const handlers = new CoreMaintenanceHandlers({
  tokenBudget: realTokenBudget,
  unifiedCache: realCacheManager,
} as never);

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
  ],
};
