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
