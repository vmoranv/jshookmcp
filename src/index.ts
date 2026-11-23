#!/usr/bin/env node

import { bootstrapRuntimeEnv } from '@src/config/env-bootstrap';
import { MCPServer } from '@server/MCPServer';
import { getConfig, validateConfig } from '@utils/config';
import { logger } from '@utils/logger';
import { initRegistry } from '@server/registry/index';
import { createServerEventBus } from '@server/EventBus';
import { resolveCliFastPath } from '@utils/cliFastPath';
import { registerServerInstance, unregisterServerInstance } from '@utils/InstanceRegistry';
import {
  cleanupArtifacts,
  getArtifactRetentionConfig,
  startArtifactRetentionScheduler,
} from '@utils/artifactRetention';
import {
  SHUTDOWN_TIMEOUT_MS,
  RUNTIME_ERROR_WINDOW_MS,
  RUNTIME_ERROR_THRESHOLD,
} from '@src/constants';
import { readEnvString } from '@src/config/environment';

bootstrapRuntimeEnv();

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
  'ENOMEM', // out of memory
  'ENOSPC', // no space left on device
  'EMFILE', // too many open files (system)
  'ENFILE', // too many open files (process)
]);

function isFatalError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  // Safely extract code property (Node.js SystemError / ErrnoException)
  const code =
    'code' in error && typeof (error as Record<string, unknown>).code === 'string'
      ? ((error as Record<string, unknown>).code as string)
      : undefined;

  // Node.js internal fatal error codes
  if (code && FATAL_ERROR_CODES.has(code)) return true;

  // OS-level errno codes
  if (code && FATAL_ERRNO_CODES.has(code)) return true;

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

// Instance cleanup is best-effort: `unregisterServerInstance` can be absent
// or non-promise in trimmed/test wiring, so normalize it before chaining.
async function safeUnregister(context: string): Promise<void> {
  try {
    await Promise.resolve(unregisterServerInstance());
  } catch (error) {
    logger.error(`unregister failed during ${context}:`, error);
  }
}

export async function main(): Promise<void> {
  try {
    const cliFastPath = resolveCliFastPath(process.argv.slice(2), import.meta.url);
    if (cliFastPath.handled) {
      if (cliFastPath.output) {
        process.stdout.write(cliFastPath.output);
      }
      process.exit(cliFastPath.exitCode);
      return;
    }

    const config = getConfig();
    const transportMode =
      config.server?.transport ??
      (readEnvString('MCP_TRANSPORT', 'stdio', { trim: true }).toLowerCase() === 'http'
        ? 'http'
        : 'stdio');
    const rawProfile =
      config.mcp?.toolProfile ??
      readEnvString('MCP_TOOL_PROFILE', 'search', { trim: true }).toLowerCase();
    const profile =
      rawProfile === 'workflow' || rawProfile === 'full' || rawProfile === 'search'
        ? rawProfile
        : 'search';
    logger.debug('Configuration loaded:', {
      transport: transportMode,
      host: config.server?.host,
      port: config.server?.port,
      profile,
      authConfigured: Boolean(config.server?.authToken),
      captchaCredentialsConfigured: Boolean(config.captcha?.apiKey),
    });

    const validation = validateConfig(config);
    if (!validation.valid) {
      logger.error('Configuration validation failed:');
      validation.errors.forEach((error) => logger.error(`  - ${error}`));
      process.exit(1);
      return; // prevent further execution conceptually
    }

    const artifactRetention = getArtifactRetentionConfig();
    if (artifactRetention.cleanupOnStart && artifactRetention.enabled) {
      const cleanup = await cleanupArtifacts();
      if (cleanup.removedFiles > 0) {
        logger.info(
          `[artifacts] Startup cleanup removed ${cleanup.removedFiles} files (${cleanup.removedBytes} bytes)`,
        );
      }
    }

    logger.info('Creating MCP server instance...');
    logger.info(`[startup] transport=${transportMode} profile=${profile}`);
    await registerServerInstance({ transport: transportMode, profile });
    // Create the single event bus before the registry loads so registry-time
    // `domain:loaded` events publish on the same bus the server later exposes.
    const eventBus = createServerEventBus();
    await initRegistry(profile, eventBus);
    const server = new MCPServer(config, { eventBus });
    const stopArtifactRetentionScheduler = startArtifactRetentionScheduler();
    const recoveryWindowMs = Math.max(1000, RUNTIME_ERROR_WINDOW_MS);
    const maxRecoverableErrors = Math.max(1, RUNTIME_ERROR_THRESHOLD);
    const runtimeRecovery: RuntimeRecoveryState = {
      windowStart: Date.now(),
      errorCount: 0,
      degradedMode: false,
    };

    const handleRuntimeFailure = (
      kind: 'uncaughtException' | 'unhandledRejection',
      reason: unknown,
    ) => {
      // Fatal errors must exit immediately — no recovery possible. Still clear
      // the instance registry so the next start / health probe is not misled.
      if (isFatalError(reason)) {
        logger.error(
          `[${kind}] FATAL unrecoverable error — forcing exit: ${formatUnknownError(reason)}`,
        );
        void safeUnregister('fatal exit').finally(() => process.exit(1));
        return;
      }

      const now = Date.now();
      if (now - runtimeRecovery.windowStart > recoveryWindowMs) {
        runtimeRecovery.windowStart = now;
        runtimeRecovery.errorCount = 0;
      }

      runtimeRecovery.errorCount += 1;

      logger.error(
        `[${kind}] Runtime failure captured (${runtimeRecovery.errorCount}/${maxRecoverableErrors}): ` +
          `${formatUnknownError(reason)}`,
      );

      if (!runtimeRecovery.degradedMode && runtimeRecovery.errorCount >= maxRecoverableErrors) {
        runtimeRecovery.degradedMode = true;
        server.enterDegradedMode(
          `Runtime failures reached ${runtimeRecovery.errorCount} within ${recoveryWindowMs}ms`,
        );
        logger.warn('Degraded mode enabled. Server keeps running without forced process exit.');
      }
    };

    // Single-shot graceful teardown. Overlapping signals (or a signal plus
    // stdin EOF) must not race each other into duplicate cleanup/exit.
    let shuttingDown = false;
    const shutdown = async (reason: string, exitCode = 0): Promise<void> => {
      if (shuttingDown) {
        logger.warn(`Shutdown already in progress, ignoring ${reason}`);
        return;
      }
      shuttingDown = true;
      logger.info(`Received ${reason}, shutting down...`);
      const forceExitTimer = setTimeout(() => {
        logger.error('Graceful shutdown timed out, forcing exit');
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);
      // Unref so this timer alone doesn't keep the event loop alive
      forceExitTimer.unref();
      try {
        stopArtifactRetentionScheduler?.();
        await server.close();
      } catch (error) {
        logger.error(`Error during ${reason} shutdown:`, error);
      } finally {
        await safeUnregister('shutdown');
      }
      clearTimeout(forceExitTimer);
      process.exit(exitCode);
    };

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));

    process.on('uncaughtException', (error) => {
      handleRuntimeFailure('uncaughtException', error);
    });

    process.on('unhandledRejection', (reason) => {
      handleRuntimeFailure('unhandledRejection', reason);
    });

    logger.info('Starting MCP server...');
    await server.start();
    logger.info('MCP server started successfully');

    if (transportMode === 'stdio') {
      // Safety net: detect parent disconnect for stdio mode only. HTTP mode may
      // intentionally run detached from a parent stdin stream.
      process.stdin.resume();
      process.stdin.on('end', () => {
        void shutdown('stdin EOF — parent disconnected');
      });
    }

    logger.info('MCP server is running. Press Ctrl+C to stop.');
  } catch (error) {
    await safeUnregister('startup failure');
    logger.error('Failed to start MCP server:');

    if (error instanceof Error) {
      logger.error('Error name:', error.name);
      logger.error('Error message:', error.message);
      logger.error('Error stack:', error.stack);
    }
    logger.error('Full error object:', JSON.stringify(error, null, 2));

    const code = (error as Record<string, unknown>)?.['code'];
    const message = error instanceof Error ? error.message : String(error);

    if (code === 'EADDRINUSE') {
      logger.error('Port is already in use. Please check if another instance is running.');
    }
    if (message?.includes('credentials')) {
      logger.error('Authentication failed. Please check your API keys or credentials.');
    }

    process.exit(1);
  }
}

void main();
