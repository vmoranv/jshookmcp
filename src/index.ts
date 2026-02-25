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
      logger.error('Uncaught exception:', error);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled rejection:', reason);
      process.exit(1);
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
