#!/usr/bin/env node

import { MCPServer } from './server/MCPServer.js';
import { getConfig, validateConfig } from './utils/config.js';
import { logger } from './utils/logger.js';

interface AppError extends Error {
  code?: string;
  message: string;
  name: string;
  stack?: string;
}

interface RuntimeRecoveryState {
  windowStart: number;
  errorCount: number;
  degradedMode: boolean;
}

/** Error codes that indicate unrecoverable system-level failures — process must exit. */
const FATAL_ERROR_CODES: ReadonlySet<string> = new Set([
  'ERR_WORKER_OUT_OF_MEMORY',
  'ERR_MEMORY_ALLOCATION_FAILED',
]);

/** errno codes from OS-level failures that cannot be recovered from. */
const FATAL_ERRNO_CODES: ReadonlySet<string> = new Set([
  'ENOMEM',   // out of memory
  'ENOSPC',   // no space left on device
  'EMFILE',   // too many open files (system)
  'ENFILE',   // too many open files (process)
]);

function isFatalError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const appErr = error as AppError;

  // Node.js internal fatal error codes
  if (appErr.code && FATAL_ERROR_CODES.has(appErr.code)) return true;

  // OS-level errno codes
  if (appErr.code && FATAL_ERRNO_CODES.has(appErr.code)) return true;

  // RangeError from V8 heap exhaustion
  if (error instanceof RangeError && error.message.includes('allocation')) return true;

  return false;
}

function formatUnknownError(input: unknown): string {
  if (input instanceof Error) {
    return `${input.name}: ${input.message}`;
  }

  try {
    return typeof input === 'string' ? input : JSON.stringify(input);
  } catch {
    return String(input);
  }
}

async function main() {
  try {
    const config = getConfig();
    logger.debug('Configuration loaded:', config);

    const validation = validateConfig(config);
    if (!validation.valid) {
      logger.error('Configuration validation failed:');
      validation.errors.forEach((error) => logger.error(`  - ${error}`));
      process.exit(1);
    }

    if (config.llm.provider === 'openai' && !config.llm.openai?.apiKey) {
      logger.warn('OPENAI_API_KEY is not configured. AI-assisted tools may return configuration errors.');
    }
    if (config.llm.provider === 'anthropic' && !config.llm.anthropic?.apiKey) {
      logger.warn('ANTHROPIC_API_KEY is not configured. AI-assisted tools may return configuration errors.');
    }

    logger.info('Creating MCP server instance...');
    const server = new MCPServer(config);
    const recoveryWindowMs = Math.max(
      1000,
      parseInt(process.env.RUNTIME_ERROR_WINDOW_MS ?? '60000', 10)
    );
    const maxRecoverableErrors = Math.max(
      1,
      parseInt(process.env.RUNTIME_ERROR_THRESHOLD ?? '5', 10)
    );
    const runtimeRecovery: RuntimeRecoveryState = {
      windowStart: Date.now(),
      errorCount: 0,
      degradedMode: false,
    };

    const handleRuntimeFailure = (kind: 'uncaughtException' | 'unhandledRejection', reason: unknown) => {
      // Fatal errors must exit immediately — no recovery possible
      if (isFatalError(reason)) {
        logger.error(
          `[${kind}] FATAL unrecoverable error — forcing exit: ${formatUnknownError(reason)}`
        );
        process.exit(1);
      }

      const now = Date.now();
      if (now - runtimeRecovery.windowStart > recoveryWindowMs) {
        runtimeRecovery.windowStart = now;
        runtimeRecovery.errorCount = 0;
      }

      runtimeRecovery.errorCount += 1;

      logger.error(
        `[${kind}] Runtime failure captured (${runtimeRecovery.errorCount}/${maxRecoverableErrors}): ${formatUnknownError(reason)}`
      );

      if (!runtimeRecovery.degradedMode && runtimeRecovery.errorCount >= maxRecoverableErrors) {
        runtimeRecovery.degradedMode = true;
        server.enterDegradedMode(
          `Runtime failures reached ${runtimeRecovery.errorCount} within ${recoveryWindowMs}ms`
        );
        logger.warn('Degraded mode enabled. Server keeps running without forced process exit.');
      }
    };

    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down...');
      await server.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down...');
      await server.close();
      process.exit(0);
    });

    process.on('uncaughtException', (error) => {
      handleRuntimeFailure('uncaughtException', error);
    });

    process.on('unhandledRejection', (reason) => {
      handleRuntimeFailure('unhandledRejection', reason);
    });

    logger.info('Starting MCP server...');
    await server.start();
    logger.info('MCP server started successfully');

    logger.info('MCP server is running. Press Ctrl+C to stop.');
  } catch (error) {
    logger.error('Failed to start MCP server:');

    const appError = error as AppError;

    logger.error('Error name:', appError.name);
    logger.error('Error message:', appError.message);
    logger.error('Error stack:', appError.stack);
    logger.error('Full error object:', JSON.stringify(error, null, 2));

    if (appError.code === 'EADDRINUSE') {
      logger.error('Port is already in use. Please check if another instance is running.');
    }
    if (appError.message?.includes('credentials')) {
      logger.error('Authentication failed. Please check your API keys or credentials.');
    }

    process.exit(1);
  }
}

main();
