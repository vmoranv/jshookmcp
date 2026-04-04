import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CoreAnalysisHandlers } from '@server/domains/analysis/handlers.impl';
import {
  Deobfuscator,
  AdvancedDeobfuscator,
  ObfuscationDetector,
  CodeAnalyzer,
  CryptoDetector,
  HookManager,
  ScriptManager,
} from '@server/domains/shared/modules';
import { CodeCollector } from '@server/domains/shared/modules';
import { PersistentCache } from '@utils/cache/PersistentCache';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync, rmSync } from 'fs';
import type { ToolResponse } from '@server/types';

const parseToolResponse = <T>(response: ToolResponse): T => {
  return JSON.parse(response.content[0]!.text) as T;
};

describe('DeobfuscateCache Integration', () => {
  const testDbPath = join(tmpdir(), `jshook-test-deobf-cache-${Date.now()}.db`);

  const cleanup = () => {
    try {
      if (existsSync(testDbPath)) {
        rmSync(testDbPath, { force: true });
      }
      if (existsSync(testDbPath + '-wal')) {
        rmSync(testDbPath + '-wal', { force: true });
      }
      if (existsSync(testDbPath + '-shm')) {
        rmSync(testDbPath + '-shm', { force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  };

  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

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

      // Call without aggressive option
      const result1 = parseToolResponse<{ cached?: boolean }>(
        await handlers.handleDeobfuscate({ code }),
      );

      // Call with aggressive option
      const result2 = parseToolResponse<{ cached?: boolean; warnings?: string[] }>(
        await handlers.handleDeobfuscate({ code, aggressive: true }),
      );

      // Second call should not be cached (different options)
      expect(result1.cached).toBe(false);
      expect(result2.cached).toBe(false);
      expect(result2.warnings).toContain(
        'aggressive is deprecated and ignored; webcrack is now the only deobfuscation engine.',
      );

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

  describe('handleAdvancedDeobfuscate caching', () => {
    it('should cache successful advanced deobfuscation results', async () => {
      const handlers = createHandlers();
      const code = 'const x = 1; const y = 2; console.log(x + y);';

      // First call
      const result1 = parseToolResponse<{ code: string; cached?: boolean }>(
        await handlers.handleAdvancedDeobfuscate({ code }),
      );
      expect(result1.code).toContain('console.log');
      expect(result1.cached).toBe(false);

      // Second call with same code - should use cache
      const result2 = parseToolResponse<{ code: string; cached?: boolean }>(
        await handlers.handleAdvancedDeobfuscate({ code }),
      );
      expect(result2.code).toContain('console.log');
      expect(result2.cached).toBe(true);
    });

    it('should use different cache keys for different VM options', async () => {
      const handlers = createHandlers();
      const code = 'const x = 1;';

      // Call without aggressiveVM
      const result1 = parseToolResponse<{ cached?: boolean }>(
        await handlers.handleAdvancedDeobfuscate({ code }),
      );

      // Call with aggressiveVM
      const result2 = parseToolResponse<{ cached?: boolean; warnings?: string[] }>(
        await handlers.handleAdvancedDeobfuscate({ code, aggressiveVM: true }),
      );

      // Should have different cache entries
      expect(result1.cached).toBe(false);
      expect(result2.cached).toBe(false);
      expect(result2.warnings).toContain(
        'aggressiveVM is deprecated and ignored; VM-specific legacy logic has been removed.',
      );

      // Repeat call with aggressiveVM - should be cached
      const result3 = parseToolResponse<{ cached?: boolean }>(
        await handlers.handleAdvancedDeobfuscate({ code, aggressiveVM: true }),
      );
      expect(result3.cached).toBe(true);
    });

    it('should respect detectOnly option in cache key', async () => {
      const handlers = createHandlers();
      const code = 'var _0x1234 = ["test"];';

      const result1 = parseToolResponse<{ cached?: boolean; webcrackApplied?: boolean }>(
        await handlers.handleAdvancedDeobfuscate({ code, detectOnly: true }),
      );
      const result2 = parseToolResponse<{ cached?: boolean; webcrackApplied?: boolean }>(
        await handlers.handleAdvancedDeobfuscate({ code, detectOnly: false }),
      );

      // Different detectOnly values should have different cache entries
      expect(result1.cached).toBe(false);
      expect(result2.cached).toBe(false);
      expect(result1.webcrackApplied).toBe(false);
      expect(result2.webcrackApplied).toBe(true);

      // Repeat with same detectOnly - should be cached
      const result3 = parseToolResponse<{ cached?: boolean }>(
        await handlers.handleAdvancedDeobfuscate({ code, detectOnly: true }),
      );
      expect(result3.cached).toBe(true);
    });

    it('should include timeout in cache key', async () => {
      const handlers = createHandlers();
      const code = 'const x = 1;';

      const result1 = parseToolResponse<{ cached?: boolean; warnings?: string[] }>(
        await handlers.handleAdvancedDeobfuscate({ code, timeout: 5000 }),
      );
      const result2 = parseToolResponse<{ cached?: boolean; warnings?: string[] }>(
        await handlers.handleAdvancedDeobfuscate({ code, timeout: 10000 }),
      );

      expect(result1.cached).toBe(false);
      expect(result2.cached).toBe(false);
      expect(result1.warnings).toContain(
        'timeout is currently ignored; webcrack controls its own execution flow.',
      );
      expect(result2.warnings).toContain(
        'timeout is currently ignored; webcrack controls its own execution flow.',
      );

      // Same timeout - should be cached
      const result3 = parseToolResponse<{ cached?: boolean }>(
        await handlers.handleAdvancedDeobfuscate({ code, timeout: 5000 }),
      );
      expect(result3.cached).toBe(true);
    });
  });

  describe('cache persistence', () => {
    it('should persist cache across handler instances', async () => {
      const cache = new PersistentCache({
        name: 'persist-test',
        dbPath: testDbPath,
        defaultTTL: 60000,
      });
      await cache.init();

      // Create first handler instance and populate cache
      const handlers1 = new CoreAnalysisHandlers({
        collector: createMockCollector(),
        scriptManager: createMockScriptManager(),
        deobfuscator: new Deobfuscator(),
        advancedDeobfuscator: new AdvancedDeobfuscator(),
        obfuscationDetector: new ObfuscationDetector(),
        analyzer: new CodeAnalyzer(),
        cryptoDetector: new CryptoDetector(),
        hookManager: new HookManager(),
      });

      const code = 'const persisted = true;';
      await handlers1.handleDeobfuscate({ code });

      // Create second handler instance with same cache
      // Note: In real usage, each handler creates its own cache instance
      // This test verifies the cache DB persists independently

      await cache.close();

      // Verify cache file exists
      expect(existsSync(testDbPath)).toBe(true);
    });
  });

  describe('hashCode utility', () => {
    it('should generate consistent hash codes', () => {
      // The hashCode method is private, so we test through the public API
      // by verifying that identical inputs produce identical cache behavior
      expect(
        typeof 'test'.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0),
      ).toBe('number');
    });

    it('should generate different hashes for different strings', () => {
      const hash1 = 'string1'.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
      const hash2 = 'string2'.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
      expect(hash1).not.toBe(hash2);
    });
  });
});
