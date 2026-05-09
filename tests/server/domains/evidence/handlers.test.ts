import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EvidenceHandlers } from '@server/domains/evidence/handlers';
import { buildTestUrl } from '@tests/shared/test-urls';

describe('EvidenceHandlers', () => {
  let handlers: EvidenceHandlers;
  let mockGraph: any;

  beforeEach(() => {
    mockGraph = {
      queryByUrl: vi.fn(),
      queryByFunction: vi.fn(),
      queryByScriptId: vi.fn(),
      exportJson: vi.fn(),
      exportMarkdown: vi.fn(),
      getEvidenceChain: vi.fn(),
    };
    handlers = new EvidenceHandlers(mockGraph);
  });

  describe('handleQueryUrl', () => {
    it('should query nodes by url and return JSON', async () => {
      mockGraph.queryByUrl.mockReturnValue([
        {
          id: 'n1',
          type: 'url',
          label: buildTestUrl('test', { scheme: 'http', suffix: 'bare', path: '/' }),
          metadata: {},
        },
      ]);
      const result = handlers.handleQueryUrl({
        url: buildTestUrl('test', { scheme: 'http', suffix: 'bare', path: '/' }),
      }) as any;
      const data = JSON.parse(result.content[0].text);
      expect(data.query.value).toBe(
        buildTestUrl('test', { scheme: 'http', suffix: 'bare', path: '/' }),
      );
      expect(data.nodes[0].id).toBe('n1');
    });
  });

  describe('handleQueryDispatch', () => {
    it('should map by=url value into url queries', async () => {
      mockGraph.queryByUrl.mockReturnValue([
        {
          id: 'n-url',
          type: 'request',
          label: buildTestUrl('example', { suffix: 'test', path: '/' }),
          metadata: {},
        },
      ]);
      const result = handlers.handleQueryDispatch({
        by: 'url',
        value: buildTestUrl('example', { suffix: 'test', path: '/' }),
      }) as any;
      const data = JSON.parse(result.content[0].text);
      expect(mockGraph.queryByUrl).toHaveBeenCalledWith(
        buildTestUrl('example', { suffix: 'test', path: '/' }),
      );
      expect(data.resultCount).toBe(1);
    });

    it('should map by=function value into function queries', async () => {
      mockGraph.queryByFunction.mockReturnValue([
        { id: 'n-fn', type: 'function', label: 'readFileBuffer', metadata: {} },
      ]);
      const result = handlers.handleQueryDispatch({
        by: 'function',
        value: 'readFileBuffer',
      }) as any;
      const data = JSON.parse(result.content[0].text);
      expect(mockGraph.queryByFunction).toHaveBeenCalledWith('readFileBuffer');
      expect(data.resultCount).toBe(1);
    });

    it('should map by=script value into script queries', async () => {
      mockGraph.queryByScriptId.mockReturnValue([
        { id: 'n-script', type: 'script', label: 'bundle.js', metadata: {} },
      ]);
      const result = handlers.handleQueryDispatch({
        by: 'script',
        value: 'script-7',
      }) as any;
      const data = JSON.parse(result.content[0].text);
      expect(mockGraph.queryByScriptId).toHaveBeenCalledWith('script-7');
      expect(data.resultCount).toBe(1);
    });
  });

  describe('handleQueryFunction', () => {
    it('should query nodes by function and return JSON', async () => {
      mockGraph.queryByFunction.mockReturnValue([
        { id: 'n2', type: 'function', label: 'eval', metadata: {} },
      ]);
      const result = handlers.handleQueryFunction({ name: 'eval' }) as any;
      const data = JSON.parse(result.content[0].text);
      expect(data.query.value).toBe('eval');
      expect(data.nodes[0].id).toBe('n2');
    });
  });

  describe('handleQueryScript', () => {
    it('should query nodes by script id and return JSON', async () => {
      mockGraph.queryByScriptId.mockReturnValue([
        { id: 'n3', type: 'script', label: 'bundle.js', metadata: {} },
      ]);
      const result = handlers.handleQueryScript({ scriptId: '123' }) as any;
      const data = JSON.parse(result.content[0].text);
      expect(data.query.value).toBe('123');
      expect(data.nodes[0].id).toBe('n3');
    });
  });

  describe('handleExportJson', () => {
    it('should export graph as JSON', async () => {
      mockGraph.exportJson.mockReturnValue({ nodes: [], edges: [] });
      const result = handlers.handleExportJson() as any;
      const data = JSON.parse(result.content[0].text);
      expect(data).toEqual({ nodes: [], edges: [] });
    });
  });

  describe('handleExportMarkdown', () => {
    it('should export graph as markdown', async () => {
      mockGraph.exportMarkdown.mockReturnValue('# Graph\nData');
      const result = handlers.handleExportMarkdown() as any;
      expect(result.content[0].text).toBe('# Graph\nData');
    });

    it('should append gap detection when graph has data', async () => {
      mockGraph.exportMarkdown.mockReturnValue('# Graph');
      mockGraph.exportJson.mockReturnValue({
        nodes: [
          { id: 'n1', type: 'request', label: 'GET /api', metadata: {} },
          { id: 'n2', type: 'script', label: 'app.js', metadata: {} },
        ],
        edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'loads' }],
      });
      const result = handlers.handleExportMarkdown() as any;
      const text = result.content[0].text;
      expect(text).toContain('## Evidence Gaps');
      expect(text).toContain('Dangling nodes (no inbound edges)');
      expect(text).toContain('Dangling nodes (no outbound edges)');
    });

    it('should report no gaps when graph is fully connected', async () => {
      mockGraph.exportMarkdown.mockReturnValue('# Graph');
      mockGraph.exportJson.mockReturnValue({
        nodes: [
          { id: 'n1', type: 'request', label: 'GET /api', metadata: {} },
          { id: 'n2', type: 'script', label: 'app.js', metadata: {} },
        ],
        edges: [
          { id: 'e1', source: 'n1', target: 'n2', type: 'loads' },
          { id: 'e2', source: 'n2', target: 'n1', type: 'references' },
        ],
      });
      const result = handlers.handleExportMarkdown() as any;
      expect(result.content[0].text).toContain('No gaps detected');
    });

    it('should gracefully handle missing exportJson', async () => {
      mockGraph.exportMarkdown.mockReturnValue('# Graph');
      mockGraph.exportJson.mockReturnValue(undefined);
      const result = handlers.handleExportMarkdown() as any;
      expect(result.content[0].text).toBe('# Graph');
    });

    it('should report low-confidence edges', async () => {
      mockGraph.exportMarkdown.mockReturnValue('# Graph');
      mockGraph.exportJson.mockReturnValue({
        nodes: [
          { id: 'n1', type: 'request', label: 'GET /api', metadata: {} },
          { id: 'n2', type: 'script', label: 'app.js', metadata: {} },
        ],
        edges: [
          {
            id: 'e1',
            source: 'n1',
            target: 'n2',
            type: 'correlates',
            metadata: { confidence: 0.1 },
          },
        ],
      });
      const result = handlers.handleExportMarkdown() as any;
      expect(result.content[0].text).toMatch(/Low-confidence edges.*1/);
    });
  });

  describe('handleChain', () => {
    it('should get evidence chain forward', async () => {
      mockGraph.getEvidenceChain.mockReturnValue([
        { id: 'n1', type: 'eval', label: 'eval', metadata: {} },
      ]);
      const result = handlers.handleChain({ nodeId: 'n1' }) as any;
      const data = JSON.parse(result.content[0].text);
      expect(data.direction).toBe('forward');
      expect(data.nodes[0].id).toBe('n1');
    });

    it('should get evidence chain backward if specified', async () => {
      mockGraph.getEvidenceChain.mockReturnValue([
        { id: 'n2', type: 'eval', label: 'eval', metadata: {} },
      ]);
      const result = handlers.handleChain({ nodeId: 'n2', direction: 'backward' }) as any;
      const data = JSON.parse(result.content[0].text);
      expect(data.direction).toBe('backward');
    });
  });
});
