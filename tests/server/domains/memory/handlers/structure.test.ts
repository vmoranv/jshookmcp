import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StructureHandlers } from '../../../../../src/server/domains/memory/handlers/structure';

describe('StructureHandlers', () => {
  let handlers: StructureHandlers;
  const dummyArgs = {
    pid: 1234,
    address: '0x7FF612340000',
    address1: '0x7FF612340000',
    address2: '0x7FF612341000',
    vtableAddress: '0x7FF612342000',
    structure: JSON.stringify({ fields: [], baseAddress: '0x0', totalSize: 0 }),
    name: 'TestStruct',
    size: 256,
    parseRtti: true,
    otherInstances: ['0x7FF612341000'],
  };

  const mockstructAnalyzer = {
    /* mock */
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockstructAnalyzer).forEach((key) => delete mockstructAnalyzer[key]);
    handlers = new StructureHandlers(mockstructAnalyzer);
  });

  it('instantiates correctly', async () => {
    expect(handlers).toBeInstanceOf(StructureHandlers);
  });

  describe('handleStructureAnalyze', () => {
    it('returns success response on happy path', async () => {
      mockstructAnalyzer.analyzeStructure = vi.fn().mockReturnValue({
        className: 'Foo',
        fields: [],
        baseClasses: [],
      });

      const response = await handlers.handleStructureAnalyze(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.hint).toContain('Foo');
      expect(mockstructAnalyzer.analyzeStructure).toHaveBeenCalledWith(
        1234,
        '0x7FF612340000',
        expect.objectContaining({ size: 256, parseRtti: true, otherInstances: ['0x7FF612341000'] }),
      );
    });

    it('returns error response on failure', async () => {
      mockstructAnalyzer.analyzeStructure = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleStructureAnalyze(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects invalid address', async () => {
      mockstructAnalyzer.analyzeStructure = vi.fn();
      const response = await handlers.handleStructureAnalyze({ pid: 1234, address: 'xyz' });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toMatch(/address base|cannot parse/);
      expect(mockstructAnalyzer.analyzeStructure).not.toHaveBeenCalled();
    });

    it('rejects non-positive size', async () => {
      mockstructAnalyzer.analyzeStructure = vi.fn();
      const response = await handlers.handleStructureAnalyze({
        pid: 1234,
        address: '0x1',
        size: -5,
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('"size" must be a positive number');
      expect(mockstructAnalyzer.analyzeStructure).not.toHaveBeenCalled();
    });
  });

  describe('handleVtableParse', () => {
    it('returns success response on happy path', async () => {
      mockstructAnalyzer.parseVtable = vi.fn().mockReturnValue({ entries: [] });

      const response = await handlers.handleVtableParse(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(mockstructAnalyzer.parseVtable).toHaveBeenCalledWith(1234, '0x7FF612342000');
    });

    it('returns error response on failure', async () => {
      mockstructAnalyzer.parseVtable = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleVtableParse(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects missing vtableAddress', async () => {
      mockstructAnalyzer.parseVtable = vi.fn();
      const response = await handlers.handleVtableParse({ pid: 1234 });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toMatch(/vtableAddress|invalid required/);
      expect(mockstructAnalyzer.parseVtable).not.toHaveBeenCalled();
    });
  });

  describe('handleStructureExportC', () => {
    it('returns success response on happy path', async () => {
      mockstructAnalyzer.exportToCStruct = vi.fn().mockReturnValue({
        name: 'TestStruct',
        definition: 'struct TestStruct {};',
        size: 0,
        fieldCount: 0,
      });

      const response = await handlers.handleStructureExportC(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(mockstructAnalyzer.exportToCStruct).toHaveBeenCalledWith(
        expect.objectContaining({ totalSize: 0, fields: [] }),
        'TestStruct',
      );
    });

    it('normalizes legacy export payloads before delegating to the analyzer', async () => {
      mockstructAnalyzer.exportToCStruct = vi.fn().mockReturnValue({
        name: 'RuntimeAuditStruct',
        definition: 'struct RuntimeAuditStruct {};',
        size: 8,
        fieldCount: 1,
      });

      const response = await handlers.handleStructureExportC({
        structure: JSON.stringify({
          name: 'RuntimeAuditStruct',
          size: 8,
          fields: [{ name: 'flag', offset: 0, size: 4, type: 'uint32_t' }],
        }),
        name: 'RuntimeAuditStruct',
      });

      expect(mockstructAnalyzer.exportToCStruct).toHaveBeenCalledWith(
        expect.objectContaining({
          totalSize: 8,
          fields: [
            expect.objectContaining({
              name: 'flag',
              offset: 0,
              size: 4,
              type: 'uint32',
            }),
          ],
        }),
        'RuntimeAuditStruct',
      );
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mockstructAnalyzer.exportToCStruct = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleStructureExportC(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects missing structure argument', async () => {
      mockstructAnalyzer.exportToCStruct = vi.fn();
      const response = await handlers.handleStructureExportC({});
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('memory_structure_export_c');
      expect(parsed.error).toContain('"structure"');
      expect(mockstructAnalyzer.exportToCStruct).not.toHaveBeenCalled();
    });

    it('rejects malformed JSON structure', async () => {
      mockstructAnalyzer.exportToCStruct = vi.fn();
      const response = await handlers.handleStructureExportC({ structure: '{not json' });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('must be valid JSON');
      expect(mockstructAnalyzer.exportToCStruct).not.toHaveBeenCalled();
    });
  });

  describe('handleStructureCompare', () => {
    it('returns success response on happy path', async () => {
      mockstructAnalyzer.compareInstances = vi.fn().mockReturnValue({
        matching: [{ name: 'a' }],
        differing: [{ name: 'b' }],
      });

      const response = await handlers.handleStructureCompare(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.matchingFieldCount).toBe(1);
      expect(parsed.differingFieldCount).toBe(1);
      expect(mockstructAnalyzer.compareInstances).toHaveBeenCalledWith(
        1234,
        '0x7FF612340000',
        '0x7FF612341000',
        256,
      );
    });

    it('returns error response on failure', async () => {
      mockstructAnalyzer.compareInstances = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleStructureCompare(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects missing address2', async () => {
      mockstructAnalyzer.compareInstances = vi.fn();
      const response = await handlers.handleStructureCompare({
        pid: 1234,
        address1: '0x1',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toMatch(/address2|invalid required/);
      expect(mockstructAnalyzer.compareInstances).not.toHaveBeenCalled();
    });
  });
});
