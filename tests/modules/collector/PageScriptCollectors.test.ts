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

import {
  analyzeDependencies,
  calculatePriorityScore,
  collectInlineScripts,
  collectServiceWorkers,
  collectWebWorkers,
  extractDependencies,
} from '../../../src/modules/collector/PageScriptCollectors.js';

describe('PageScriptCollectors', () => {
  it('extractDependencies parses import/require/dynamic import uniquely', () => {
    const code = `
      import x from './a';
      const y = require("./b");
      const z = import('./a');
    `;
    const deps = extractDependencies(code);
    expect(deps.sort()).toEqual(['./a', './b']);
  });

  it('analyzeDependencies builds nodes and import edges', () => {
    const files: any[] = [
      { url: 'https://site/a.js', content: `import b from "b";`, type: 'external', size: 10 },
      { url: 'https://site/b.js', content: 'export default 1', type: 'external', size: 10 },
    ];

    const graph = analyzeDependencies(files);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toEqual([
      { from: 'https://site/a.js', to: 'https://site/b.js', type: 'import' },
    ]);
  });

  it('calculatePriorityScore rewards meaningful urls and penalizes vendor bundles', () => {
    const high = calculatePriorityScore({
      url: 'https://x/main-crypto-api.js',
      type: 'inline',
      size: 5000,
      content: '',
    } as any);
    const low = calculatePriorityScore({
      url: 'https://x/vendor/react.bundle.js',
      type: 'external',
      size: 400000,
      content: '',
    } as any);

    expect(high).toBeGreaterThan(low);
  });

  it('collectInlineScripts applies max file cap and preserves metadata', async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValue([
        { url: 'inline-script-0', content: 'a', size: 1, type: 'inline', metadata: { truncated: false } },
        { url: 'inline-script-1', content: 'b', size: 1, type: 'inline', metadata: { truncated: true } },
        { url: 'inline-script-2', content: 'c', size: 1, type: 'inline', metadata: { truncated: false } },
      ]),
    } as any;

    const result = await collectInlineScripts(page, 10, 2);
    expect(result).toHaveLength(2);
    expect(result[1]?.metadata?.truncated).toBe(true);
  });

  it('collectServiceWorkers gathers successful worker scripts and skips failed ones', async () => {
    const page = {
      evaluate: vi
        .fn()
        .mockResolvedValueOnce([
          { url: 'https://site/sw-1.js', scope: '/', state: 'activated' },
          { url: 'https://site/sw-2.js', scope: '/', state: 'activated' },
        ])
        .mockResolvedValueOnce('self.addEventListener("fetch",()=>{})')
        .mockRejectedValueOnce(new Error('fetch failed')),
    } as any;

    const files = await collectServiceWorkers(page);
    expect(files).toHaveLength(1);
    expect(files[0]?.type).toBe('service-worker');
    expect(files[0]?.url).toContain('sw-1.js');
  });

  it('collectWebWorkers resolves relative URLs against current page URL', async () => {
    const page = {
      evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValueOnce(['/worker.js']).mockResolvedValueOnce('onmessage=()=>{}'),
      url: vi.fn().mockReturnValue('https://site/app/index.html'),
    } as any;

    const files = await collectWebWorkers(page);
    expect(files).toHaveLength(1);
    expect(files[0]?.url).toBe('https://site/worker.js');
    expect(files[0]?.type).toBe('web-worker');
  });
});
