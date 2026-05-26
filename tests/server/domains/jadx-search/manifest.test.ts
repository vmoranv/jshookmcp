/**
 * Manifest contract tests for the jadx-search domain.
 */
import { describe, expect, it } from 'vitest';
import manifest from '@server/domains/jadx-search/manifest';
import type { MCPServerContext } from '@server/MCPServer.context';
import { JadxSearchHandlers } from '@server/domains/jadx-search/handlers';

function makeMockCtx(): MCPServerContext {
  return {} as MCPServerContext;
}

describe('jadx-search manifest', () => {
  it('has the correct domain shape', () => {
    expect(manifest.kind).toBe('domain-manifest');
    expect(manifest.version).toBe(1);
    expect(manifest.domain).toBe('jadx-search');
    expect(manifest.depKey).toBe('jadxSearchHandlers');
  });

  it('is only enabled in the full profile (read-only file I/O)', () => {
    expect(manifest.profiles).toContain('full');
    expect(manifest.profiles).not.toContain('workflow');
    expect(manifest.profiles).not.toContain('search');
  });

  it('registers the jadx_search_code tool', () => {
    const toolNames = manifest.registrations.map((r) => r.tool.name);
    expect(toolNames).toContain('jadx_search_code');
    expect(toolNames).toHaveLength(1);
  });

  it('every registration is bound to the jadx-search domain', () => {
    for (const reg of manifest.registrations) {
      expect(reg.domain).toBe('jadx-search');
      expect(typeof reg.bind).toBe('function');
    }
  });

  it('ensure() seeds ctx.jadxSearchHandlers and returns the instance', async () => {
    const ctx = makeMockCtx();
    const handler = await manifest.ensure(ctx);

    expect(handler).toBeInstanceOf(JadxSearchHandlers);
    expect(typeof handler.handleJadxSearchCode).toBe('function');
    expect(ctx.jadxSearchHandlers).toBe(handler);
  });

  it('ensure() is idempotent — repeat calls return the same instance', async () => {
    const ctx = makeMockCtx();
    const first = await manifest.ensure(ctx);
    const second = await manifest.ensure(ctx);
    expect(second).toBe(first);
  });
});
