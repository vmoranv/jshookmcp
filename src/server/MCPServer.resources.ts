import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { ReverseEvidenceGraph } from '@server/evidence/ReverseEvidenceGraph';
import type { InstrumentationSessionManager } from '@server/instrumentation/InstrumentationSession';

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
          description: `operations=${session.operationCount}, artifacts=${session.artifactCount}, status=${session.status}`,
        })),
      };
    },
    complete: {
      sessionId: async () => {
        const manager = getSessionManager(ctx);
        return (manager?.listSessions() ?? []).map((session) => session.id);
      },
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
}
