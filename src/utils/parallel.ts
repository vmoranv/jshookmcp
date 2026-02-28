import { logger } from './logger.js';

export interface ParallelOptions {
  maxConcurrency?: number;
  timeout?: number;
  retryOnError?: boolean;
  maxRetries?: number;
}

export interface TaskResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  duration: number;
}

export async function parallelExecute<T, R>(
  items: T[],
  executor: (item: T, index: number) => Promise<R>,
  options: ParallelOptions = {}
): Promise<TaskResult<R>[]> {
  const { maxConcurrency = 3, timeout = 60000, retryOnError = false, maxRetries = 2 } = options;

  const results: TaskResult<R>[] = [];
  const executing = new Set<Promise<void>>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item === undefined) continue;

    const task = (async () => {
      const startTime = Date.now();
      let lastError: Error | undefined;

      for (let attempt = 0; attempt <= (retryOnError ? maxRetries : 0); attempt++) {
        try {
          const result = await new Promise<R>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Task timeout')), timeout);
            executor(item, i).then(
              (v) => { clearTimeout(timer); resolve(v); },
              (e) => { clearTimeout(timer); reject(e); }
            );
          });

          results[i] = {
            success: true,
            data: result,
            duration: Date.now() - startTime,
          };
          return;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (attempt < (retryOnError ? maxRetries : 0)) {
            logger.warn(`Task ${i} failed, retrying (${attempt + 1}/${maxRetries})...`);
            await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
          }
        }
      }

      results[i] = {
        success: false,
        error: lastError,
        duration: Date.now() - startTime,
      };
    })();

    const wrappedTask = task.then(
      () => { executing.delete(wrappedTask); },
      () => { executing.delete(wrappedTask); }
    );
    executing.add(wrappedTask);

    if (executing.size >= maxConcurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);

  return results;
}

export async function batchProcess<T, R>(
  items: T[],
  executor: (batch: T[]) => Promise<R[]>,
  batchSize: number = 10
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    logger.debug(
      `Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(items.length / batchSize)}`
    );

    try {
      const batchResults = await executor(batch);
      results.push(...batchResults);
    } catch (error) {
      logger.error(`Batch processing failed at index ${i}`, error);
      throw error;
    }
  }

  return results;
}

export class TaskQueue<T, R> {
  private queue: Array<{
    item: T;
    resolve: (value: R) => void;
    reject: (error: Error) => void;
  }> = [];
  private running = 0;
  private maxConcurrency: number;
  private executor: (item: T) => Promise<R>;

  constructor(executor: (item: T) => Promise<R>, maxConcurrency: number = 3) {
    this.executor = executor;
    this.maxConcurrency = maxConcurrency;
  }

  async add(item: T): Promise<R> {
    return new Promise((resolve, reject) => {
      this.queue.push({ item, resolve, reject });
      this.process();
    });
  }

  private async process(): Promise<void> {
    if (this.running >= this.maxConcurrency || this.queue.length === 0) {
      return;
    }

    const task = this.queue.shift();
    if (!task) return;

    this.running++;

    try {
      const result = await this.executor(task.item);
      task.resolve(result);
    } catch (error) {
      task.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.running--;
      this.process();
    }
  }

  getStatus() {
    return {
      queueLength: this.queue.length,
      running: this.running,
      maxConcurrency: this.maxConcurrency,
    };
  }

  clear(): void {
    this.queue.forEach((task) => {
      task.reject(new Error('Queue cleared'));
    });
    this.queue = [];
  }
}

export class RateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number;
  private lastRefill: number;

  constructor(maxTokens: number, refillRate: number) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillRate;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  async acquire(tokens: number = 1): Promise<void> {
    while (true) {
      this.refill();

      if (this.tokens >= tokens) {
        this.tokens -= tokens;
        return;
      }

      const waitTime = ((tokens - this.tokens) / this.refillRate) * 1000;
      await new Promise((resolve) => setTimeout(resolve, Math.min(waitTime, 1000)));
    }
  }

  getTokens(): number {
    this.refill();
    return this.tokens;
  }
}
