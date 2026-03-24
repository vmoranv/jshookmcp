import type { HookOptions, HookResult, HookRecord, HookContext } from '@internal-types/index';
import { logger } from '@utils/logger';
import {
  generateHookScript,
  getInjectionInstructions,
  generateAntiDebugBypass,
  generateHookTemplate,
  generateHookChain,
} from '@modules/hook/HookGenerator';

interface HookMetadata {
  id: string;
  enabled: boolean;
  createdAt: number;
  callCount: number;
  totalExecutionTime: number;
  lastCalled?: number;
}

export class HookManager {
  private hooks: Map<string, HookRecord[]> = new Map();
  private hookScripts: Map<string, string> = new Map();
  private hookMetadata: Map<string, HookMetadata> = new Map();
  private hookConditions: Map<string, HookOptions['condition']> = new Map();

  private readonly MAX_HOOK_RECORDS = 1000;
  private readonly MAX_TOTAL_RECORDS = 10000;

  async createHook(options: HookOptions): Promise<HookResult> {
    logger.info(`Creating hook for ${options.target} (type: ${options.type})...`);

    try {
      const { target, type, action = 'log', condition, performance = false } = options;

      const hookScript = generateHookScript(
        target,
        type,
        action,
        options.customCode,
        condition,
        performance,
      );

      const hookId = `${target}-${type}-${Date.now()}`;
      this.hookScripts.set(hookId, hookScript);

      if (condition) {
        this.hookConditions.set(hookId, condition);
      }

      this.hookMetadata.set(hookId, {
        id: hookId,
        enabled: true,
        createdAt: Date.now(),
        callCount: 0,
        totalExecutionTime: 0,
      });

      logger.success(`Hook created: ${hookId}`);

      return {
        hookId,
        script: hookScript,
        instructions: getInjectionInstructions(type),
      };
    } catch (error) {
      logger.error('Failed to create hook', error);
      throw error;
    }
  }

  recordHookEvent(hookId: string, context: HookContext): void {
    const record: HookRecord = {
      hookId,
      timestamp: Date.now(),
      context,
    };

    const records = this.hooks.get(hookId) || [];
    records.push(record);
    this.hooks.set(hookId, records);

    logger.debug(`Hook event recorded: ${hookId}`);
  }

  getHookRecords(hookId: string): HookRecord[] {
    return this.hooks.get(hookId) || [];
  }

  clearHookRecords(hookId?: string): void {
    if (hookId) {
      this.hooks.delete(hookId);
      logger.info(`Cleared records for hook: ${hookId}`);
    } else {
      this.hooks.clear();
      logger.info('Cleared all hook records');
    }
  }

  enableHook(hookId: string): void {
    const metadata = this.hookMetadata.get(hookId);
    if (metadata) {
      metadata.enabled = true;
      logger.info(`Hook enabled: ${hookId}`);
    } else {
      logger.warn(`Hook not found: ${hookId}`);
    }
  }

  disableHook(hookId: string): void {
    const metadata = this.hookMetadata.get(hookId);
    if (metadata) {
      metadata.enabled = false;
      logger.info(`Hook disabled: ${hookId}`);
    } else {
      logger.warn(`Hook not found: ${hookId}`);
    }
  }

  getHookMetadata(hookId: string): HookMetadata | undefined {
    return this.hookMetadata.get(hookId);
  }

  getAllHookMetadata(): HookMetadata[] {
    return Array.from(this.hookMetadata.values());
  }

  exportHookData(hookId?: string): {
    metadata: HookMetadata[];
    records: Record<string, HookRecord[]>;
    scripts: Record<string, string>;
  } {
    if (hookId) {
      const metadata = this.hookMetadata.get(hookId);
      const records = this.hooks.get(hookId) || [];
      const script = this.hookScripts.get(hookId) || '';

      return {
        metadata: metadata ? [metadata] : [],
        records: { [hookId]: records },
        scripts: { [hookId]: script },
      };
    }

    const metadata = Array.from(this.hookMetadata.values());
    const records: Record<string, HookRecord[]> = {};
    const scripts: Record<string, string> = {};

    this.hooks.forEach((value, key) => {
      records[key] = value;
    });

    this.hookScripts.forEach((value, key) => {
      scripts[key] = value;
    });

    return { metadata, records, scripts };
  }

  getHookStats(hookId: string): {
    callCount: number;
    avgExecutionTime: number;
    totalExecutionTime: number;
    enabled: boolean;
  } | null {
    const metadata = this.hookMetadata.get(hookId);
    if (!metadata) {
      return null;
    }

    return {
      callCount: metadata.callCount,
      avgExecutionTime:
        metadata.callCount > 0 ? metadata.totalExecutionTime / metadata.callCount : 0,
      totalExecutionTime: metadata.totalExecutionTime,
      enabled: metadata.enabled,
    };
  }

  deleteHook(hookId: string): void {
    this.hookScripts.delete(hookId);
    this.hookMetadata.delete(hookId);
    this.hookConditions.delete(hookId);
    this.hooks.delete(hookId);
    logger.info(`Hook deleted: ${hookId}`);
  }

  getAllHooks(): string[] {
    return Array.from(this.hookScripts.keys());
  }

  recordHookCall(hookId: string, record: HookRecord): void {
    if (!this.hooks.has(hookId)) {
      this.hooks.set(hookId, []);
    }

    const records = this.hooks.get(hookId)!;

    if (records.length >= this.MAX_HOOK_RECORDS) {
      records.shift();
      logger.debug(`Hook ${hookId} reached max records, removed oldest`);
    }

    records.push(record);

    const totalRecords = Array.from(this.hooks.values()).reduce((sum, arr) => sum + arr.length, 0);
    if (totalRecords > this.MAX_TOTAL_RECORDS) {
      this.cleanupOldestRecords();
    }

    const metadata = this.hookMetadata.get(hookId);
    if (metadata) {
      metadata.callCount++;
      metadata.lastCalled = Date.now();
    }
  }

  private cleanupOldestRecords(): void {
    let oldestHookId: string | null = null;
    let oldestTimestamp = Infinity;

    for (const [hookId, records] of this.hooks.entries()) {
      if (records.length > 0) {
        const firstRecord = records[0];
        if (firstRecord && firstRecord.timestamp < oldestTimestamp) {
          oldestTimestamp = firstRecord.timestamp;
          oldestHookId = hookId;
        }
      }
    }

    if (oldestHookId) {
      const records = this.hooks.get(oldestHookId)!;
      const removeCount = Math.floor(records.length / 2);
      records.splice(0, removeCount);
      logger.warn(
        `Cleaned up ${removeCount} old records from ${oldestHookId} (total records exceeded limit)`,
      );
    }
  }

  getHookRecordsStats(): {
    totalHooks: number;
    totalRecords: number;
    recordsByHook: Record<string, number>;
    oldestRecord: number | null;
    newestRecord: number | null;
  } {
    let totalRecords = 0;
    let oldestRecord: number | null = null;
    let newestRecord: number | null = null;
    const recordsByHook: Record<string, number> = {};

    for (const [hookId, records] of this.hooks.entries()) {
      recordsByHook[hookId] = records.length;
      totalRecords += records.length;

      if (records.length > 0) {
        const firstRecord = records[0];
        const lastRecord = records[records.length - 1];

        if (firstRecord) {
          const firstTimestamp = firstRecord.timestamp;
          if (oldestRecord === null || firstTimestamp < oldestRecord) {
            oldestRecord = firstTimestamp;
          }
        }

        if (lastRecord) {
          const lastTimestamp = lastRecord.timestamp;
          if (newestRecord === null || lastTimestamp > newestRecord) {
            newestRecord = lastTimestamp;
          }
        }
      }
    }

    return {
      totalHooks: this.hooks.size,
      totalRecords,
      recordsByHook,
      oldestRecord,
      newestRecord,
    };
  }

  async createBatchHooks(
    targets: Array<{
      target: string;
      type: HookOptions['type'];
      action?: 'log' | 'block' | 'modify';
    }>,
  ): Promise<HookResult[]> {
    logger.info(`Creating ${targets.length} hooks...`);

    const results: HookResult[] = [];

    for (const { target, type, action = 'log' } of targets) {
      try {
        const result = await this.createHook({ target, type, action });
        results.push(result);
      } catch (error) {
        logger.error(`Failed to create hook for ${target}:`, error);
      }
    }

    logger.success(`Created ${results.length}/${targets.length} hooks`);
    return results;
  }

  generateAntiDebugBypass(): string {
    return generateAntiDebugBypass();
  }

  generateHookTemplate(
    targetName: string,
    targetType: 'function' | 'property' | 'prototype',
  ): string {
    return generateHookTemplate(targetName, targetType);
  }

  generateHookChain(hooks: HookResult[]): string {
    return generateHookChain(hooks);
  }
}
