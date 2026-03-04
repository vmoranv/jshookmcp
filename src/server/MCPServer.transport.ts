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
    // Auth runs BEFORE rate limit so the verified result can be passed to the
    // rate limiter. This prevents attackers from spoofing Authorization headers
    // to obtain the higher (3x) rate limit without a valid token.
    const authenticated = checkAuth(req, res);
    if (!authenticated) return;
    if (!checkRateLimit(req, res, authenticated)) return;

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

  // Timeout configuration to prevent slow-loris and connection exhaustion
  httpServer.requestTimeout = 30_000;   // 30s to complete a full request
  httpServer.headersTimeout = 10_000;   // 10s to receive all headers
  httpServer.keepAliveTimeout = 60_000; // 60s idle before closing keep-alive

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
  // Minimal output by default to avoid exposing internal state (domains, tool
  // counts, token budget). Full details are gated behind MCP_AUTH_TOKEN or
  // MCP_HEALTH_VERBOSE=true for trusted environments.
  const verbose =
    ['1', 'true'].includes((process.env.MCP_HEALTH_VERBOSE ?? '').toLowerCase());

  const body: Record<string, unknown> = {
    status: 'ok',
    uptime: process.uptime(),
  };

  if (verbose) {
    const budgetStats = ctx.tokenBudget.getStats();
    body.tier = ctx.currentTier;
    body.baseTier = ctx.baseTier;
    body.enabledDomains = [...ctx.enabledDomains];
    body.registeredTools = ctx.selectedTools.length;
    body.boostedTools = ctx.boostedToolNames.size;
    body.activatedTools = ctx.activatedToolNames.size;
    body.tokenBudget = {
      usagePercentage: budgetStats.usagePercentage,
      currentUsage: budgetStats.currentUsage,
      maxTokens: budgetStats.maxTokens,
    };
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
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
