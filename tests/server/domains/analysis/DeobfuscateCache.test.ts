import { describe, it, expect, vi } from 'vitest';
import { CoreAnalysisHandlers } from '@server/domains/analysis/handlers';
import { Deobfuscator } from '@modules/deobfuscator/Deobfuscator';
import { AdvancedDeobfuscator } from '@modules/deobfuscator/AdvancedDeobfuscator';
import { ObfuscationDetector } from '@modules/detector/ObfuscationDetector';
import { CodeAnalyzer } from '@modules/analyzer/CodeAnalyzer';
import { CryptoDetector } from '@modules/crypto/CryptoDetector';
import { HookManager } from '@modules/hook/HookManager';
import { ScriptManager } from '@modules/debugger/ScriptManager';
import { CodeCollector } from '@server/domains/shared/modules/collector';
import { JScramberDeobfuscator } from '@modules/deobfuscator/JScramblerDeobfuscator';
import { UniversalUnpacker } from '@modules/deobfuscator/PackerDeobfuscator';
import { VMDeobfuscator } from '@modules/deobfuscator/VMDeobfuscator';
import type { ToolResponse } from '@server/types';
import type { LLMSamplingBridge } from '@server/LLMSamplingBridge';

const parseToolResponse = <T>(response: ToolResponse): T => {
  // @ts-expect-error
  return JSON.parse(response.content[0]!.text) as T;
};

const createMockSamplingBridge = (): LLMSamplingBridge => {
  return {
    isSamplingSupported: vi.fn().mockReturnValue(false),
    sampleText: vi.fn(),
  } as unknown as LLMSamplingBridge;
};

describe('DeobfuscateCache Integration', () => {
  const createMockCollector = (): CodeCollector => {
    return {
      collect: vi.fn().mockResolvedValue({ files: [], totalSize: 0, collectTime: 0 }),
      clearAllData: vi.fn().mockResolvedValue(undefined),
      getAllStats: vi.fn().mockResolvedValue({
        cache: { memoryEntries: 0, diskEntries: 0, totalSize: 0 },
        compression: { averageRatio: 0, cacheHits: 0, cacheMisses: 0 },
        collector: { collectedUrls: [] },
      }),
    } as unknown as CodeCollector;
  };

  const createMockScriptManager = (): ScriptManager => {
    return {
      init: vi.fn().mockResolvedValue(undefined),
      searchInScripts: vi.fn().mockResolvedValue({ matches: [] }),
      extractFunctionTree: vi.fn().mockResolvedValue({ code: '' }),
      getScriptSource: vi.fn().mockResolvedValue({ source: '' }),
      getAllScripts: vi.fn().mockResolvedValue([]),
      clear: vi.fn(),
    } as unknown as ScriptManager;
  };

  const createHandlers = (): CoreAnalysisHandlers => {
    return new CoreAnalysisHandlers({
      collector: createMockCollector(),
      scriptManager: createMockScriptManager(),
      deobfuscator: new Deobfuscator(),
      advancedDeobfuscator: new AdvancedDeobfuscator(),
      obfuscationDetector: new ObfuscationDetector(),
      analyzer: new CodeAnalyzer(),
      cryptoDetector: new CryptoDetector(),
      hookManager: new HookManager(),
      samplingBridge: createMockSamplingBridge(),
      jscramblerDeobfuscator: new JScramberDeobfuscator(),
      packerDeobfuscator: new UniversalUnpacker(),
      vmDeobfuscator: new VMDeobfuscator(),
    });
  };

  describe('handleDeobfuscate caching', () => {
    it('should cache successful deobfuscation results', async () => {
      const handlers = createHandlers();
      const simpleCode = 'const x = 1; console.log(x);';

      // First call
      const result1 = parseToolResponse<{ code: string; cached?: boolean }>(
        await handlers.handleDeobfuscate({ code: simpleCode }),
      );
      expect(result1.code).toContain('console.log');
      expect(result1.cached).toBe(false);

      // Second call with same code - should use cache
      const result2 = parseToolResponse<{ code: string; cached?: boolean }>(
        await handlers.handleDeobfuscate({ code: simpleCode }),
      );
      expect(result2.code).toContain('console.log');
      expect(result2.cached).toBe(true);
    });

    it('should use different cache keys for different options', async () => {
      const handlers = createHandlers();
      const code = 'const x = 1;';

      // Call without mangle option
      const result1 = parseToolResponse<{ cached?: boolean }>(
        await handlers.handleDeobfuscate({ code }),
      );

      // Call with mangle option
      const result2 = parseToolResponse<{ cached?: boolean }>(
        await handlers.handleDeobfuscate({ code, mangle: true }),
      );

      // Second call should not be cached (different options)
      expect(result1.cached).toBe(false);
      expect(result2.cached).toBe(false);

      // Third call with same options as first - should be cached
      const result3 = parseToolResponse<{ cached?: boolean }>(
        await handlers.handleDeobfuscate({ code }),
      );
      expect(result3.cached).toBe(true);
    });

    it('should not cache failed deobfuscation results', async () => {
      const handlers = createHandlers();
      // Empty code should fail validation
      const result1 = parseToolResponse<{ success: boolean; cached?: boolean }>(
        await handlers.handleDeobfuscate({ code: '' }),
      );
      expect(result1.success).toBe(false);

      // Should not be cached (validation failure)
      const result2 = parseToolResponse<{ cached?: boolean }>(
        await handlers.handleDeobfuscate({ code: '' }),
      );
      expect(result2.cached).not.toBe(true);
    });
  });

  describe('handleDeobfuscate caching (engine: webcrack)', () => {
    it('should cache successful advanced deobfuscation results', async () => {
      const handlers = createHandlers();
      const code = 'const x = 1; const y = 2; console.log(x + y);';

      // First call
      const result1 = parseToolResponse<{ code: string; cached?: boolean }>(
        await handlers.handleDeobfuscate({ code, engine: 'webcrack' }),
      );
      expect(result1.code).toContain('console.log');
      expect(result1.cached).toBe(false);

      // Second call with same code - should use cache
      const result2 = parseToolResponse<{ code: string; cached?: boolean }>(
        await handlers.handleDeobfuscate({ code, engine: 'webcrack' }),
      );
      expect(result2.code).toContain('console.log');
      expect(result2.cached).toBe(true);
    });

    it('should use different cache keys for different jsx options', async () => {
      const handlers = createHandlers();
      const code = 'const x = 1;';

      // Call without jsx option
      const result1 = parseToolResponse<{ cached?: boolean }>(
        await handlers.handleDeobfuscate({ code, engine: 'webcrack' }),
      );

      // Call with jsx=false
      const result2 = parseToolResponse<{ cached?: boolean }>(
        await handlers.handleDeobfuscate({ code, engine: 'webcrack', jsx: false }),
      );

      // Should have different cache entries
      expect(result1.cached).toBe(false);
      expect(result2.cached).toBe(false);

      // Repeat call with jsx=false - should be cached
      const result3 = parseToolResponse<{ cached?: boolean }>(
        await handlers.handleDeobfuscate({ code, engine: 'webcrack', jsx: false }),
      );
      expect(result3.cached).toBe(true);
    });

    it('should respect detectOnly option in cache key', async () => {
      const handlers = createHandlers();
      const code = 'var _0x1234 = ["test"];';

      const result1 = parseToolResponse<{ cached?: boolean; webcrackApplied?: boolean }>(
        await handlers.handleDeobfuscate({ code, engine: 'webcrack', detectOnly: true }),
      );
      const result2 = parseToolResponse<{ cached?: boolean; webcrackApplied?: boolean }>(
        await handlers.handleDeobfuscate({ code, engine: 'webcrack', detectOnly: false }),
      );

      // Different detectOnly values should have different cache entries
      expect(result1.cached).toBe(false);
      expect(result2.cached).toBe(false);
      expect(result1.webcrackApplied).toBe(false);
      expect(result2.webcrackApplied).toBe(true);

      // Repeat with same detectOnly - should be cached
      const result3 = parseToolResponse<{ cached?: boolean }>(
        await handlers.handleDeobfuscate({ code, engine: 'webcrack', detectOnly: true }),
      );
      expect(result3.cached).toBe(true);
    });

    it('should include unminify in cache key', async () => {
      const handlers = createHandlers();
      const code = 'const x = 1;';

      const result1 = parseToolResponse<{ cached?: boolean }>(
        await handlers.handleDeobfuscate({ code, engine: 'webcrack', unminify: false }),
      );
      const result2 = parseToolResponse<{ cached?: boolean }>(
        await handlers.handleDeobfuscate({ code, engine: 'webcrack', unminify: true }),
      );

      expect(result1.cached).toBe(false);
      expect(result2.cached).toBe(false);

      // Same unminify=false - should be cached
      const result3 = parseToolResponse<{ cached?: boolean }>(
        await handlers.handleDeobfuscate({ code, engine: 'webcrack', unminify: false }),
      );
      expect(result3.cached).toBe(true);
    });
  });

  describe('cache lifetime', () => {
    // This block used to be `describe('cache persistence')` with a single test
    // named "should persist cache across handler instances". That test never
    // created a second handler: it constructed its own PersistentCache, called
    // init(), and asserted the .db file existed. It passed with
    // handleDeobfuscate replaced by a no-op, so it proved nothing about the
    // product while occupying the "persistence is covered" slot.
    //
    // There is no persistence here to test. `handleDeobfuscate` reaches
    // `Deobfuscator.resultCache`, a per-instance `Map` (Deobfuscator.ts:13), and
    // `createHandlers` builds a fresh `Deobfuscator` on every call
    // (handlers.ts:70-71). The cache dies with the instance. This test pins
    // that down, and fails if the cache is ever hoisted to module scope — which
    // would let stale results leak between handlers.
    it('does not share cached results across handler instances', async () => {
      const code = 'const notSharedAcrossInstances = true;';

      const handlers1 = createHandlers();
      const first = parseToolResponse<{ cached?: boolean }>(
        await handlers1.handleDeobfuscate({ code }),
      );
      expect(first.cached).toBe(false);

      // Same instance, same input -> in-memory hit.
      const second = parseToolResponse<{ cached?: boolean }>(
        await handlers1.handleDeobfuscate({ code }),
      );
      expect(second.cached).toBe(true);

      // Fresh instance -> fresh Deobfuscator -> no cached entry.
      const handlers2 = createHandlers();
      const third = parseToolResponse<{ cached?: boolean }>(
        await handlers2.handleDeobfuscate({ code }),
      );
      expect(third.cached).toBe(false);
    });
  });
});
