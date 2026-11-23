/**
 * Register a search engine's quality tracker as a snapshot source.
 *
 * The tracker lives inside the lazily-built ToolSearchEngine, so registration
 * is conditional: a profile that never issues a search never builds the engine
 * and registration is skipped. The scheduler owns the file I/O.
 */
import type { ToolSearchEngine } from '@server/search/ToolSearchEngine';
import type { RuntimeSnapshotScheduler } from '@server/persistence/RuntimeSnapshotScheduler';
import type { MCPServerContext } from '@server/MCPServer.context';
import { resolve } from 'node:path';

export async function registerSearchSnapshotSources(
  scheduler: RuntimeSnapshotScheduler,
  engine: ToolSearchEngine,
  stateDir: string,
): Promise<{ qualityTracker: unknown }> {
  const qualityTracker = engine.getSearchQualityTracker();
  await scheduler.registerAsync(resolve(stateDir, 'search-quality.json'), qualityTracker);
  return { qualityTracker };
}

export async function registerSearchSnapshotSourcesFromCtx(
  ctx: MCPServerContext,
  engine: ToolSearchEngine,
): Promise<void> {
  const getInst =
    typeof ctx.getDomainInstance === 'function' ? ctx.getDomainInstance.bind(ctx) : null;
  const scheduler = getInst?.<RuntimeSnapshotScheduler>('snapshotScheduler');
  const stateDir = getInst?.<string>('snapshotStateDir');
  if (scheduler && stateDir) {
    await registerSearchSnapshotSources(scheduler, engine, stateDir);
  }
}
