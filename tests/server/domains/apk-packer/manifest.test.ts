/**
 * Manifest contract tests for the apk-packer domain.
 *
 * Validates the DomainManifest shape, profile membership, registrations,
 * and the lazy `ensure()` factory (instance caching + idempotence).
 */
import { describe, it, expect } from 'vitest';
import manifest from '@server/domains/apk-packer/manifest';
import type { MCPServerContext } from '@server/MCPServer.context';
import { ApkPackerHandlers } from '@server/domains/apk-packer/handlers';

function makeMockCtx(): MCPServerContext {
  return {} as MCPServerContext;
}

describe('apk-packer manifest', () => {
  it('has the correct domain shape', () => {
    expect(manifest.kind).toBe('domain-manifest');
    expect(manifest.version).toBe(1);
    expect(manifest.domain).toBe('apk-packer');
    expect(manifest.depKey).toBe('apkPackerHandlers');
  });

  it('is only enabled in the full profile', () => {
    expect(manifest.profiles).toContain('full');
    expect(manifest.profiles).not.toContain('workflow');
    expect(manifest.profiles).not.toContain('search');
  });

  it('registers both tools', () => {
    const toolNames = manifest.registrations.map((r) => r.tool.name).toSorted();
    expect(toolNames).toEqual(['apk_packer_detect', 'apk_packer_list_signatures']);
  });

  it('every registration is bound to the apk-packer domain', () => {
    for (const reg of manifest.registrations) {
      expect(reg.domain).toBe('apk-packer');
      expect(typeof reg.bind).toBe('function');
    }
  });

  it('ensure() seeds ctx.apkPackerHandlers and returns the instance', async () => {
    const ctx = makeMockCtx();
    const handler = await manifest.ensure(ctx);
    expect(handler).toBeInstanceOf(ApkPackerHandlers);
    expect(typeof handler.handleApkPackerDetect).toBe('function');
    expect(typeof handler.handleApkPackerListSignatures).toBe('function');
    expect(ctx.apkPackerHandlers).toBe(handler);
  });

  it('ensure() is idempotent — repeat calls return the same instance', async () => {
    const ctx = makeMockCtx();
    const first = await manifest.ensure(ctx);
    const second = await manifest.ensure(ctx);
    expect(second).toBe(first);
  });
});
