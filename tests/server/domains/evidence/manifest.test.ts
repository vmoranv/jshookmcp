import { describe, expect, it } from 'vitest';
import { EvidenceHandlers } from '@server/domains/evidence/handlers';
import manifest from '@server/domains/evidence/manifest';
import { ReverseEvidenceGraph, _resetIdCounter } from '@server/evidence/ReverseEvidenceGraph';

describe('evidence manifest', () => {
  it('wires a shared evidence graph and bridge through ensure()', () => {
    const domainInstanceMap = new Map<string, unknown>();
    const ctx = {
      evidenceHandlers: undefined,
      setDomainInstance: (key: string, value: unknown) => {
        domainInstanceMap.set(key, value);
      },
      getDomainInstance: (key: string) => domainInstanceMap.get(key),
      domainInstanceMap,
    } as unknown as Parameters<typeof manifest.ensure>[0];

    const handlers = manifest.ensure(ctx);

    expect(handlers).toBeDefined();
    expect(ctx.getDomainInstance('evidenceGraph')).toBeDefined();
    expect(ctx.getDomainInstance('evidenceGraphBridge')).toBeDefined();
  });

  it('returns MCP-compatible tool responses from evidence handlers', () => {
    _resetIdCounter();
    const graph = new ReverseEvidenceGraph();
    const requestNode = graph.addNode('request', 'Login request', {
      url: 'https://example.com/api/login',
    });
    const handlers = new EvidenceHandlers(graph);

    const queryResponse = handlers.handleQueryUrl({ url: '/api/login' });
    expect(queryResponse).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              query: { type: 'url', value: '/api/login' },
              resultCount: 1,
              nodes: [
                {
                  id: requestNode.id,
                  type: requestNode.type,
                  label: requestNode.label,
                  metadata: requestNode.metadata,
                },
              ],
            },
            null,
            2,
          ),
        },
      ],
    });

    const markdownResponse = handlers.handleExportMarkdown();
    const firstContent = markdownResponse.content?.[0];
    expect(firstContent).toMatchObject({ type: 'text' });
    expect((firstContent as { text: string }).text).toContain('# Reverse Evidence Graph Report');
  });
});
