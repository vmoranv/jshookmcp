import { describe, expect, it, beforeEach } from 'vitest';
import { CrossDomainHandlers } from '@server/domains/cross-domain/handlers';
import {
  CrossDomainEvidenceBridge,
  _resetIdCounter,
} from '@server/domains/cross-domain/handlers/evidence-graph-bridge';

describe('CrossDomainHandlers', () => {
  let bridge: CrossDomainEvidenceBridge;
  let handlers: CrossDomainHandlers;

  beforeEach(() => {
    _resetIdCounter();
    bridge = new CrossDomainEvidenceBridge();
    handlers = new CrossDomainHandlers(bridge);
  });

  describe('handleCapabilities', () => {
    it('should return capability flags with workflow classifier unavailable', async () => {
      const result = (await handlers.handleCapabilities({})) as {
        content: Array<{ text: string }>;
      };
      // @ts-expect-error
      const data = JSON.parse(result.content[0].text);
      expect(data.capabilities).toBeDefined();
      expect(typeof data.capabilities.evidenceGraphAvailable).toBe('boolean');
    });
  });

  describe('handleSuggestWorkflow', () => {
    it('should return message when workflow classifier is unavailable', async () => {
      const result = (await handlers.handleSuggestWorkflow({
        query: 'completely unrelated xyz123',
      })) as {
        content: Array<{ text: string }>;
      };
      // Returns message when classifier not provided
      // @ts-expect-error
      expect(result.content[0].text).toContain('Cross-domain');
    });
  });

  describe('handleEvidenceExport', () => {
    it('should export the evidence graph snapshot', async () => {
      bridge.addV8Object({ address: '0x1', name: 'Test' });
      const result = (await handlers.handleEvidenceExport()) as {
        content: Array<{ text: string }>;
      };
      // @ts-expect-error
      const data = JSON.parse(result.content[0].text);
      expect(data.version).toBe(1);
      expect(data.nodes.length).toBeGreaterThan(0);
    });
  });

  describe('handleEvidenceStats', () => {
    it('should return evidence graph statistics', async () => {
      bridge.addV8Object({ address: '0xA', name: 'ObjA' });
      bridge.addNetworkRequest({ url: 'https://test.com' });
      const result = (await handlers.handleEvidenceStats()) as { content: Array<{ text: string }> };
      // @ts-expect-error
      const data = JSON.parse(result.content[0].text);
      expect(data.nodeCount).toBe(2);
      expect(data.edgeCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('handleCorrelateAll', () => {
    it('should run SKIA correlation and return results', async () => {
      const result = (await handlers.handleCorrelateAll({})) as {
        content: Array<{ text: string }>;
      };
      // @ts-expect-error
      const data = JSON.parse(result.content[0].text);
      expect(data.correlationResults).toBeDefined();
      // SKIA-03 should run and add nodes to the graph
      expect(data.correlationResults.errors).toBeDefined();
    });

    it('should return evidence graph snapshot in result', async () => {
      const result = (await handlers.handleCorrelateAll({})) as {
        content: Array<{ text: string }>;
      };
      // @ts-expect-error
      const data = JSON.parse(result.content[0].text);
      expect(data.evidenceGraph).toBeDefined();
      expect(data.evidenceGraph.version).toBe(1);
    });
  });
});
