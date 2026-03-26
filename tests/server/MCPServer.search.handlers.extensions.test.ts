import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  asTextResponse: vi.fn((text: string) => ({
    content: [{ type: 'text', text }],
  })),
}));

vi.mock('@server/domains/shared/response', () => ({
  asTextResponse: mocks.asTextResponse,
}));

import {
  handleExtensionsList,
  handleExtensionsReload,
} from '@server/MCPServer.search.handlers.extensions';

function parseResponse(response: any) {
  return JSON.parse((response.content[0] as any).text);
}

describe('MCPServer.search.handlers.extensions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reloads extensions and returns a formatted JSON response', async () => {
    const ctx = {
      reloadExtensions: vi.fn(async () => ({
        success: true,
        addedTools: 2,
      })),
    } as any;

    const response = await handleExtensionsReload(ctx);

    expect(ctx.reloadExtensions).toHaveBeenCalledTimes(1);
    expect(mocks.asTextResponse).toHaveBeenCalledWith(
      JSON.stringify(
        {
          success: true,
          addedTools: 2,
        },
        null,
        2,
      ),
    );
    expect(parseResponse(response)).toEqual({
      success: true,
      addedTools: 2,
    });
    expect((response as any).content[0].text).toContain('\n  "success": true,\n');
  });

  it('lists extensions and returns a formatted JSON response', async () => {
    const ctx = {
      listExtensions: vi.fn(() => ({
        success: true,
        plugins: ['workflow-kit'],
      })),
    } as any;

    const response = await handleExtensionsList(ctx);

    expect(ctx.listExtensions).toHaveBeenCalledTimes(1);
    expect(mocks.asTextResponse).toHaveBeenCalledWith(
      JSON.stringify(
        {
          success: true,
          plugins: ['workflow-kit'],
        },
        null,
        2,
      ),
    );
    expect(parseResponse(response)).toEqual({
      success: true,
      plugins: ['workflow-kit'],
    });
  });
});
