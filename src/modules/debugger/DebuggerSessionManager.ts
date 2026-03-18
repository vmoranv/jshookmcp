import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { logger } from '@utils/logger';
import type { DebuggerSession } from '@internal-types/index';
import type { DebuggerManager } from '@modules/debugger/DebuggerManager';

type SavedDebuggerSessionSummary = {
  path: string;
  timestamp: number;
  metadata?: DebuggerSession['metadata'];
};

/**
 * Handles persistence and restoration of debugger sessions (breakpoints, exception state).
 * Delegates all actual debugging operations back to DebuggerManager.
 */
export class DebuggerSessionManager {
  private readonly SESSION_IMPORT_BATCH_SIZE = 8;
  private readonly SESSION_FILE_READ_BATCH_SIZE = 8;

  constructor(private debuggerManager: DebuggerManager) {}

  private async processInBatches<T>(
    items: readonly T[],
    batchSize: number,
    worker: (item: T) => Promise<void>
  ): Promise<void> {
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      await Promise.all(batch.map((item) => worker(item)));
    }
  }

  private async readSessionFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf-8');
  }

  /** Ensure filePath is within cwd or system temp dir to prevent arbitrary file access. */
  private async validateFilePath(filePath: string): Promise<string> {
    const resolved = path.resolve(filePath);
    const cwd = await fs.realpath(process.cwd());
    const tmpDir = await fs.realpath(os.tmpdir());
    // Resolve the parent directory (the file itself may not exist yet for save)
    const parentDir = path.dirname(resolved);
    let realParent: string;
    try {
      realParent = await fs.realpath(parentDir);
    } catch {
      // Parent doesn't exist yet — use the resolved path as-is
      realParent = parentDir;
    }
    const realPath = path.join(realParent, path.basename(resolved));
    const inCwd = realPath === cwd || realPath.startsWith(cwd + path.sep);
    const inTmp = realPath === tmpDir || realPath.startsWith(tmpDir + path.sep);
    if (!inCwd && !inTmp) {
      throw new Error('filePath must be within the current working directory or system temp dir.');
    }
    return realPath;
  }

  exportSession(metadata?: DebuggerSession['metadata']): DebuggerSession {
    const session: DebuggerSession = {
      version: '1.0',
      timestamp: Date.now(),
      breakpoints: Array.from(this.debuggerManager.getBreakpoints().values()).map((bp) => ({
        location: {
          scriptId: bp.location.scriptId,
          url: bp.location.url,
          lineNumber: bp.location.lineNumber,
          columnNumber: bp.location.columnNumber,
        },
        condition: bp.condition,
        enabled: bp.enabled,
      })),
      pauseOnExceptions: this.debuggerManager.getPauseOnExceptionsState(),
      metadata: metadata || {},
    };

    logger.info('Session exported', {
      breakpointCount: session.breakpoints.length,
      pauseOnExceptions: session.pauseOnExceptions,
    });

    return session;
  }

  async saveSession(filePath?: string, metadata?: DebuggerSession['metadata']): Promise<string> {
    const session = this.exportSession(metadata);

    if (!filePath) {
      const sessionsDir = path.join(process.cwd(), 'debugger-sessions');
      await fs.mkdir(sessionsDir, { recursive: true });
      filePath = path.join(sessionsDir, `session-${Date.now()}.json`);
    } else {
      filePath = await this.validateFilePath(filePath);
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
    }

    await fs.writeFile(filePath, JSON.stringify(session, null, 2), 'utf-8');

    logger.info(`Session saved to ${filePath}`, {
      breakpointCount: session.breakpoints.length,
    });

    return filePath;
  }

  async loadSessionFromFile(filePath: string): Promise<void> {
    const resolvedPath = await this.validateFilePath(filePath);
    const content = await this.readSessionFile(resolvedPath);
    const session: DebuggerSession = JSON.parse(content);

    await this.importSession(session);

    logger.info(`Session loaded from ${resolvedPath}`, {
      breakpointCount: session.breakpoints.length,
    });
  }

  async importSession(sessionData: DebuggerSession | string): Promise<void> {
    if (!this.debuggerManager.isEnabled()) {
      throw new Error(
        'Debugger must be enabled before importing session. Call init() or enable() first.'
      );
    }

    const session: DebuggerSession =
      typeof sessionData === 'string' ? JSON.parse(sessionData) : sessionData;

    if (session.version !== '1.0') {
      logger.warn(`Session version mismatch: ${session.version} (expected 1.0)`);
    }

    logger.info('Importing session...', {
      breakpointCount: session.breakpoints.length,
      pauseOnExceptions: session.pauseOnExceptions,
      timestamp: new Date(session.timestamp).toISOString(),
    });

    await this.debuggerManager.clearAllBreakpoints();

    let successCount = 0;
    let failCount = 0;

    await this.processInBatches(session.breakpoints, this.SESSION_IMPORT_BATCH_SIZE, async (bp) => {
      try {
        if (bp.location.url) {
          await this.debuggerManager.setBreakpointByUrl({
            url: bp.location.url,
            lineNumber: bp.location.lineNumber,
            columnNumber: bp.location.columnNumber,
            condition: bp.condition,
          });
          successCount++;
        } else if (bp.location.scriptId) {
          await this.debuggerManager.setBreakpoint({
            scriptId: bp.location.scriptId,
            lineNumber: bp.location.lineNumber,
            columnNumber: bp.location.columnNumber,
            condition: bp.condition,
          });
          successCount++;
        } else {
          logger.warn('Breakpoint has neither url nor scriptId, skipping', bp);
          failCount++;
        }
      } catch (error) {
        logger.error('Failed to restore breakpoint:', error, bp);
        failCount++;
      }
    });

    if (session.pauseOnExceptions) {
      await this.debuggerManager.setPauseOnExceptions(session.pauseOnExceptions);
    }

    logger.info('Session imported', {
      totalBreakpoints: session.breakpoints.length,
      successCount,
      failCount,
      pauseOnExceptions: session.pauseOnExceptions,
    });
  }

  async listSavedSessions(): Promise<SavedDebuggerSessionSummary[]> {
    const sessionsDir = path.join(process.cwd(), 'debugger-sessions');

    try {
      await fs.access(sessionsDir);
    } catch {
      return [];
    }

    const files = await fs.readdir(sessionsDir);
    const sessions: SavedDebuggerSessionSummary[] = [];

    const sessionFiles = files.filter((file) => file.endsWith('.json'));
    await this.processInBatches(sessionFiles, this.SESSION_FILE_READ_BATCH_SIZE, async (file) => {
      const filePath = path.join(sessionsDir, file);
      try {
        const content = await this.readSessionFile(filePath);
        const session: DebuggerSession = JSON.parse(content);
        sessions.push({
          path: filePath,
          timestamp: session.timestamp,
          metadata: session.metadata,
        });
      } catch (error) {
        logger.warn(`Failed to read session file ${file}:`, error);
      }
    });

    sessions.sort((a, b) => b.timestamp - a.timestamp);

    return sessions;
  }
}
