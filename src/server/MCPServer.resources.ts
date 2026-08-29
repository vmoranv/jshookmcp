import { ResourceTemplate } from '@modelcontextprotocol/server';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { ReverseEvidenceGraph } from '@server/evidence/ReverseEvidenceGraph';
import type { InstrumentationSessionManager } from '@server/instrumentation/InstrumentationSession';
import type { TabRegistry } from '@modules/browser/TabRegistry';
import { getAllRegistrations, getAllKnownDomains } from '@server/registry/index';
import { getSearchEngine } from '@server/MCPServer.search.helpers';
import { getRuntimeState } from '@server/runtime/ServerRuntimeState';
import { getEmbeddingDimensionHint } from '@server/search/EmbeddingModels';
import { SEARCH_VECTOR_MODEL_ID } from '@src/constants/search';

function asJsonResource(uri: string, payload: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function asTextResource(uri: string, text: string, mimeType: string) {
  return {
    contents: [
      {
        uri,
        mimeType,
        text,
      },
    ],
  };
}

function getEvidenceGraph(ctx: MCPServerContext): ReverseEvidenceGraph | undefined {
  return ctx.getDomainInstance<ReverseEvidenceGraph>('evidenceGraph');
}

function getSessionManager(ctx: MCPServerContext): InstrumentationSessionManager | undefined {
  return ctx.getDomainInstance<InstrumentationSessionManager>('instrumentationSessionManager');
}

export function registerServerResources(ctx: MCPServerContext): void {
  ctx.server.registerResource(
    'evidence_graph_json',
    'jshook://evidence/graph',
    {
      title: 'Evidence Graph JSON',
      description: 'Serializable snapshot of the current reverse evidence graph.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const graph = getEvidenceGraph(ctx);
      return asJsonResource(
        uri.toString(),
        graph
          ? graph.exportJson()
          : { version: 1, nodes: [], edges: [], exportedAt: new Date().toISOString() },
      );
    },
  );

  ctx.server.registerResource(
    'evidence_graph_markdown',
    'jshook://evidence/graph.md',
    {
      title: 'Evidence Graph Markdown',
      description: 'Markdown report for the current reverse evidence graph.',
      mimeType: 'text/markdown',
    },
    async (uri) => {
      const graph = getEvidenceGraph(ctx);
      return asTextResource(
        uri.toString(),
        graph
          ? graph.exportMarkdown()
          : '# Reverse Evidence Graph Report\n\nNo evidence graph is available.\n',
        'text/markdown',
      );
    },
  );

  ctx.server.registerResource(
    'instrumentation_sessions',
    'jshook://instrumentation/sessions',
    {
      title: 'Instrumentation Sessions',
      description: 'Expanded snapshots for all active instrumentation sessions.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const manager = getSessionManager(ctx);
      return asJsonResource(uri.toString(), manager ? manager.listSessionSnapshots() : []);
    },
  );

  const sessionTemplate = new ResourceTemplate('jshook://instrumentation/session/{sessionId}', {
    list: async () => {
      const manager = getSessionManager(ctx);
      return {
        resources: (manager?.listSessions() ?? []).map((session) => ({
          name: session.name || `Instrumentation Session ${session.id}`,
          uri: `jshook://instrumentation/session/${session.id}`,
          mimeType: 'application/json',
          description:
            `operations=${session.operationCount}, artifacts=${session.artifactCount}, status=` +
            `${session.status}`,
        })),
      };
    },
  });

  ctx.server.registerResource(
    'instrumentation_session_snapshot',
    sessionTemplate,
    {
      title: 'Instrumentation Session Snapshot',
      description: 'Expanded snapshot for a single instrumentation session.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const sessionId = String(variables['sessionId'] ?? '');
      const manager = getSessionManager(ctx);
      const snapshot = manager?.getSessionSnapshot(sessionId);
      return asJsonResource(
        uri.toString(),
        snapshot ?? {
          success: false,
          error: `Instrumentation session "${sessionId}" not found`,
        },
      );
    },
  );

  // ── Search engine status ──

  ctx.server.registerResource(
    'search_engine_status',
    'jshook://search/status',
    {
      title: 'Search Engine Status',
      description: 'Current status of the multi-signal tool search engine.',
      mimeType: 'application/json',
    },
    async (uri) => {
      let totalTools = ctx.extensionToolsByName.size;
      try {
        totalTools += getAllRegistrations().length;
      } catch {
        // registry not yet initialised
      }
      let indexedTools = 0;
      let embeddingDimension = 0;
      let bm25Available = false;
      let trigramAvailable = false;
      let embeddingAvailable = false;
      let lastIndexedAt: string | null = null;

      try {
        const engine = await getSearchEngine(ctx);
        const summary = engine.getDomainSummary();
        indexedTools = summary.reduce((acc, s) => acc + s.count, 0);
        bm25Available = true;
        trigramAvailable = true;
        embeddingAvailable = ctx.config.search.vectorEnabled ?? false;
        if (embeddingAvailable) {
          embeddingDimension = getEmbeddingDimensionHint(
            ctx.config.search.vectorModelId ?? SEARCH_VECTOR_MODEL_ID,
          );
        }
        lastIndexedAt = new Date().toISOString();
      } catch {
        // search engine not yet built — leave defaults
      }

      return asJsonResource(uri.toString(), {
        totalTools,
        indexedTools,
        embeddingDimension,
        lastIndexedAt,
        bm25Available,
        trigramAvailable,
        embeddingAvailable,
      });
    },
  );

  // ── Token budget stats ──

  ctx.server.registerResource(
    'token_budget_stats',
    'jshook://token-budget/stats',
    {
      title: 'Token Budget Statistics',
      description:
        'Current token budget usage, top-10 tool distribution, and optimization suggestions.',
      mimeType: 'application/json',
    },
    async (uri) => {
      return asJsonResource(uri.toString(), ctx.tokenBudget.getStats());
    },
  );

  // ── Activation state ──

  ctx.server.registerResource(
    'activation_state',
    'jshook://activation/state',
    {
      title: 'Activation State',
      description:
        'Currently activated tools, per-domain TTL remaining, and auto-pruner predictions.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const activatedTools = [...ctx.activatedToolNames];
      const domainTtls: Array<{
        domain: string;
        ttlMs: number;
        toolCount: number;
        toolNames: string[];
      }> = [];
      for (const [domain, entry] of ctx.domainTtlEntries) {
        domainTtls.push({
          domain,
          ttlMs: entry.ttlMs,
          toolCount: entry.toolNames.size,
          toolNames: [...entry.toolNames],
        });
      }
      const enabledDomains = [...ctx.enabledDomains];
      return asJsonResource(uri.toString(), {
        baseTier: ctx.baseTier,
        enabledDomains,
        activatedTools,
        activatedToolCount: activatedTools.length,
        domainTtls,
        clientSupportsListChanged: ctx.clientSupportsListChanged,
      });
    },
  );

  ctx.server.registerResource(
    'tool_coverage',
    'jshook://tools/coverage',
    {
      title: 'Tool Coverage',
      description: 'Called vs uncalled tools in the current runtime, with last-call metadata.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const runtimeState = getRuntimeState(ctx);
      const summary = runtimeState?.getCoverageSummary(ctx) ?? {
        called: {},
        calledCount: 0,
        uncataloguedCalls: [],
        uncataloguedCallCount: 0,
        totalKnownTools: 0,
        uncalled: [],
        uncalledCount: 0,
      };
      return asJsonResource(uri.toString(), summary);
    },
  );

  // ── Cache statistics ──

  ctx.server.registerResource(
    'cache_stats',
    'jshook://cache/stats',
    {
      title: 'Cache Statistics',
      description: 'Global cache entry count, total size, and per-cache-instance hit rates.',
      mimeType: 'application/json',
    },
    async (uri) => {
      return asJsonResource(uri.toString(), await ctx.unifiedCache.getGlobalStats());
    },
  );

  // ── Browser tabs ──

  ctx.server.registerResource(
    'browser_tabs',
    'jshook://browser/tabs',
    {
      title: 'Browser Tabs',
      description: 'List of currently open browser tabs with URL, title, and tabIndex.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const browserHandlers = ctx.getDomainInstance<{
        getTabRegistry?: () => TabRegistry;
      }>('browserHandlers');
      const registry = browserHandlers?.getTabRegistry?.();
      if (!registry) {
        return asJsonResource(uri.toString(), {
          tabs: [],
          currentTabId: null,
          message: 'Browser domain not initialized',
        });
      }
      const tabs = registry.listTabs().map((tab) => ({
        pageId: tab.pageId,
        index: tab.index,
        url: tab.url,
        title: tab.title,
        aliases: tab.aliases,
      }));
      const currentMeta = registry.getContextMeta();
      return asJsonResource(uri.toString(), {
        tabs,
        currentTabId: currentMeta.pageId,
        totalTabs: tabs.length,
      });
    },
  );

  // ── Dynamic resource template: domain status ──

  const domainTemplate = new ResourceTemplate('jshook://domains/{domainName}', {
    list: async () => {
      const toolCounts = new Map<string, number>();
      try {
        const registrations = getAllRegistrations();
        for (const reg of registrations) {
          const domain = reg.domain ?? 'unknown';
          toolCounts.set(domain, (toolCounts.get(domain) ?? 0) + 1);
        }
      } catch {
        // registry not yet initialised
      }
      for (const record of ctx.extensionToolsByName.values()) {
        toolCounts.set(record.domain, (toolCounts.get(record.domain) ?? 0) + 1);
      }
      let allDomainNames: ReadonlySet<string>;
      try {
        allDomainNames = getAllKnownDomains();
      } catch {
        allDomainNames = new Set(toolCounts.keys());
      }
      return {
        resources: [...allDomainNames].map((domain) => ({
          name: `Domain: ${domain}`,
          uri: `jshook://domains/${domain}`,
          mimeType: 'application/json',
          description: `${toolCounts.get(domain) ?? 0} tools`,
        })),
      };
    },
  });

  ctx.server.registerResource(
    'domain_status_template',
    domainTemplate,
    {
      title: 'Domain Status',
      description: 'Per-domain tool listing and activation state.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const domainName = String(variables['domainName'] ?? '');
      let domainTools: string[] = [];
      try {
        const registrations = getAllRegistrations();
        domainTools = registrations
          .filter((r) => (r.domain ?? 'unknown') === domainName)
          .map((r) => r.tool.name);
      } catch {
        // registry not yet initialised
      }
      const extensionTools: string[] = [];
      for (const record of ctx.extensionToolsByName.values()) {
        if (record.domain === domainName) {
          extensionTools.push(record.name);
        }
      }
      const allTools = [...domainTools, ...extensionTools];
      const activatedInDomain = allTools.filter((name) => ctx.activatedToolNames.has(name));
      const ttlEntry = ctx.domainTtlEntries.get(domainName);
      const isEnabled = ctx.enabledDomains.has(domainName);

      return asJsonResource(uri.toString(), {
        domain: domainName,
        totalTools: allTools.length,
        tools: allTools,
        enabled: isEnabled,
        activatedTools: activatedInDomain,
        activatedCount: activatedInDomain.length,
        ttl: ttlEntry ? { ttlMs: ttlEntry.ttlMs, toolCount: ttlEntry.toolNames.size } : null,
      });
    },
  );

  // Log file resource (only when file logging is enabled)
  const logFilePath = ctx.mcpLog?.getFilePath?.();
  if (logFilePath) {
    ctx.server.registerResource(
      'mcp_log_file',
      'jshook://logs/file',
      {
        title: 'MCP Log File Path',
        description: 'Path to the current MCP log file.',
        mimeType: 'text/plain',
      },
      async (uri) => ({
        contents: [{ uri: uri.toString(), mimeType: 'text/plain', text: logFilePath }],
      }),
    );
  }
}
