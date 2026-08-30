import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import type { NodeMcpRequestHandler } from '@modelcontextprotocol/node';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import {
  HTTP_CAPACITY_RETRY_AFTER_MS,
  MCP_BROWSER_FLEET_LEASE_TTL_MS,
  MCP_BROWSER_FLEET_MAX_LOCAL_LEASES,
  MCP_HEALTH_VERBOSE,
  MCP_HTTP_FORCE_CLOSE_TIMEOUT_MS,
  MCP_HTTP_HEADERS_TIMEOUT_MS,
  MCP_HTTP_HOST,
  MCP_HTTP_KEEPALIVE_TIMEOUT_MS,
  MCP_HTTP_PORT,
  MCP_HTTP_REQUEST_TIMEOUT_MS,
  STDIO_SEND_TIMEOUT_MS,
} from '@src/constants';
import {
  checkAuth,
  checkOrigin,
  checkRateLimit,
  readBodyWithLimit,
} from '@server/http/HttpMiddleware';
import { logger } from '@utils/logger';
import { ProcessRegistry } from '@utils/ProcessRegistry';
import type { MCPServerContext } from '@server/MCPServer.context';
import { MultiplexedStreamableHttpTransport } from '@server/transport/MultiplexedStreamableHttpTransport';
import type { BrowserSessionCoordinator } from '@server/runtime/BrowserSessionCoordinator';
import type { BrowserFleetRouter } from '@server/runtime/BrowserFleetRouter';
import type { SessionScopedResourcePool } from '@server/runtime/SessionScopedResourcePool';
import type { ConsoleMonitor } from '@modules/monitor/ConsoleMonitor';

export async function startStdioTransport(ctx: MCPServerContext): Promise<void> {
  const transport = new StdioServerTransport();

  // ── Guard: prevent transport.send() from hanging forever if stdout is broken ─────
  if (typeof transport.send === 'function') {
    const origSend = transport.send.bind(transport);
    transport.send = (message) => {
      return new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          logger.warn('transport.send() timed out — stdout broken, skipping write');
          resolve();
        }, STDIO_SEND_TIMEOUT_MS);
        origSend(message)
          .then(() => clearTimeout(timeout))
          .catch(() => clearTimeout(timeout))
          .finally(resolve);
      });
    };
  }

  // ── Delegate lifecycle to MCP SDK ──────────────────────────────────────────
  // StdioServerTransport internally handles stdin EOF and gracefully closes
  // the server. We only hook its close event to run our cleanup (no exit).
  // StdioServerTransport exposes `onclose` as a writable callback property (not an
  // EventEmitter with addEventListener), so the unicorn rule does not apply here.
  // eslint-disable-next-line unicorn/prefer-add-event-listener
  transport.onclose = () => {
    if (ctx.shutdownStarted) {
      return;
    }
    logger.info('stdio transport closed — running cleanup...');
    closeServer(ctx).catch((err) => logger.warn('cleanup after transport close failed:', err));
  };

  await ctx.server.connect(transport);

  // ── Zombie-process prevention ─────────────────────────────────────────────
  // StdioServerTransport does NOT listen to stdin 'end' (only 'data'/'error'),
  // so the SDK won't detect parent disconnect. We add it here — after connect()
  // so the handshake has a clean window. If stdin closes before this point,
  // index.ts's stdin handler (registered after server.start()) is the safeguard.
  let shuttingDown = false;
  const handleStdinEnd = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('stdin EOF — parent disconnected, shutting down...');
    closeServer(ctx)
      .catch((err) => logger.warn('stdin EOF cleanup failed:', err))
      .finally(() => process.exit(0));
  };
  process.stdin.on('end', handleStdinEnd);
  process.stdin.on('close', handleStdinEnd);

  logger.success('MCP stdio server started');
}

export async function startHttpTransport(ctx: MCPServerContext): Promise<void> {
  const serverConfig = ctx.config?.server;
  const httpConfig = serverConfig?.http;
  const port = serverConfig?.port ?? MCP_HTTP_PORT;
  const host = serverConfig?.host ?? MCP_HTTP_HOST;
  const authConfig = serverConfig
    ? {
        authToken: serverConfig.authToken,
        host: serverConfig.host,
        allowInsecure: serverConfig.allowInsecure,
      }
    : undefined;
  const rateLimitConfig = httpConfig
    ? {
        enabled: httpConfig.rateLimitEnabled,
        trustProxy: httpConfig.trustProxy,
        windowMs: httpConfig.rateLimitWindowMs,
        maxRequests: httpConfig.rateLimitMax,
      }
    : undefined;
  const getDomainInstance =
    typeof ctx.getDomainInstance === 'function' ? ctx.getDomainInstance.bind(ctx) : null;

  const transport = new MultiplexedStreamableHttpTransport({
    maxSessions: ctx.config?.mcp?.browserFleetMaxLocalLeases ?? MCP_BROWSER_FLEET_MAX_LOCAL_LEASES,
    maxInFlight: httpConfig?.maxInFlight,
    maxSseInFlight: httpConfig?.maxSseInFlight,
    capacityRetryAfterMs: HTTP_CAPACITY_RETRY_AFTER_MS,
    sessionIdleTtlMs: ctx.config?.mcp?.browserFleetLeaseTtlMs ?? MCP_BROWSER_FLEET_LEASE_TTL_MS,
    onSessionOpened: async (sessionId) => {
      const fleetRouter = getDomainInstance?.<BrowserFleetRouter>('browserFleetRouter');
      if (fleetRouter && typeof fleetRouter.claimLocalSession === 'function') {
        await fleetRouter.claimLocalSession(sessionId);
      }
    },
    onSessionClosed: (sessionId) => {
      const fleetRouter = getDomainInstance?.<BrowserFleetRouter>('browserFleetRouter');
      const releaseFleetLease =
        fleetRouter && typeof fleetRouter.releaseLocalSession === 'function'
          ? fleetRouter.releaseLocalSession(sessionId)
          : null;
      void releaseFleetLease?.catch((error: unknown) => {
        logger.warn(
          `[http] browser fleet lease cleanup failed for ${sessionId}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      });
      getDomainInstance?.<BrowserSessionCoordinator>('browserSessionCoordinator')?.dropSession(
        sessionId,
      );
      ctx.browserHandlers?.dropSessionState(sessionId);
      ctx.workflowHandlers?.dropSessionState(sessionId);
      ctx.v8InspectorHandlers?.dropSessionState(sessionId);
      ctx.graphqlHandlers?.dropSessionState(sessionId);
      ctx.collector?.dropSessionState(sessionId);
      void ctx.proxyHandlers?.dropSessionState(sessionId).catch((error: unknown) => {
        logger.warn(
          `[http] proxy lease cleanup failed for ${sessionId}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      });
      const poolKeys = [
        'sessionConsoleMonitorPool',
        'sessionScriptManagerPool',
        'sessionDebuggerManagerPool',
        'sessionRuntimeInspectorPool',
        'sessionTraceRecorderPool',
        'sessionAdvancedHandlersPool',
        'sessionStreamingHandlersPool',
        'sessionWorkflowHandlersPool',
        'sessionAiHookHandlersPool',
        'sessionHookPresetHandlersPool',
      ] as const;
      void Promise.allSettled(
        poolKeys.map(async (key) => {
          const pool = getDomainInstance?.<SessionScopedResourcePool<object>>(key);
          await pool?.dropSession(sessionId);
        }),
      ).then((results) => {
        for (let index = 0; index < results.length; index++) {
          const result = results[index];
          if (result?.status === 'rejected') {
            logger.warn(
              `[http] ${poolKeys[index]} cleanup failed for ${sessionId}: ` +
                `${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
            );
          }
        }
      });
    },
  });
  if (typeof ctx.setDomainInstance === 'function') {
    ctx.setDomainInstance('httpMultiplexTransport', transport);
  }

  await ctx.server.connect(transport);

  // MCP 2.0 modern leg. The factory creates a fresh SDK server for every
  // request while delegating execution to the shared runtime context. Keeping
  // this on /mcp/v2 makes the migration opt-in and leaves existing /mcp
  // sessionful clients untouched.
  let modernHandlerPromise:
    | Promise<{ node: NodeMcpRequestHandler; mcp: { close: () => Promise<void> } }>
    | undefined;

  ctx.httpServer = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);

    // Health check endpoint — no auth, no rate limit
    if (url.pathname === '/health' && req.method === 'GET') {
      handleHealthCheck(ctx, res);
      return;
    }

    if (url.pathname === '/mcp/v2') {
      if (!checkOrigin(req, res, authConfig)) return;
      const authenticated = checkAuth(req, res, authConfig);
      if (!authenticated) return;
      if (!checkRateLimit(req, res, authenticated, rateLimitConfig)) return;
      const dispatch = (parsedBody?: unknown) => {
        modernHandlerPromise ??= (async () => {
          const [{ createMcpHandler }, { toNodeHandler }, { createModernMcpServer }] =
            await Promise.all([
              import('@modelcontextprotocol/server'),
              import('@modelcontextprotocol/node'),
              import('@server/MCPServer.modern'),
            ]);
          const mcp = createMcpHandler(
            (requestContext) => createModernMcpServer(ctx, requestContext),
            {
              legacy: 'reject',
              onerror: (error) => logger.warn('[http/v2] MCP handler error:', error),
            },
          );
          ctx.setDomainInstance?.('modernHttpHandler', mcp);
          return { node: toNodeHandler(mcp), mcp };
        })();
        void modernHandlerPromise
          .then(({ node }) => node(req, res, parsedBody))
          .catch((error) => {
            modernHandlerPromise = undefined;
            logger.warn('[http/v2] failed to initialize MCP handler:', error);
          });
      };

      // Parse every POST through the bounded streaming reader. This enforces
      // maxBodyBytes for chunked requests as well as requests with a declared
      // Content-Length; the parsed JSON is passed to toNodeHandler so the
      // adapter does not need to consume the request stream a second time.
      if (req.method === 'POST') {
        const bodyPromise =
          httpConfig?.maxBodyBytes === undefined
            ? readBodyWithLimit(req, res)
            : readBodyWithLimit(req, res, httpConfig.maxBodyBytes);
        bodyPromise.then(dispatch).catch(() => undefined);
      } else {
        dispatch();
      }
      return;
    }

    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found – use POST /mcp or GET /health');
      return;
    }

    if (!checkOrigin(req, res, authConfig)) return;
    // Auth runs BEFORE rate limit so the verified result can be passed to the
    // rate limiter. This prevents attackers from spoofing Authorization headers
    // to obtain the higher (3x) rate limit without a valid token.
    const authenticated = checkAuth(req, res, authConfig);
    if (!authenticated) return;
    if (!checkRateLimit(req, res, authenticated, rateLimitConfig)) return;

    if (req.method === 'GET' || req.method === 'DELETE') {
      void transport.handleRequest(req, res);
      return;
    }

    if (req.method === 'POST') {
      const bodyPromise =
        httpConfig?.maxBodyBytes === undefined
          ? readBodyWithLimit(req, res)
          : readBodyWithLimit(req, res, httpConfig.maxBodyBytes);
      bodyPromise
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
  httpServer.requestTimeout = httpConfig?.requestTimeoutMs ?? MCP_HTTP_REQUEST_TIMEOUT_MS;
  httpServer.headersTimeout = httpConfig?.headersTimeoutMs ?? MCP_HTTP_HEADERS_TIMEOUT_MS;
  httpServer.keepAliveTimeout = httpConfig?.keepAliveTimeoutMs ?? MCP_HTTP_KEEPALIVE_TIMEOUT_MS;

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

// ── Health check ──

import type { ServerResponse as HttpServerResponse } from 'node:http';

function handleHealthCheck(ctx: MCPServerContext, res: HttpServerResponse): void {
  // Minimal output by default to avoid exposing internal state (domains, tool
  // counts, token budget). Full details are gated behind MCP_AUTH_TOKEN or
  // MCP_HEALTH_VERBOSE=true for trusted environments.
  const verbose = ctx.config?.server?.healthVerbose ?? MCP_HEALTH_VERBOSE;

  const body: Record<string, unknown> = {
    status: 'ok',
    uptime: process.uptime(),
  };

  if (verbose) {
    const budgetStats = ctx.tokenBudget.getStats();
    body.tier = ctx.baseTier;
    body.baseTier = ctx.baseTier;
    body.enabledDomains = [...ctx.enabledDomains];
    body.registeredTools = ctx.selectedTools.length;
    body.activatedTools = ctx.activatedToolNames.size;
    body.tokenBudget = {
      usagePercentage: budgetStats.usagePercentage,
      currentUsage: budgetStats.currentUsage,
      maxTokens: budgetStats.maxTokens,
    };
    const getDomainInstance =
      typeof ctx.getDomainInstance === 'function' ? ctx.getDomainInstance.bind(ctx) : null;
    const scheduler = getDomainInstance?.<BrowserSessionCoordinator>('browserSessionCoordinator');
    const fleet = getDomainInstance?.<BrowserFleetRouter>('browserFleetRouter');
    const httpTransport =
      getDomainInstance?.<MultiplexedStreamableHttpTransport>('httpMultiplexTransport');
    if (
      typeof scheduler?.getQueueStats === 'function' ||
      typeof fleet?.getStats === 'function' ||
      typeof httpTransport?.getStats === 'function'
    ) {
      body.browserRuntime = {
        scheduler:
          typeof scheduler?.getQueueStats === 'function' ? scheduler.getQueueStats() : null,
        fleet: typeof fleet?.getStats === 'function' ? fleet.getStats() : null,
        httpSessions:
          typeof httpTransport?.getStats === 'function' ? httpTransport.getStats() : null,
      };
    }
    // r1-1: event-loop lag (p50/p90/p99 + sample count), only present when a
    // sampler is wired (start() has run). Non-verbose responses stay minimal.
    const loopLag = ctx.loopLagSampler?.getSummary();
    if (loopLag) {
      body.loopLag = loopLag;
    }
    // r1-2: top-N slow tools by p99 (lazy ring-buffer histograms), only present
    // when a tracker is wired (start() has run). Non-verbose stays minimal.
    const toolLatency = ctx.toolLatencyTracker?.getSummary();
    if (toolLatency) {
      body.toolLatency = toolLatency;
    }
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// ── Shutdown ──

export async function closeServer(ctx: MCPServerContext): Promise<void> {
  if (ctx.shutdownStarted) {
    return ctx.shutdownPromise ?? Promise.resolve();
  }

  ctx.shutdownStarted = true;
  ctx.shutdownPromise = (async () => {
    // Release the artifact retention sweep wired in MCPServer.start() — every
    // shutdown path funnels through closeServer, so the unref'd timer is
    // stopped here exactly once (idempotent stop; a later start re-arms it).
    ctx.artifactRetentionStop?.();
    ctx.artifactRetentionStop = null;

    // Stop the event-loop lag sampler (idempotent; a later start() re-arms it).
    ctx.loopLagStop?.();
    ctx.loopLagStop = null;
    ctx.loopLagSampler = null;

    // Stop the per-tool latency tracker (idempotent; a later start() re-arms it).
    ctx.toolLatencyStop?.();
    ctx.toolLatencyStop = null;
    ctx.toolLatencyTracker?.dispose();
    ctx.toolLatencyTracker = null;

    // Flush snapshots before any other cleanup
    const getInst =
      typeof ctx.getDomainInstance === 'function' ? ctx.getDomainInstance.bind(ctx) : null;
    const modernHttpHandler = getInst?.<{ close: () => Promise<void> }>('modernHttpHandler');
    if (modernHttpHandler) {
      try {
        await modernHttpHandler.close();
      } catch (error) {
        logger.warn('MCP 2.0 HTTP handler close failed:', error);
      }
    }
    if (getInst) {
      const scheduler =
        getInst<import('@server/persistence/RuntimeSnapshotScheduler').RuntimeSnapshotScheduler>(
          'snapshotScheduler',
        );
      if (scheduler) {
        try {
          await scheduler.flushAll();
          scheduler.dispose();
        } catch (error) {
          logger.warn('snapshot flush on shutdown failed:', error);
        }
      }
    }

    // Clear all domain TTL timers
    for (const [, entry] of ctx.domainTtlEntries) {
      clearTimeout(entry.timer);
    }
    ctx.domainTtlEntries.clear();

    ctx.detailedData.shutdown();

    const activationController = getInst
      ? getInst<{ dispose?: () => void }>('activationController')
      : ((ctx as MCPServerContext & { activationController?: { dispose?: () => void } })
          .activationController ?? undefined);
    if (activationController && typeof activationController.dispose === 'function') {
      try {
        activationController.dispose();
      } catch (error) {
        logger.warn('activationController cleanup failed:', error);
      }
    }

    if (ctx.httpServer) {
      const httpServer = ctx.httpServer;
      const closePromise = new Promise<void>((resolve) => httpServer.close(() => resolve()));
      const forceTimeout = setTimeout(() => {
        for (const socket of ctx.httpSockets) {
          socket.destroy();
        }
      }, ctx.config?.server?.http?.forceCloseTimeoutMs ?? MCP_HTTP_FORCE_CLOSE_TIMEOUT_MS);
      await closePromise;
      clearTimeout(forceTimeout);
      ctx.httpSockets.clear();
      ctx.httpServer = undefined;
    }

    // Drain background tasks: cancel working operations (running their cancel
    // handlers) so shutdown does not abandon in-flight work or leave orphaned
    // child processes behind. Optional-chained because closeServer must
    // tolerate partial contexts (tests, degraded mode). Deliberately placed
    // AFTER the httpServer force-close timer registration so the synchronous
    // lead-in of closeServer is unchanged (fake-timer tests rely on it).
    await ctx.taskManager?.shutdown();

    // Unified disposable cleanup: iterate all closable domain instances.
    // Each entry: [field name for logging, instance ref, close method name].
    const monitorPool = getInst?.<SessionScopedResourcePool<ConsoleMonitor>>(
      'sessionConsoleMonitorPool',
    );
    const scriptManagerPool = getInst?.<SessionScopedResourcePool<object>>(
      'sessionScriptManagerPool',
    );
    const debuggerManagerPool = getInst?.<SessionScopedResourcePool<object>>(
      'sessionDebuggerManagerPool',
    );
    const runtimeInspectorPool = getInst?.<SessionScopedResourcePool<object>>(
      'sessionRuntimeInspectorPool',
    );
    const closables: Array<[string, unknown, string]> = [
      [
        monitorPool ? 'sessionConsoleMonitorPool' : 'consoleMonitor',
        monitorPool ?? ctx.consoleMonitor,
        monitorPool ? 'close' : 'disable',
      ],
      [
        runtimeInspectorPool ? 'sessionRuntimeInspectorPool' : 'runtimeInspector',
        runtimeInspectorPool ?? ctx.runtimeInspector,
        'close',
      ],
      [
        debuggerManagerPool ? 'sessionDebuggerManagerPool' : 'debuggerManager',
        debuggerManagerPool ?? ctx.debuggerManager,
        'close',
      ],
      [
        scriptManagerPool ? 'sessionScriptManagerPool' : 'scriptManager',
        scriptManagerPool ?? ctx.scriptManager,
        'close',
      ],
      ['sessionTraceRecorderPool', getInst?.('sessionTraceRecorderPool'), 'close'],
      ['sessionAdvancedHandlersPool', getInst?.('sessionAdvancedHandlersPool'), 'close'],
      ['sessionStreamingHandlersPool', getInst?.('sessionStreamingHandlersPool'), 'close'],
      ['sessionWorkflowHandlersPool', getInst?.('sessionWorkflowHandlersPool'), 'close'],
      ['sessionAiHookHandlersPool', getInst?.('sessionAiHookHandlersPool'), 'close'],
      ['sessionHookPresetHandlersPool', getInst?.('sessionHookPresetHandlersPool'), 'close'],
      ['transformHandlers', ctx.transformHandlers, 'close'],
      ['proxyHandlers', ctx.proxyHandlers, 'close'],
      // Lazy domain — undefined when never activated (or in a partial context),
      // skipped by the guard below.
      ['nativeEmulatorHandlers', getInst?.('nativeEmulatorHandlers'), 'dispose'],
      // Stops the browser session sweep timer (idempotent). Wired here so
      // embedded/multi-instance deployments don't leak an interval on shutdown.
      ['browserSessionCoordinator', getInst?.('browserSessionCoordinator'), 'dispose'],
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
      try {
        await ctx.collector.close();
      } catch (error) {
        logger.warn('collector cleanup failed:', error);
      }
      ctx.collector = undefined;
    }

    // Release the lazily-created deobfuscation / heap-parse worker pools
    // (best-effort, fire-and-forget). Each pool module keeps a shared
    // singleton whose min-1 warm worker is never idle-evicted at the
    // `minWorkers` floor; `dispose*()` closes it and resets the singleton.
    // Not awaited: the workers are unref'd and ProcessRegistry.terminateAll()
    // below already guarantees termination, so this must not delay shutdown.
    void Promise.allSettled([
      import('@modules/deobfuscator/webcrack-worker').then((m) => m.disposeWebcrackPool()),
      import('@modules/deobfuscator/jscrambler-worker').then((m) => m.disposeJscramblerPool()),
      import('@modules/deobfuscator/decode-string-array-worker').then((m) =>
        m.disposeDecodeStringArrayPool(),
      ),
      import('@server/domains/v8-inspector/handlers/heap-parse-worker').then((m) =>
        m.disposeHeapParsePool(),
      ),
    ]);

    try {
      await ctx.server.close();
    } catch (error) {
      logger.warn('MCP server close failed:', error);
    }

    try {
      await ProcessRegistry.terminateAll();
    } catch (error) {
      logger.warn('ProcessRegistry cleanup failed:', error);
    }

    logger.success('MCP server closed');
  })();

  return ctx.shutdownPromise;
}
