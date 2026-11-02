import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { type TokenBudgetManager } from '@utils/TokenBudgetManager';
import { type UnifiedCacheManager } from '@utils/UnifiedCacheManager';
import type { ToolResponse } from '@server/types';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { cleanupArtifacts } from '@utils/artifactRetention';
import {
  ArtifactSnapshotManager,
  deriveSnapshotStoreDir,
  type SnapshotManager,
  type SnapshotRecord,
} from '@utils/artifact-snapshot';
import type { ArtifactCategory } from '@utils/artifacts';
import { getProjectRoot, getSystemTempRoots } from '@utils/outputPaths';
import { resolveSafeOutputPath } from '@utils/safeOutput';
import { runEnvironmentDoctor } from '@utils/environmentDoctor';
import { classifyGpuInputs } from '@server/domains/maintenance/gpu-detect';
import { TOKEN_BUDGET_MAX_TOKENS } from '@src/constants/server';

type SnapshotManagerFactory = (options: { storeDir: string; workTree: string }) => SnapshotManager;

interface CoreMaintenanceHandlerDeps {
  tokenBudget: TokenBudgetManager;
  unifiedCache: UnifiedCacheManager;
  artifactCleanup?: typeof cleanupArtifacts;
  environmentDoctor?: typeof runEnvironmentDoctor;
  snapshotManagerFactory?: SnapshotManagerFactory;
}

/** Primary store base: the server-owned cache area under the project root. */
function snapshotStoreBaseDir(): string {
  return resolve(getProjectRoot(), '.cache', 'artifact-snapshots');
}

function snapshotStoreFallbackBaseDir(): string {
  const tempRoots = getSystemTempRoots();
  return resolve(tempRoots[0] ?? homedir(), 'jshookmcp-snapshot-stores');
}

const TARGET_DIR_ALLOWED_ROOTS_DESCRIPTION = 'project root or system temp directories';

export class CoreMaintenanceHandlers {
  private readonly tokenBudget: TokenBudgetManager;
  private readonly unifiedCache: UnifiedCacheManager;
  private readonly artifactCleanup: typeof cleanupArtifacts;
  private readonly environmentDoctor: typeof runEnvironmentDoctor;
  private readonly snapshotManagerFactory: SnapshotManagerFactory;

  constructor(deps: CoreMaintenanceHandlerDeps) {
    this.tokenBudget = deps.tokenBudget;
    this.unifiedCache = deps.unifiedCache;
    this.artifactCleanup = deps.artifactCleanup ?? cleanupArtifacts;
    this.environmentDoctor = deps.environmentDoctor ?? runEnvironmentDoctor;
    this.snapshotManagerFactory =
      deps.snapshotManagerFactory ?? ((options) => new ArtifactSnapshotManager(options));
  }

  async handleGetTokenBudgetStats(): Promise<ToolResponse> {
    return handleSafe(async () => {
      const stats = this.tokenBudget.getStats();
      return {
        ...stats,
        sessionDuration: `${Math.round((Date.now() - stats.sessionStartTime) / 1000)}s`,
      };
    });
  }

  async handleManualTokenCleanup(): Promise<ToolResponse> {
    return handleSafe(async () => {
      const beforeStats = this.tokenBudget.getStats();
      this.tokenBudget.manualCleanup();
      const afterStats = this.tokenBudget.getStats();
      const freed = beforeStats.currentUsage - afterStats.currentUsage;
      return {
        message: 'Manual cleanup completed',
        before: { usage: beforeStats.currentUsage, percentage: beforeStats.usagePercentage },
        after: { usage: afterStats.currentUsage, percentage: afterStats.usagePercentage },
        freed: { tokens: freed, percentage: Math.round((freed / beforeStats.maxTokens) * 100) },
      };
    });
  }

  async handleResetTokenBudget(): Promise<ToolResponse> {
    return handleSafe(async () => {
      this.tokenBudget.reset();
      return {
        message: 'Token budget reset successfully',
        currentUsage: 0,
        maxTokens: TOKEN_BUDGET_MAX_TOKENS,
        usagePercentage: 0,
      };
    });
  }

  async handleGetCacheStats(): Promise<ToolResponse> {
    return handleSafe(async () => this.unifiedCache.getGlobalStats());
  }

  async handleSmartCacheCleanup(
    targetSize?: number,
    namespaces?: readonly string[],
  ): Promise<ToolResponse> {
    return handleSafe(async () =>
      this.unifiedCache.smartCleanup(
        targetSize,
        // Omitted = all caches; pass even an empty list through so an empty
        // selection cleans nothing rather than wiping every cache.
        namespaces === undefined ? undefined : { namespaces },
      ),
    );
  }

  async handleClearAllCaches(): Promise<ToolResponse> {
    return handleSafe(async () => {
      await this.unifiedCache.clearAll();
      return { message: 'All caches cleared' };
    });
  }

  async handleCleanupArtifacts(args: {
    retentionDays?: number;
    maxTotalBytes?: number;
    dryRun?: boolean;
    categories?: ArtifactCategory[];
    excludeCategories?: ArtifactCategory[];
  }): Promise<ToolResponse> {
    return handleSafe(async () =>
      this.artifactCleanup({
        retentionDays: args.retentionDays,
        maxTotalBytes: args.maxTotalBytes,
        dryRun: args.dryRun,
        ...(args.categories ? { categories: args.categories } : {}),
        ...(args.excludeCategories ? { excludeCategories: args.excludeCategories } : {}),
      }),
    );
  }

  async handleEnvironmentDoctor(args: { includeBridgeHealth?: boolean }): Promise<ToolResponse> {
    return handleSafe(async () =>
      this.environmentDoctor({ includeBridgeHealth: args.includeBridgeHealth }),
    );
  }

  async handleDetectGpu(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () =>
      classifyGpuInputs({
        webglRenderer: typeof args.webglRenderer === 'string' ? args.webglRenderer : undefined,
        webgpuDescription:
          typeof args.webgpuDescription === 'string' ? args.webgpuDescription : undefined,
        deviceName: typeof args.deviceName === 'string' ? args.deviceName : undefined,
      }),
    );
  }

  /**
   * Resolve and validate the snapshot target directory, then build a manager
   * over the deterministic per-target shadow-git store.
   *
   * Path guard: `resolveSafeOutputPath` enforces (symlink-aware) containment
   * inside the project root or system temp directories, blocking directory
   * traversal before any git command or filesystem write happens. The store
   * always lives OUTSIDE the target, so `git add -A` can never index the
   * store itself.
   */
  private async resolveSnapshotTarget(targetDir: unknown): Promise<SnapshotManager> {
    if (typeof targetDir !== 'string' || targetDir.trim().length === 0) {
      throw new Error('targetDir must be a non-empty string');
    }
    const workTree = await resolveSafeOutputPath(targetDir.trim(), {
      allowedRoots: [getProjectRoot(), ...getSystemTempRoots()],
      allowedRootsDescription: TARGET_DIR_ALLOWED_ROOTS_DESCRIPTION,
    });
    const storeDir = deriveSnapshotStoreDir(
      workTree,
      snapshotStoreBaseDir(),
      snapshotStoreFallbackBaseDir(),
    );
    return this.snapshotManagerFactory({ storeDir, workTree });
  }

  async handleSnapshotCreate(args: {
    targetDir?: unknown;
    label?: unknown;
  }): Promise<ToolResponse> {
    return handleSafe(async () => {
      const manager = await this.resolveSnapshotTarget(args.targetDir);
      const label =
        typeof args.label === 'string' && args.label.trim().length > 0
          ? args.label.trim()
          : undefined;
      const record: SnapshotRecord = await manager.snapshot(label);
      return {
        message: 'Snapshot created',
        snapshotId: record.id,
        treeHash: record.treeHash,
        label: record.label,
        timestamp: record.timestamp,
        warning:
          'Snapshot stores full file contents in the shadow-git store; run gc periodically if the target churns heavily.',
      };
    });
  }

  async handleSnapshotList(args: { targetDir?: unknown }): Promise<ToolResponse> {
    return handleSafe(async () => {
      const manager = await this.resolveSnapshotTarget(args.targetDir);
      const snapshots = await manager.list();
      return {
        message: `Found ${snapshots.length} snapshot(s)`,
        count: snapshots.length,
        snapshots,
      };
    });
  }

  async handleSnapshotRestore(args: {
    targetDir?: unknown;
    snapshotId?: unknown;
  }): Promise<ToolResponse> {
    return handleSafe(async () => {
      if (typeof args.snapshotId !== 'string' || args.snapshotId.trim().length === 0) {
        throw new Error('snapshotId must be a non-empty string');
      }
      const manager = await this.resolveSnapshotTarget(args.targetDir);
      const result = await manager.restore(args.snapshotId.trim());
      return {
        message: `Restored ${result.restoredFiles} file(s); reverted to snapshot ${result.snapshotId}`,
        ...result,
        warning:
          'Full revert semantics applied: files created after the snapshot were deleted. Create a new snapshot first if you may need the current state.',
      };
    });
  }
}
