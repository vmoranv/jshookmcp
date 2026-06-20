import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PointerChainHandlers } from '../../../../../src/server/domains/memory/handlers/pointer-chain';

describe('PointerChainHandlers', () => {
  let handlers: PointerChainHandlers;
  const dummyArgs = {
    pid: 1234,
    targetAddress: '0x7FF612340000',
    chains: JSON.stringify([{ id: 'c1', offsets: [0x10] }]),
    chain: JSON.stringify({ id: 'c1', offsets: [0x10] }),
    maxDepth: 4,
    maxOffset: 4096,
    staticOnly: false,
    modules: ['kernel32.dll'],
    maxResults: 1000,
  };

  const mockptrEngine = {
    /* mock */
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockptrEngine).forEach((key) => delete mockptrEngine[key]);
    handlers = new PointerChainHandlers(mockptrEngine);
  });

  it('instantiates correctly', async () => {
    expect(handlers).toBeInstanceOf(PointerChainHandlers);
  });

  describe('handlePointerChainScan', () => {
    it('returns success response on happy path', async () => {
      mockptrEngine.scan = vi.fn().mockReturnValue({ totalFound: 0, chains: [] });

      const response = await handlers.handlePointerChainScan(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(mockptrEngine.scan).toHaveBeenCalledWith(
        1234,
        '0x7FF612340000',
        expect.objectContaining({
          maxDepth: 4,
          maxOffset: 4096,
          staticOnly: false,
          modules: ['kernel32.dll'],
        }),
      );
    });

    it('returns error response on failure', async () => {
      mockptrEngine.scan = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handlePointerChainScan(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects invalid targetAddress', async () => {
      mockptrEngine.scan = vi.fn();
      const response = await handlers.handlePointerChainScan({ pid: 1234, targetAddress: 'xyz' });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('targetAddress must be a hex address');
      expect(mockptrEngine.scan).not.toHaveBeenCalled();
    });
  });

  describe('handlePointerChainValidate', () => {
    it('returns success response on happy path', async () => {
      mockptrEngine.validateChains = vi.fn().mockReturnValue([{ isValid: true }]);

      const response = await handlers.handlePointerChainValidate(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.validCount).toBe(1);
      expect(parsed.totalChecked).toBe(1);
      expect(mockptrEngine.validateChains).toHaveBeenCalledWith(1234, [
        { id: 'c1', offsets: [0x10] },
      ]);
    });

    it('returns error response on failure', async () => {
      mockptrEngine.validateChains = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handlePointerChainValidate(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects missing chains argument', async () => {
      mockptrEngine.validateChains = vi.fn();
      const response = await handlers.handlePointerChainValidate({ pid: 1234 });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('memory_pointer_chain');
      expect(parsed.error).toContain('chains');
      expect(mockptrEngine.validateChains).not.toHaveBeenCalled();
    });

    it('rejects malformed JSON chains', async () => {
      mockptrEngine.validateChains = vi.fn();
      const response = await handlers.handlePointerChainValidate({
        pid: 1234,
        chains: '{not json',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('must be valid JSON');
      expect(mockptrEngine.validateChains).not.toHaveBeenCalled();
    });
  });

  describe('handlePointerChainResolve', () => {
    it('returns success response on happy path', async () => {
      mockptrEngine.resolveChain = vi.fn().mockReturnValue('0x1234');

      const response = await handlers.handlePointerChainResolve(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.resolvedAddress).toBe('0x1234');
      expect(parsed.isResolvable).toBe(true);
      expect(parsed.chainId).toBe('c1');
      expect(mockptrEngine.resolveChain).toHaveBeenCalledWith(1234, { id: 'c1', offsets: [0x10] });
    });

    it('returns error response on failure', async () => {
      mockptrEngine.resolveChain = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handlePointerChainResolve(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects missing chain argument', async () => {
      mockptrEngine.resolveChain = vi.fn();
      const response = await handlers.handlePointerChainResolve({ pid: 1234 });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('"chain"');
      expect(mockptrEngine.resolveChain).not.toHaveBeenCalled();
    });
  });

  describe('handlePointerChainExport', () => {
    it('returns success response on happy path', async () => {
      mockptrEngine.exportChains = vi.fn().mockReturnValue('exported-blob');

      const response = await handlers.handlePointerChainExport(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.exportedData).toBe('exported-blob');
      expect(parsed.chainCount).toBe(1);
      expect(mockptrEngine.exportChains).toHaveBeenCalledWith([{ id: 'c1', offsets: [0x10] }]);
    });

    it('returns error response on failure', async () => {
      mockptrEngine.exportChains = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handlePointerChainExport(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects missing chains argument', async () => {
      mockptrEngine.exportChains = vi.fn();
      const response = await handlers.handlePointerChainExport({});
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('memory_pointer_chain');
      expect(mockptrEngine.exportChains).not.toHaveBeenCalled();
    });
  });
});
