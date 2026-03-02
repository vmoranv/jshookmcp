import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { checkAuth, checkOrigin, checkRateLimit, readBodyWithLimit } from './http/HttpMiddleware.js';
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

    // Health check endpoint — no auth, no rate limit
    if (url.pathname === '/health' && req.method === 'GET') {
      handleHealthCheck(ctx, res);
      return;
    }

    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found – use POST /mcp or GET /health');
      return;
    }

    if (!checkOrigin(req, res)) return;
    if (!checkRateLimit(req, res)) return;
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

/* ---------- Health check ---------- */

import type { ServerResponse as HttpServerResponse } from 'node:http';

function handleHealthCheck(ctx: MCPServerContext, res: HttpServerResponse): void {
  const budgetStats = ctx.tokenBudget.getStats();
  const body = JSON.stringify({
    status: 'ok',
    tier: ctx.currentTier,
    baseTier: ctx.baseTier,
    enabledDomains: [...ctx.enabledDomains],
    registeredTools: ctx.selectedTools.length,
    boostedTools: ctx.boostedToolNames.size,
    activatedTools: ctx.activatedToolNames.size,
    tokenBudget: {
      usagePercentage: budgetStats.usagePercentage,
      currentUsage: budgetStats.currentUsage,
      maxTokens: budgetStats.maxTokens,
    },
    uptime: process.uptime(),
  });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(body);
}

/* ---------- Shutdown ---------- */

export async function closeServer(ctx: MCPServerContext): Promise<void> {
  if (ctx.boostTtlTimer) {
    clearTimeout(ctx.boostTtlTimer);
    ctx.boostTtlTimer = null;
  }

  ctx.detailedData.shutdown();

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

  // Unified disposable cleanup: iterate all closable domain instances.
  // Each entry: [field name for logging, instance ref, close method name].
  const closables: Array<[string, unknown, string]> = [
    ['consoleMonitor', ctx.consoleMonitor, 'disable'],
    ['runtimeInspector', ctx.runtimeInspector, 'close'],
    ['debuggerManager', ctx.debuggerManager, 'close'],
    ['scriptManager', ctx.scriptManager, 'close'],
    ['transformHandlers', ctx.transformHandlers, 'close'],
  ];

  for (const [name, instance, method] of closables) {
    if (!instance) continue;
    try {
      const closeFn = (instance as Record<string, unknown>)[method];
      if (typeof closeFn === 'function') {
        await (closeFn as () => Promise<void>).call(instance);
      }
    } catch (error) {
      logger.warn(`${name} cleanup failed:`, error);
    }
  }
  ctx.consoleMonitor = undefined;
  ctx.runtimeInspector = undefined;
  ctx.debuggerManager = undefined;
  ctx.scriptManager = undefined;

  if (ctx.collector) {
    await ctx.collector.close();
    ctx.collector = undefined;
  }

  await ctx.server.close();
  logger.success('MCP server closed');
}
