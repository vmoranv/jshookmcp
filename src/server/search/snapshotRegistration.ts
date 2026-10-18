/**
 * Register a search engine's feedback + quality trackers as snapshot sources.
 *
 * The trackers live inside the ToolSearchEngine instance, which is built lazily
 * by getSearchEngine() only when a search actually runs (see
 * MCPServer.search.helpers). That makes registration inherently conditional:
 * a profile that never issues a search never builds the engine, so there is
 * nothing to persist — registration is simply skipped.
 *
 * Both trackers implement the SnapshotSource contract
 * (src/server/persistence/RuntimeSnapshotScheduler.ts); the scheduler owns the
 * file I/O (atomic tmp+rename into the state dir). Returns the registered
 * sources so callers (e.g. tests) can assert the wiring.
 */
import type { ToolSearchEngine } from '@server/search/ToolSearchEngine';
import type { RuntimeSnapshotScheduler } from '@server/persistence/RuntimeSnapshotScheduler';
import type { MCPServerContext } from '@server/MCPServer.context';
import { resolve } from 'node:path';

export async function registerSearchSnapshotSources(
  scheduler: RuntimeSnapshotScheduler,
  engine: ToolSearchEngine,
  stateDir: string,
): Promise<{ feedbackTracker: unknown; qualityTracker: unknown }> {
  const feedbackTracker = engine.getFeedbackTracker();
  const qualityTracker = engine.getSearchQualityTracker();
  // registerAsync (not register): the scheduler is already started by the
  // time the engine is built lazily, so the restore must COMPLETE before this
  // resolves — the caller awaits it before the first search records anything.
  await scheduler.registerAsync(resolve(stateDir, 'search-feedback.json'), feedbackTracker);
  await scheduler.registerAsync(resolve(stateDir, 'search-quality.json'), qualityTracker);
  return { feedbackTracker, qualityTracker };
}

/**
 * Register a ctx-held engine's trackers with the ctx-held scheduler, if both
 * exist. Safe to call on every search/route/call_tool — the scheduler dedupes
 * by source, and a ctx without domain instances (bare test contexts, or a
 * profile that never built an engine) simply skips registration.
 */
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
