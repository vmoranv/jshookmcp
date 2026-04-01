import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EvidenceHandlers } from '@server/domains/evidence/handlers';

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
    it('should query nodes by url and return JSON', () => {
      mockGraph.queryByUrl.mockReturnValue([
        { id: 'n1', type: 'url', label: 'http://test', metadata: {} },
      ]);
      const result = handlers.handleQueryUrl({ url: 'http://test' }) as any;
      const data = JSON.parse(result.content[0].text);
      expect(data.query.value).toBe('http://test');
      expect(data.nodes[0].id).toBe('n1');
    });
  });

  describe('handleQueryFunction', () => {
    it('should query nodes by function and return JSON', () => {
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
    it('should query nodes by script id and return JSON', () => {
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
    it('should export graph as JSON', () => {
      mockGraph.exportJson.mockReturnValue({ nodes: [], edges: [] });
      const result = handlers.handleExportJson() as any;
      const data = JSON.parse(result.content[0].text);
      expect(data).toEqual({ nodes: [], edges: [] });
    });
  });

  describe('handleExportMarkdown', () => {
    it('should export graph as markdown', () => {
      mockGraph.exportMarkdown.mockReturnValue('# Graph\nData');
      const result = handlers.handleExportMarkdown() as any;
      expect(result.content[0].text).toBe('# Graph\nData');
    });
  });

  describe('handleChain', () => {
    it('should get evidence chain forward', () => {
      mockGraph.getEvidenceChain.mockReturnValue([
        { id: 'n1', type: 'eval', label: 'eval', metadata: {} },
      ]);
      const result = handlers.handleChain({ nodeId: 'n1' }) as any;
      const data = JSON.parse(result.content[0].text);
      expect(data.direction).toBe('forward');
      expect(data.nodes[0].id).toBe('n1');
    });

    it('should get evidence chain backward if specified', () => {
      mockGraph.getEvidenceChain.mockReturnValue([
        { id: 'n2', type: 'eval', label: 'eval', metadata: {} },
      ]);
      const result = handlers.handleChain({ nodeId: 'n2', direction: 'backward' }) as any;
      const data = JSON.parse(result.content[0].text);
      expect(data.direction).toBe('backward');
    });
  });
});
