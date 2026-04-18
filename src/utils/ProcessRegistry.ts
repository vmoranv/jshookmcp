import type { ChildProcess } from 'node:child_process';
import type { Worker } from 'node:worker_threads';
import { logger } from '@utils/logger';
import { EXTERNAL_TOOL_FORCE_KILL_GRACE_MS } from '@src/constants';

type TrackedProcess = ChildProcess | Worker;

/**
 * Global singleton registry to track and safely terminate orphaned child
 * processes and worker threads upon server shutdown.
 */
class ProcessRegistrySingleton {
  private processes = new Set<TrackedProcess>();

  /**
   * Register a ChildProcess or Worker for automatic cleanup on shutdown.
   */
  register(proc: TrackedProcess): void {
    if (!proc) return;
    this.processes.add(proc);

    // Auto-deregister on completion to prevent memory leaks
    if ('kill' in proc) {
      // It's a ChildProcess
      proc.once('exit', () => this.unregister(proc));
      proc.once('close', () => this.unregister(proc));
    } else if ('terminate' in proc) {
      // It's a Worker
      proc.once('exit', () => this.unregister(proc));
    }
  }

  /**
   * Unregister a process/worker.
   */
  unregister(proc: TrackedProcess): void {
    if (!proc) return;
    this.processes.delete(proc);
  }

  /**
   * Terminate all tracked processes and workers.
   * Sends SIGTERM, then after a grace period sends SIGKILL.
   */
  async terminateAll(): Promise<void> {
    if (this.processes.size === 0) return;

    logger.debug(
      `[ProcessRegistry] Attempting to terminate ${this.processes.size} active processes/workers...`,
    );

    const terminationPromises: Promise<void>[] = [];

    for (const proc of this.processes) {
      if ('terminate' in proc) {
        // Handle Worker thread
        terminationPromises.push(
          proc
            .terminate()
            .then(() => {
              this.processes.delete(proc);
            })
            .catch((err: Error) => {
              logger.warn(`[ProcessRegistry] Error terminating worker: ${err.message}`);
            }),
        );
      } else if ('kill' in proc) {
        // Handle ChildProcess
        terminationPromises.push(
          new Promise<void>((resolve) => {
            if (proc.killed || proc.exitCode !== null || proc.signalCode !== null) {
              this.processes.delete(proc);
              return resolve();
            }

            // Send SIGTERM first
            proc.kill('SIGTERM');

            let settled = false;

            const handleExit = () => {
              if (settled) return;
              settled = true;
              this.processes.delete(proc);
              resolve();
            };

            proc.once('exit', handleExit);
            proc.once('close', handleExit);

            // Fallback to SIGKILL after grace period
            setTimeout(() => {
              if (!settled && !proc.killed && proc.exitCode === null) {
                logger.debug(`[ProcessRegistry] Force killing child process PID ${proc.pid}`);
                try {
                  proc.kill('SIGKILL');
                } catch {
                  // Ignore
                }
                handleExit();
              }
            }, EXTERNAL_TOOL_FORCE_KILL_GRACE_MS).unref();
          }),
        );
      }
    }

    // Wait for all to finish, but don't block indefinitely
    await Promise.race([
      Promise.all(terminationPromises),
      new Promise<void>((resolve) =>
        setTimeout(resolve, EXTERNAL_TOOL_FORCE_KILL_GRACE_MS + 1000).unref(),
      ),
    ]);

    this.processes.clear();
    logger.debug(`[ProcessRegistry] Termination sweep complete.`);
  }
}

export const ProcessRegistry = new ProcessRegistrySingleton();
