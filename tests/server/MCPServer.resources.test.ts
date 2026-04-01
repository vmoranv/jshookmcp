import { describe, expect, it, vi } from 'vitest';

import { registerServerResources } from '@server/MCPServer.resources';

type ResourceHandler = (
  uri: URL,
  variables?: Record<string, unknown>,
) => Promise<{
  contents: Array<{ uri: string; mimeType: string; text: string }>;
}>;

describe('MCPServer.resources', () => {
  function createContext(overrides: Record<string, unknown> = {}) {
    const handlers = new Map<string, ResourceHandler>();

    const ctx = {
      server: {
        registerResource: vi.fn(
          (name: string, _template: unknown, _meta: unknown, handler: ResourceHandler) => {
            handlers.set(name, handler);
          },
        ),
      },
      getDomainInstance: vi.fn((key: string) => {
        if (key === 'evidenceGraph') {
          return overrides.evidenceGraph;
        }
        if (key === 'instrumentationSessionManager') {
          return overrides.instrumentationSessionManager;
        }
        return undefined;
      }),
    };

    return { ctx, handlers };
  }

  it('registers resources and serves fallback payloads when no instances exist', async () => {
    const { ctx, handlers } = createContext();

    registerServerResources(ctx as never);

    expect(ctx.server.registerResource).toHaveBeenCalledTimes(4);
    await expect(
      handlers.get('evidence_graph_json')!(new URL('jshook://evidence/graph')),
    ).resolves.toEqual({
      contents: [
        expect.objectContaining({
          uri: 'jshook://evidence/graph',
          mimeType: 'application/json',
        }),
      ],
    });

    const markdown = await handlers.get('evidence_graph_markdown')!(
      new URL('jshook://evidence/graph.md'),
    );
    expect(markdown.contents[0]?.text).toContain('No evidence graph is available');

    const sessions = await handlers.get('instrumentation_sessions')!(
      new URL('jshook://instrumentation/sessions'),
    );
    expect(sessions.contents[0]?.text).toBe('[]');

    const missingSnapshot = await handlers.get('instrumentation_session_snapshot')!(
      new URL('jshook://instrumentation/session/abc'),
      { sessionId: 'abc' },
    );
    expect(missingSnapshot.contents[0]?.text).toContain('not found');
  });

  it('uses live graph and session manager data when instances are available', async () => {
    const evidenceGraph = {
      exportJson: vi.fn(() => ({ version: 1, nodes: [{ id: 'n1' }] })),
      exportMarkdown: vi.fn(() => '# Evidence'),
    };
    const manager = {
      listSessionSnapshots: vi.fn(() => [{ id: 's1', status: 'active' }]),
      listSessions: vi.fn(() => [
        { id: 's1', name: 'Main Session', operationCount: 2, artifactCount: 1, status: 'active' },
      ]),
      getSessionSnapshot: vi.fn((id: string) => ({ id, status: 'active' })),
    };
    const { ctx, handlers } = createContext({
      evidenceGraph,
      instrumentationSessionManager: manager,
    });

    registerServerResources(ctx as never);

    const graphJson = await handlers.get('evidence_graph_json')!(
      new URL('jshook://evidence/graph'),
    );
    expect(graphJson.contents[0]?.text).toContain('"n1"');

    const graphMarkdown = await handlers.get('evidence_graph_markdown')!(
      new URL('jshook://evidence/graph.md'),
    );
    expect(graphMarkdown.contents[0]?.text).toBe('# Evidence');

    const sessionList = await handlers.get('instrumentation_sessions')!(
      new URL('jshook://instrumentation/sessions'),
    );
    expect(sessionList.contents[0]?.text).toContain('"s1"');

    const snapshot = await handlers.get('instrumentation_session_snapshot')!(
      new URL('jshook://instrumentation/session/s1'),
      { sessionId: 's1' },
    );
    expect(snapshot.contents[0]?.text).toContain('"active"');
    expect(manager.getSessionSnapshot).toHaveBeenCalledWith('s1');
  });
});
