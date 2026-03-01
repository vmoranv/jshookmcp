import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { checkAuth, checkOrigin, readBodyWithLimit } from './http/HttpMiddleware.js';
import { logger } from '../utils/logger.js';
import type { MCPServerContext } from './MCPServer.context.js';

export async function startStdioTransport(ctx: MCPServerContext): Promise<void> {
  const transport = new StdioServerTransport();
  await ctx.server.connect(transport);
  logger.success('MCP stdio server started');
}

export async function startHttpTransport(ctx: MCPServerContext): Promise<void> {
  const port = parseInt(process.env.MCP_PORT ?? '3000', 10);
  const host = process.env.MCP_HOST ?? '127.0.0.1';

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  await ctx.server.connect(transport);

  ctx.httpServer = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);

    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found – use POST /mcp');
      return;
    }

    if (!checkOrigin(req, res)) return;
    if (!checkAuth(req, res)) return;

    if (req.method === 'GET' || req.method === 'DELETE') {
      transport.handleRequest(req, res);
      return;
    }

    if (req.method === 'POST') {
      readBodyWithLimit(req, res)
        .then((body) => transport.handleRequest(req, res, body))
        .catch(() => {
          /* already responded by middleware */
        });
      return;
    }

    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
  });

  const httpServer = ctx.httpServer;
  if (!httpServer) {
    throw new Error('HTTP server initialization failed');
  }

  httpServer.on('connection', (socket: Socket) => {
    ctx.httpSockets.add(socket);
    socket.on('close', () => ctx.httpSockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, host, () => {
      logger.success(`MCP Streamable HTTP server listening on http://${host}:${port}/mcp`);
      resolve();
    });
    httpServer.on('error', reject);
  });
}

export async function closeServer(ctx: MCPServerContext): Promise<void> {
  if (ctx.boostTtlTimer) {
    clearTimeout(ctx.boostTtlTimer);
    ctx.boostTtlTimer = null;
  }

  const { DetailedDataManager } = await import('../utils/DetailedDataManager.js');
  DetailedDataManager.getInstance().shutdown();

  if (ctx.httpServer) {
    const httpServer = ctx.httpServer;
    const closePromise = new Promise<void>((resolve) => httpServer.close(() => resolve()));
    const forceTimeout = setTimeout(() => {
      for (const socket of ctx.httpSockets) {
        socket.destroy();
      }
    }, 5_000);
    await closePromise;
    clearTimeout(forceTimeout);
    ctx.httpSockets.clear();
    ctx.httpServer = undefined;
  }

  if (ctx.consoleMonitor) {
    try {
      await ctx.consoleMonitor.disable();
    } catch (error) {
      logger.warn('Console monitor cleanup failed:', error);
    } finally {
      ctx.consoleMonitor = undefined;
    }
  }

  if (ctx.runtimeInspector) {
    try {
      await ctx.runtimeInspector.close();
    } catch (error) {
      logger.warn('Runtime inspector cleanup failed:', error);
    } finally {
      ctx.runtimeInspector = undefined;
    }
  }

  if (ctx.debuggerManager) {
    try {
      await ctx.debuggerManager.close();
    } catch (error) {
      logger.warn('Debugger manager cleanup failed:', error);
    } finally {
      ctx.debuggerManager = undefined;
    }
  }

  if (ctx.scriptManager) {
    try {
      await ctx.scriptManager.close();
    } catch (error) {
      logger.warn('Script manager cleanup failed:', error);
    } finally {
      ctx.scriptManager = undefined;
    }
  }

  if (ctx.collector) {
    await ctx.collector.close();
    ctx.collector = undefined;
  }

  if (ctx.transformHandlers && typeof ctx.transformHandlers.close === 'function') {
    try {
      await ctx.transformHandlers.close();
    } catch (e) {
      logger.warn('Transform pool close failed:', e);
    }
  }

  await ctx.server.close();
  logger.success('MCP server closed');
}
