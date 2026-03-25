import { describe, expect, it } from 'vitest';

import { memoryScanToolDefinitions } from '@server/domains/memory/definitions';

const REQUIRED_ANNOTATION_KEYS = [
  'readOnlyHint',
  'destructiveHint',
  'idempotentHint',
  'openWorldHint',
] as const;

function toolByName(name: string) {
  const tool = memoryScanToolDefinitions.find((candidate) => candidate.name === name);
  expect(tool, `Missing tool definition: ${name}`).toBeDefined();
  return tool!;
}

describe('memory tool annotations', () => {
  it('adds the full MCP annotation set to every memory tool', () => {
    expect(memoryScanToolDefinitions).toHaveLength(41);

    for (const tool of memoryScanToolDefinitions) {
      expect(tool.annotations, `Missing annotations for ${tool.name}`).toBeDefined();

      for (const key of REQUIRED_ANNOTATION_KEYS) {
        expect(tool.annotations, `Missing ${key} for ${tool.name}`).toHaveProperty(key);
        expect(typeof tool.annotations?.[key], `${tool.name}.${key} should be boolean`).toBe(
          'boolean',
        );
      }
    }
  });

  it('classifies representative memory tools by behavior', () => {
    expect(toolByName('memory_first_scan').annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });

    expect(toolByName('memory_pointer_scan').annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });

    expect(toolByName('memory_scan_delete').annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });

    expect(toolByName('memory_pointer_chain_export').annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });

    expect(toolByName('memory_patch_bytes').annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });

    expect(toolByName('memory_write_undo').annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
  });
});
