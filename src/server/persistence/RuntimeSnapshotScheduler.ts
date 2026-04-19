import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { logger } from '@utils/logger';

export interface SnapshotSource {
  isPersistDirty(): boolean;
  exportSnapshot(): unknown;
  restoreSnapshot(data: unknown): void;
  markPersisted(): void;
}

interface SnapshotSourceEntry {
  source: SnapshotSource;
  filePath: string;
}

export class RuntimeSnapshotScheduler {
  private readonly sources: SnapshotSourceEntry[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private readonly debounceMs: number;
  private readonly periodicMs: number;
  private disposed = false;
  private started = false;

  constructor(options?: { debounceMs?: number; periodicMs?: number }) {
    this.debounceMs = options?.debounceMs ?? 2000;
    this.periodicMs = options?.periodicMs ?? 30_000;
  }

  register(filePath: string, source: SnapshotSource): void {
    const existing = this.sources.find(
      (entry) => entry.filePath === filePath || entry.source === source,
    );
    if (existing) {
      if (existing.filePath !== filePath || existing.source !== source) {
        logger.warn(`skipping conflicting snapshot registration for ${filePath}`);
      }
      return;
    }

    const entry = { source, filePath };
    this.sources.push(entry);
    if (this.started) {
      void this.restoreOne(entry).catch((err) =>
        logger.warn(`snapshot restore failed for ${entry.filePath}:`, err),
      );
    }
  }

  async start(): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;
    await this.restoreAll();
    if (this.disposed || this.periodicTimer) return;
    this.periodicTimer = setInterval(() => {
      this.scheduleFlush().catch((err) => logger.warn('periodic snapshot failed:', err));
    }, this.periodicMs);
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
      entry.source.restoreSnapshot(parsed);
      logger.info(`restored snapshot from ${entry.filePath}`);
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

  private async writeSnapshot(entry: SnapshotSourceEntry): Promise<void> {
    const dir = dirname(entry.filePath);
    await mkdir(dir, { recursive: true });
    const data = JSON.stringify(entry.source.exportSnapshot());
    const tmpPath = entry.filePath + '.tmp';
    await writeFile(tmpPath, data, 'utf-8');
    await rename(tmpPath, entry.filePath);
    entry.source.markPersisted();
  }
}

export function getStateDir(baseDir: string): string {
  return resolve(baseDir, '.jshookmcp', 'state');
}
