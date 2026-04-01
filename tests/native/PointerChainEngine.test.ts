/**
 * PointerChainEngine unit tests.
 *
 * Mocks PlatformMemoryAPI provider and nativeMemoryManager to test chain resolution logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PointerChainEngine } from '@native/PointerChainEngine';
import type { PointerChain } from '@native/PointerChainEngine.types';
import { nativeMemoryManager } from '@native/NativeMemoryManager.impl';

// Hoist mock factory
const { mockProviderInstance } = vi.hoisted(() => {
  const memMockData = Buffer.alloc(16384);
  // Create a chain: 0x1000 -> 0x2000 -> 0x3000 -> 0x4242
  memMockData.writeBigUInt64LE(0x2000n, 0); // At 0x1000, points to 0x2000
  memMockData.writeBigUInt64LE(0x3000n, 0x1000); // At 0x2000, points to 0x3000
  memMockData.writeBigUInt64LE(0x4242n, 0x2000); // At 0x3000, points to 0x4242

  const mockProvider = {
    platform: 'win32' as const,
    openProcess: vi.fn(() => ({ pid: 1234, writeAccess: false })),
    closeProcess: vi.fn(),
    readMemory: vi.fn((_handle: any, addr: bigint, size: number) => {
      // Treat base address as 0x1000 for mapping into memMockData buffer
      const offset = Number(addr - 0x1000n);
      if (offset >= 0 && offset + size <= memMockData.length) {
        return { data: Buffer.from(memMockData.subarray(offset, offset + size)), bytesRead: size };
      }
      // Fail reading
      throw new Error('Memory read fault');
    }),
    queryRegion: vi.fn((_handle: any, addr: bigint) => {
      if (addr <= 0x4000n) {
        return {
          baseAddress: 0x1000n,
          size: 16384,
          protection: 0x04,
          state: 'committed',
          type: 'private',
          isReadable: true,
          isWritable: true,
          isExecutable: false,
        };
      }
      return null;
    }),
  };

  return { mockProviderInstance: mockProvider, memMockData };
});

vi.mock('@src/native/platform/factory.js', () => ({
  createPlatformProvider: vi.fn(() => mockProviderInstance),
}));

vi.mock('@native/NativeMemoryManager.impl', () => ({
  nativeMemoryManager: {
    enumerateModules: vi.fn(async () => ({
      success: true,
      modules: [{ name: 'game.exe', baseAddress: '0x1000', size: 4096 }],
    })),
  },
}));

function makeChain(overrides?: Partial<PointerChain>): PointerChain {
  return {
    id: 'test-chain-001',
    links: [
      { address: '0x7FF600001000', module: 'game.exe', moduleOffset: 0x1000, offset: 0 },
      { address: '0x7FF600002000', offset: 0x10 },
    ],
    targetAddress: '0x7FF600003000',
    baseAddress: '0x7FF600001000',
    isStatic: true,
    depth: 2,
    lastValidated: Date.now(),
    isValid: true,
    ...overrides,
  };
}

describe('PointerChainEngine', () => {
  const engine = new PointerChainEngine();

  // ── Export / Import ──

  describe('exportChains / importChains', () => {
    it('should roundtrip a single chain', () => {
      const chain = makeChain();
      const json = engine.exportChains([chain]);
      const imported = engine.importChains(json);

      expect(imported).toHaveLength(1);
      expect(imported[0]!.id).toBe(chain.id);
      expect(imported[0]!.targetAddress).toBe(chain.targetAddress);
      expect(imported[0]!.links).toHaveLength(2);
    });

    it('should roundtrip multiple chains', () => {
      const chains = [
        makeChain({ id: 'chain-a' }),
        makeChain({ id: 'chain-b', isStatic: false }),
        makeChain({ id: 'chain-c', depth: 3 }),
      ];
      const json = engine.exportChains(chains);
      const imported = engine.importChains(json);

      expect(imported).toHaveLength(3);
      expect(imported.map((c) => c.id)).toEqual(['chain-a', 'chain-b', 'chain-c']);
    });

    it('should preserve link details in roundtrip', () => {
      const chain = makeChain({
        links: [
          { address: '0x100', module: 'test.dll', moduleOffset: 0x50, offset: 8 },
          { address: '0x200', offset: -4 },
          { address: '0x300', offset: 0 },
        ],
        depth: 3,
      });
      const json = engine.exportChains([chain]);
      const imported = engine.importChains(json);

      const links = imported[0]!.links;
      expect(links[0]!.module).toBe('test.dll');
      expect(links[0]!.moduleOffset).toBe(0x50);
      expect(links[0]!.offset).toBe(8);
      expect(links[1]!.offset).toBe(-4);
      expect(links[2]!.offset).toBe(0);
    });

    it('should throw on invalid import data', () => {
      expect(() => engine.importChains('{}')).toThrow('expected array');
      expect(() => engine.importChains('not json')).toThrow();
    });

    it('should handle empty array roundtrip', () => {
      const json = engine.exportChains([]);
      const imported = engine.importChains(json);
      expect(imported).toHaveLength(0);
    });
  });

  // ── Chain Structure Integrity ──

  describe('chain structure', () => {
    it('should have consistent depth and links length', () => {
      const chain = makeChain({ depth: 2 });
      expect(chain.links).toHaveLength(2);
      expect(chain.depth).toBe(chain.links.length);
    });

    it('should mark static chains with module info', () => {
      const staticChain = makeChain({ isStatic: true });
      expect(staticChain.links[0]!.module).toBeDefined();
      expect(staticChain.links[0]!.moduleOffset).toBeDefined();
    });

    it('should handle dynamic chains without module info', () => {
      const dynamicChain = makeChain({
        isStatic: false,
        links: [{ address: '0xDEADBEEF', offset: 0 }],
        depth: 1,
      });
      expect(dynamicChain.isStatic).toBe(false);
      expect(dynamicChain.links[0]!.module).toBeUndefined();
    });

    it('should support negative offsets', () => {
      const chain = makeChain({
        links: [{ address: '0x100', offset: -128 }],
        depth: 1,
      });
      expect(chain.links[0]!.offset).toBe(-128);
    });

    it('should support zero-offset chains (direct pointer)', () => {
      const chain = makeChain({
        links: [{ address: '0x100', offset: 0 }],
        depth: 1,
      });
      expect(chain.links[0]!.offset).toBe(0);
    });
  });

  // ── Export format ──

  describe('export format', () => {
    it('should produce valid JSON', () => {
      const chain = makeChain();
      const json = engine.exportChains([chain]);
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('should produce pretty-printed JSON', () => {
      const chain = engine.importChains(engine.exportChains([makeChain()]))[0]!;
      const json = engine.exportChains([chain]);
      expect(json).toContain('\n');
      expect(json).toContain('  ');
    });
  });

  // ── Engine Scanning and Resolution ──

  describe('Scanning and Validation', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should successfully scan and find a pointer chain', async () => {
      // Look for pointers leading to 0x4242
      const res = await engine.scan(1234, '0x4242', { maxDepth: 4 });
      expect(res.chains.length).toBeGreaterThan(0);
      expect(res.totalFound).toBe(res.chains.length);
      expect(res.targetAddress).toBe('0x4242');
    });

    it('should respect maximum depth limit', async () => {
      // If we cap depth to 1, it only searches for direct pointers
      const res = await engine.scan(1234, '0x4242', { maxDepth: 1 });
      // The direct pointer is at 0x3000 -> 0x4242
      expect(res.chains.length).toBe(1);
      expect(res.chains[0]!.baseAddress).toBe('0x3000');
    });

    it('should filter by module when staticOnly is true', async () => {
      // 0x3000 is inside game.exe (0x1000 + 4096)
      const res = await engine.scan(1234, '0x4242', { staticOnly: true });
      expect(res.chains.length).toBeGreaterThan(0);
      for (const chain of res.chains) {
        expect(chain.isStatic).toBe(true);
      }
    });

    it('should handle scan errors cleanly if region cannot be read', async () => {
      mockProviderInstance.readMemory.mockImplementationOnce(() => {
        throw new Error('Forced read error');
      });
      const res = await engine.scan(1234, '0x4242');
      expect(res.chains).toBeDefined(); // should complete empty run
    });

    it('should handle enumeration module failures gracefully', async () => {
      vi.mocked(nativeMemoryManager.enumerateModules).mockRejectedValueOnce(
        new Error('Enum failed'),
      );
      const res = await engine.scan(1234, '0x4242');
      // Should still succeed, but without module markings
      expect(res.chains.length).toBeGreaterThan(0);
    });

    it('should validate an existing pointer chain accurately', async () => {
      const chain: PointerChain = {
        id: 'val-1',
        targetAddress: '0x0000000000004242',
        baseAddress: '0x0000000000001000',
        isStatic: true,
        depth: 3,
        lastValidated: 0,
        isValid: true,
        links: [
          { address: '0x1000', offset: 0 },
          { address: '0x2000', offset: 0 },
          { address: '0x3000', offset: 0 },
        ],
      };

      const val = await engine.validateChain(1234, chain);
      expect(val.isValid).toBe(true);
      expect(val.resolvedAddress).toBe('0x4242');
    });

    it('should return invalid when validating a broken pointer chain', async () => {
      const chain: PointerChain = {
        id: 'val-broken',
        targetAddress: '0x0000000000004242',
        baseAddress: '0x0000000000001000',
        isStatic: true,
        depth: 3,
        lastValidated: 0,
        isValid: true,
        links: [
          { address: '0x1000', offset: 0 },
          { address: '0x2000', offset: 99999 }, // Bad offset pushes ptrValue + 99999
          { address: '0x3000', offset: 0 }, // This read will fail and throw!
        ],
      };

      const val = await engine.validateChain(1234, chain);
      expect(val.isValid).toBe(false);
      expect(val.brokenAt).toBe(2); // Fails at the next link's memory read attempt
    });

    it('should validate multiple chains in batch', async () => {
      const chain1: PointerChain = {
        id: 'val-batch-1',
        targetAddress: '0x3000',
        baseAddress: '0x1000',
        isStatic: true,
        depth: 2,
        lastValidated: 0,
        isValid: true,
        links: [
          { address: '0x0000000000001000', offset: 0 },
          { address: '0x0000000000002000', offset: 0 },
        ],
      };
      const chain2 = { ...chain1, targetAddress: '0xDEADBEEF' }; // Broken target

      const vals = await engine.validateChains(1234, [chain1, chain2]);
      expect(vals).toHaveLength(2);
      expect(vals[0]!.isValid).toBe(true);
      expect(vals[1]!.isValid).toBe(false);
    });

    it('should resolve a chain directly', async () => {
      const chain: PointerChain = {
        id: 'resolve',
        targetAddress: '0x0', // Doesn't matter, we want what it resolves TO
        baseAddress: '0x2000',
        isStatic: true,
        depth: 1,
        lastValidated: 0,
        isValid: true,
        links: [{ address: '0x0000000000002000', offset: 0 }],
      };

      const resolved = await engine.resolveChain(1234, chain);
      expect(resolved).toBe('0x3000'); // 0x2000 points to 0x3000
    });

    it('should return null when failing to resolve a chain', async () => {
      const chain: PointerChain = {
        id: 'resolve-fail',
        targetAddress: '0x0',
        baseAddress: '0x0000000099999999', // invalid
        isStatic: true,
        depth: 1,
        lastValidated: 0,
        isValid: true,
        links: [{ address: '0x0000000099999999', offset: 0 }],
      };

      const resolved = await engine.resolveChain(1234, chain);
      expect(resolved).toBeNull();
    });
  });
});
