import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { CacheConfig } from '@internal-types/index';
import { logger } from '@utils/logger';

export class CacheManager {
  private config: CacheConfig;

  constructor(config: CacheConfig) {
    this.config = config;
  }

  async init(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    try {
      await fs.mkdir(this.config.dir, { recursive: true });
      logger.debug(`Cache directory initialized: ${this.config.dir}`);
    } catch (error) {
      logger.error('Failed to initialize cache directory', error);
    }
  }

  private generateKey(key: string): string {
    return createHash('md5').update(key).digest('hex');
  }

  private getCachePath(key: string): string {
    const hashedKey = this.generateKey(key);
    return join(this.config.dir, `${hashedKey}.json`);
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.config.enabled) {
      return null;
    }

    try {
      const cachePath = this.getCachePath(key);
      const data = await fs.readFile(cachePath, 'utf-8');
      const cached: unknown = JSON.parse(data);
      // Corrupt, truncated, or legacy-format files must not be treated as a
      // fresh entry: `Date.now() - undefined` is NaN, and `NaN > ttl` is false,
      // which would return `undefined` as a hit and violate the T|null contract.
      if (
        typeof cached !== 'object' ||
        cached === null ||
        typeof (cached as { timestamp?: unknown }).timestamp !== 'number' ||
        !Number.isFinite((cached as { timestamp: number }).timestamp)
      ) {
        await this.delete(key);
        return null;
      }
      const entry = cached as { timestamp: number; value: T };

      if (Date.now() - entry.timestamp > this.config.ttl * 1000) {
        await this.delete(key);
        return null;
      }

      logger.debug(`Cache hit: ${key}`);
      return entry.value;
    } catch {
      logger.debug(`Cache miss: ${key}`);
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    try {
      const cachePath = this.getCachePath(key);
      const data = {
        timestamp: Date.now(),
        value,
      };
      await fs.writeFile(cachePath, JSON.stringify(data), 'utf-8');
      logger.debug(`Cache set: ${key}`);
    } catch (error) {
      logger.error('Failed to set cache', error);
    }
  }

  async delete(key: string): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    try {
      const cachePath = this.getCachePath(key);
      await fs.unlink(cachePath);
      logger.debug(`Cache deleted: ${key}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('Cache delete failed:', error);
      }
    }
  }

  async clear(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    try {
      const files = await fs.readdir(this.config.dir);
      await Promise.all(files.map((file) => fs.unlink(join(this.config.dir, file))));
      logger.info('Cache cleared');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      logger.error('Failed to clear cache', error);
    }
  }
}
