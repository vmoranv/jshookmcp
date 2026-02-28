import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { SmartCodeCollector } from '../../../src/modules/collector/SmartCodeCollector.js';

function makeFiles() {
  return [
    {
      url: 'https://site/main.js',
      content: `import x from "./dep"; function alpha(){}; fetch('/api');`,
      size: 200,
      type: 'external',
    },
    {
      url: 'https://site/crypto.js',
      content: `const cipher = 'aes'; eval('1+1');`,
      size: 300,
      type: 'inline',
    },
    {
      url: 'https://site/vendor.js',
      content: 'x'.repeat(2000),
      size: 2000,
      type: 'external',
    },
  ] as any[];
}

describe('SmartCodeCollector', () => {
  it('summary mode returns code heuristics and previews', async () => {
    const collector = new SmartCodeCollector();
    const result = (await collector.smartCollect({} as any, makeFiles(), {
      mode: 'summary',
    })) as any[];

    expect(result).toHaveLength(3);
    expect(result[0]?.hasAPI).toBe(true);
    expect(result[1]?.hasEncryption).toBe(true);
    expect(result[1]?.hasObfuscation).toBe(true);
    expect(result[0]?.imports).toContain('./dep');
  });

  it('priority mode sorts by score and truncates oversized files', async () => {
    const collector = new SmartCodeCollector();
    const result = (await collector.smartCollect({} as any, makeFiles(), {
      mode: 'priority',
      priorities: ['crypto', 'main'],
      maxFileSize: 100,
      maxTotalSize: 260,
    })) as any[];

    expect(result.length).toBeGreaterThan(0);
    expect(result[0]?.url).toContain('crypto');
    expect(result[0]?.metadata?.priorityScore).toBeTypeOf('number');
    expect(result.some((f) => f.metadata?.truncated)).toBe(true);
  });

  it('incremental mode applies include and exclude patterns', async () => {
    const collector = new SmartCodeCollector();
    const result = (await collector.smartCollect({} as any, makeFiles(), {
      mode: 'incremental',
      includePatterns: ['main|crypto'],
      excludePatterns: ['main'],
      maxTotalSize: 10_000,
      maxFileSize: 10_000,
    })) as any[];

    expect(result).toHaveLength(1);
    expect(result[0]?.url).toContain('crypto');
  });

  it('full mode enforces total size ceiling', async () => {
    const collector = new SmartCodeCollector();
    const result = (await collector.smartCollect({} as any, makeFiles(), {
      mode: 'full',
      maxTotalSize: 250,
      maxFileSize: 10_000,
    })) as any[];

    expect(result).toHaveLength(2);
    expect(result[0]?.url).toContain('main');
    expect(result[1]?.url).toContain('crypto');
  });

  it('unknown mode falls back to full collection behavior', async () => {
    const collector = new SmartCodeCollector();
    const result = (await collector.smartCollect({} as any, makeFiles(), {
      mode: 'unknown' as any,
      maxTotalSize: 250,
      maxFileSize: 10_000,
    })) as any[];

    expect(result).toHaveLength(2);
    expect(result[0]?.url).toContain('main');
    expect(result[1]?.url).toContain('crypto');
  });
});
