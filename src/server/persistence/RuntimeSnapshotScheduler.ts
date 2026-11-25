import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { logger } from '@utils/logger';
import { getStateDir } from '@utils/stateDir';

export { getStateDir };

/**
 * Counts reported by a snapshot restore — the number of records dropped or
 * evicted while trimming a restored snapshot back to its configured caps.
 * The shape is intentionally loose: each source reports its own subset of keys
 * (e.g. `{ droppedNodes, droppedEdges }` for the evidence graph, or
 * `{ evictedHistoryKeys }` for the state board).
 */
export interface SnapshotRestoreSummary {
  droppedNodes?: number;
  droppedEdges?: number;
  evictedHistoryKeys?: number;
}

export interface SnapshotSource {
  isPersistDirty(): boolean;
  exportSnapshot(): unknown;
  restoreSnapshot(data: unknown): void | SnapshotRestoreSummary;
  markPersisted(): void;
}

interface SnapshotSourceEntry {
  source: SnapshotSource;
  filePath: string;
}

/** Default debounce window (ms) before persisting dirty snapshots after notifyDirty(). */
const DEFAULT_DEBOUNCE_MS = 2000;
/** Default periodic flush interval (ms) for dirty snapshots while the scheduler is started. */
const DEFAULT_PERIODIC_MS = 30_000;

export class RuntimeSnapshotScheduler {
  private readonly sources: SnapshotSourceEntry[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private readonly debounceMs: number;
  private readonly periodicMs: number;
  private disposed = false;
  private started = false;
  /** Per-entry in-flight write so overlapping flushes coalesce instead of racing. */
  private readonly inFlightWrites = new Map<SnapshotSourceEntry, Promise<void>>();
  private nextTempId = 0;

  constructor(options?: { debounceMs?: number; periodicMs?: number }) {
    this.debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.periodicMs = options?.periodicMs ?? DEFAULT_PERIODIC_MS;
  }

  register(filePath: string, source: SnapshotSource): void {
    const entry = this.upsertSource(filePath, source);
    if (entry && this.started) {
      void this.restoreOne(entry).catch((err) =>
        logger.warn(`snapshot restore failed for ${entry.filePath}:`, err),
      );
    }
  }

  /**
   * Awaitable registration: resolves only after the restore (when the
   * scheduler is already started) has completed. Lazy sources — e.g. the
   * search trackers, registered when the engine is first built mid-session —
   * must use this variant and be awaited BEFORE any recording starts: the
   * fire-and-forget restore in `register()` races with the first record,
   * and restoreSnapshot() rebuilds internal state from the file, clobbering
   * whatever was recorded before the restore landed.
   */
  async registerAsync(filePath: string, source: SnapshotSource): Promise<void> {
    const entry = this.upsertSource(filePath, source);
    if (entry && this.started) {
      await this.restoreOne(entry);
    }
  }

  /**
   * Insert, dedupe, or swap a source. Returns the entry when a registration
   * or replacement occurred, or undefined when the (source, path) pair is
   * already registered — idempotent re-registration must not re-run the
   * restore, or it would wipe records added since the first restore.
   */
  private upsertSource(filePath: string, source: SnapshotSource): SnapshotSourceEntry | undefined {
    const byPath = this.sources.find((entry) => entry.filePath === filePath);
    if (byPath) {
      if (byPath.source === source) return undefined;
      // Same file, new source: the live instance was rebuilt (engine
      // re-construction on extension reload swaps the trackers). Replace in
      // place so flushes persist the CURRENT instance, not the retired one.
      byPath.source = source;
      return byPath;
    }
    const bySource = this.sources.find((entry) => entry.source === source);
    if (bySource) {
      logger.warn(`skipping conflicting snapshot registration for ${filePath}`);
      return undefined;
    }
    const entry: SnapshotSourceEntry = { source, filePath };
    this.sources.push(entry);
    return entry;
  }

  /** Read-only view of the registered sources (test/inspection surface). */
  getRegisteredSources(): readonly { filePath: string; source: SnapshotSource }[] {
    return this.sources;
  }

  async start(): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;
    await this.restoreAll();
    if (this.disposed || this.periodicTimer) return;
    this.periodicTimer = setInterval(() => {
      this.scheduleFlush().catch((err) => logger.warn('periodic snapshot failed:', err));
    }, this.periodicMs);
    // unref so a running periodic flush never blocks graceful process exit.
    if (this.periodicTimer.unref) {
      this.periodicTimer.unref();
    }
  }

  notifyDirty(): void {
    if (this.disposed) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.scheduleFlush().catch((err) => logger.warn('debounce snapshot failed:', err));
    }, this.debounceMs);
  }

  async flushAll(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    await this.writeDirtySources();
  }

  dispose(): void {
    this.disposed = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }

  private async restoreAll(): Promise<void> {
    for (const entry of this.sources) {
      await this.restoreOne(entry);
    }
  }

  private async restoreOne(entry: SnapshotSourceEntry): Promise<void> {
    try {
      const data = await readFile(entry.filePath, 'utf-8');
      const parsed = JSON.parse(data);
      const summary = entry.source.restoreSnapshot(parsed);
      logger.info(`restored snapshot from ${entry.filePath}${describeRestoreSummary(summary)}`);
    } catch {
      // No snapshot file or corrupt — start fresh (normal on first run)
    }
  }

  private async scheduleFlush(): Promise<void> {
    await this.writeDirtySources();
  }

  private async writeDirtySources(): Promise<void> {
    for (const entry of this.sources) {
      if (!entry.source.isPersistDirty()) continue;
      try {
        await this.writeSnapshot(entry);
      } catch (err) {
        logger.warn(`snapshot write failed for ${entry.filePath}:`, err);
      }
    }
  }

  private writeSnapshot(entry: SnapshotSourceEntry): Promise<void> {
    // The debounce timer, the periodic interval and flushAll() can overlap.
    // Coalescing on the entry prevents two writers from truncating/renaming
    // the same file (and a stale writer from overwriting a newer snapshot).
    const inFlight = this.inFlightWrites.get(entry);
    if (inFlight) return inFlight;

    const write = this.performWriteSnapshot(entry).finally(() => {
      if (this.inFlightWrites.get(entry) === write) {
        this.inFlightWrites.delete(entry);
      }
    });
    this.inFlightWrites.set(entry, write);
    return write;
  }

  private async performWriteSnapshot(entry: SnapshotSourceEntry): Promise<void> {
    const dir = dirname(entry.filePath);
    await mkdir(dir, { recursive: true });
    const data = JSON.stringify(entry.source.exportSnapshot());
    // Unique temp name: even a writer from another process cannot collide.
    const tmpPath = `${entry.filePath}.${process.pid}.${this.nextTempId++}.tmp`;
    try {
      await writeFile(tmpPath, data, 'utf-8');
      await rename(tmpPath, entry.filePath);
    } catch (error) {
      await rm(tmpPath, { force: true }).catch(() => undefined);
      throw error;
    }
    entry.source.markPersisted();
    // A mutation can land while the write above was in flight. markPersisted()
    // cleared the flag, but the on-disk snapshot predates that mutation, so
    // re-schedule a flush rather than waiting for the next unrelated change.
    if (entry.source.isPersistDirty()) {
      this.notifyDirty();
    }
  }
}

/** Renders restore summary counts as a compact ` (key=value, ...)` log suffix. */
function describeRestoreSummary(summary: void | SnapshotRestoreSummary): string {
  if (!summary || typeof summary !== 'object') return '';
  const parts = Object.entries(summary)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .map(([key, value]) => `${key}=${value}`);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}
