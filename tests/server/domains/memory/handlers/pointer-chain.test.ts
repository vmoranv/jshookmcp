import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PointerChainHandlers } from '../../../../../src/server/domains/memory/handlers/pointer-chain';

describe('PointerChainHandlers', () => {
  let handlers: PointerChainHandlers;
  const dummyArgs = {
    sessionId: 'test-session',
    pattern: '12 34',
    pid: 1234,
    structure: '{"fields":[]}',
    name: 'test',
    type: 'float',
    size: 4,
    value: '1.2',
    chains: '[]',
    chain: '{"offsets":[]}',
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
      mockptrEngine.scan = vi.fn().mockReturnValue({
        dummyObj: true,
        length: 1,
        toArray: () => [],
        fields: [],
        baseClasses: [],
        matching: [],
        differing: [],
        address: '0x123',
        name: 'test',
        protection: '',
        memoryType: '',
        region: {},
        oldMatchCount: 1,
        newMatchCount: 0,
      });

      const response = await handlers.handlePointerChainScan(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mockptrEngine.scan = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handlePointerChainScan(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handlePointerChainValidate', () => {
    it('returns success response on happy path', async () => {
      mockptrEngine.validateChains = vi.fn().mockReturnValue([{ isValid: true }]);

      const response = await handlers.handlePointerChainValidate(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mockptrEngine.validateChains = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handlePointerChainValidate(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handlePointerChainResolve', () => {
    it('returns success response on happy path', async () => {
      mockptrEngine.resolveChain = vi.fn().mockReturnValue({
        dummyObj: true,
        length: 1,
        toArray: () => [],
        fields: [],
        baseClasses: [],
        matching: [],
        differing: [],
        address: '0x123',
        name: 'test',
        protection: '',
        memoryType: '',
        region: {},
        oldMatchCount: 1,
        newMatchCount: 0,
      });

      const response = await handlers.handlePointerChainResolve(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mockptrEngine.resolveChain = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handlePointerChainResolve(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handlePointerChainExport', () => {
    it('returns success response on happy path', async () => {
      mockptrEngine.exportChains = vi.fn().mockReturnValue({
        dummyObj: true,
        length: 1,
        toArray: () => [],
        fields: [],
        baseClasses: [],
        matching: [],
        differing: [],
        address: '0x123',
        name: 'test',
        protection: '',
        memoryType: '',
        region: {},
        oldMatchCount: 1,
        newMatchCount: 0,
      });

      const response = await handlers.handlePointerChainExport(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });

    it('returns error response on failure', async () => {
      mockptrEngine.exportChains = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handlePointerChainExport(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });
});
