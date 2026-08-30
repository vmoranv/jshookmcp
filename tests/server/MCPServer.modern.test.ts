import { beforeAll, describe, expect, it } from 'vitest';
import { createModernMcpServer } from '@server/MCPServer.modern';
import { initRegistry } from '@server/registry';

describe('createModernMcpServer', () => {
  beforeAll(async () => {
    await initRegistry('search');
  });

  it('creates isolated SDK servers while sharing the runtime facade', () => {
    const core = {
      config: { mcp: { name: 'test', version: '1.0.0' } },
      selectedTools: [],
      extensionToolsByName: new Map(),
      extensionPluginsById: new Map(),
      extensionPluginRuntimeById: new Map(),
      extensionWorkflowsById: new Map(),
      extensionWorkflowRuntimeById: new Map(),
      metaToolsByName: new Map(),
      toolAutocompleteHandlers: new Map(),
      activatedToolNames: new Set(),
      activatedRegisteredTools: new Map(),
      domainTtlEntries: new Map(),
      enabledDomains: new Set(),
      getDomainInstance: () => undefined,
      setDomainInstance: () => undefined,
    } as never;

    const first = createModernMcpServer(core, { era: 'modern' });
    const second = createModernMcpServer(core, { era: 'modern' });

    expect(first).not.toBe(second);
    expect(first).not.toBe((core as { server?: unknown }).server);
  });
});
