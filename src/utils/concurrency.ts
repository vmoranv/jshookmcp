/**
 * Global concurrency limiters for different resource categories.
 * Prevents OOM and event-loop starvation under heavy load.
 *
 * Usage:
 *   import { ioLimit, cpuLimit, cdpLimit } from '../utils/concurrency.js';
 *   const result = await ioLimit(() => runExternalTool(...));
 */

// Lightweight p-limit implementation to avoid adding a dependency.
// Compatible with the p-limit API: const limit = pLimit(n); limit(() => promise)

type LimitFunction = <T>(fn: () => Promise<T> | T) => Promise<T>;

function pLimit(concurrency: number): LimitFunction {
  if (concurrency < 1) throw new RangeError('concurrency must be >= 1');

  let activeCount = 0;
  const queue: Array<() => void> = [];

  function next(): void {
    if (queue.length > 0 && activeCount < concurrency) {
      activeCount++;
      const resolve = queue.shift()!;
      resolve();
    }
  }

  function run<T>(fn: () => Promise<T> | T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const execute = async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          activeCount--;
          next();
        }
      };

      if (activeCount < concurrency) {
        activeCount++;
        execute();
      } else {
        queue.push(() => { execute(); });
      }
    });
  }

  return run;
}

/** External CLI calls, HAR export, large file I/O */
export const ioLimit = pLimit(
  parseInt(process.env.JSHHOOK_IO_CONCURRENCY || '4', 10)
);

/** CPU-heavy: AST parsing, deobfuscation, binary decoding */
export const cpuLimit = pLimit(
  parseInt(process.env.JSHHOOK_CPU_CONCURRENCY || '2', 10)
);

/** CDP-heavy: heap snapshots, traces, profiling */
export const cdpLimit = pLimit(
  parseInt(process.env.JSHHOOK_CDP_CONCURRENCY || '2', 10)
);
