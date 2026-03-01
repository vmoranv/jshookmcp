import { logger } from '../../utils/logger.js';
import type { ConsoleMessage, ExceptionInfo } from './ConsoleMonitor.impl.core.class.js';

interface LogsCoreContext {
  messages: ConsoleMessage[];
  exceptions: ExceptionInfo[];
}

function asLogsCoreContext(ctx: unknown): LogsCoreContext {
  return ctx as LogsCoreContext;
}

export function getLogsCore(
  ctx: unknown,
  filter?: {
    type?: 'log' | 'warn' | 'error' | 'info' | 'debug';
    limit?: number;
    since?: number;
  }
): ConsoleMessage[] {
  const coreCtx = asLogsCoreContext(ctx);
  let logs = coreCtx.messages;

  if (filter?.type) {
    logs = logs.filter((msg) => msg.type === filter.type);
  }

  const since = filter?.since;
  if (since !== undefined) {
    logs = logs.filter((msg) => msg.timestamp >= since);
  }

  if (filter?.limit) {
    logs = logs.slice(-filter.limit);
  }

  logger.info(`getLogs: ${logs.length} messages`);
  return logs;
}

export function clearLogsCore(ctx: unknown): void {
  const coreCtx = asLogsCoreContext(ctx);
  coreCtx.messages = [];
  logger.info('Console logs cleared');
}

export function getStatsCore(ctx: unknown): {
  totalMessages: number;
  byType: Record<string, number>;
} {
  const coreCtx = asLogsCoreContext(ctx);
  const byType: Record<string, number> = {};

  for (const msg of coreCtx.messages) {
    byType[msg.type] = (byType[msg.type] || 0) + 1;
  }

  return {
    totalMessages: coreCtx.messages.length,
    byType,
  };
}

export function getExceptionsCore(
  ctx: unknown,
  filter?: { url?: string; limit?: number; since?: number }
): ExceptionInfo[] {
  const coreCtx = asLogsCoreContext(ctx);
  let exceptions = coreCtx.exceptions;

  if (filter?.url) {
    exceptions = exceptions.filter((ex) => ex.url?.includes(filter.url!));
  }

  const since = filter?.since;
  if (since !== undefined) {
    exceptions = exceptions.filter((ex) => ex.timestamp >= since);
  }

  if (filter?.limit) {
    exceptions = exceptions.slice(-filter.limit);
  }

  return exceptions;
}

export function clearExceptionsCore(ctx: unknown): void {
  const coreCtx = asLogsCoreContext(ctx);
  coreCtx.exceptions = [];
  logger.info('Exceptions cleared');
}
