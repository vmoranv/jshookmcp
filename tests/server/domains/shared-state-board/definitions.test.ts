import { describe, expect, it } from 'vitest';
import { sharedStateBoardTools } from '@server/domains/shared-state-board/definitions';

describe('shared-state-board domain definitions', () => {
  it('exports a tools array', () => {
    expect(Array.isArray(sharedStateBoardTools)).toBe(true);
  });

  it('defines exactly 8 tools', () => {
    expect(sharedStateBoardTools).toHaveLength(8);
  });

  it('each tool has a name, description, and inputSchema', () => {
    for (const tool of sharedStateBoardTools) {
      expect(typeof tool.name).toBe('string');
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe('string');
      // @ts-expect-error
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema).toBeDefined();
      expect(typeof tool.inputSchema).toBe('object');
    }
  });

  it('each tool inputSchema has a type of object', () => {
    for (const tool of sharedStateBoardTools) {
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('each tool inputSchema has a properties object', () => {
    for (const tool of sharedStateBoardTools) {
      expect(tool.inputSchema.properties).toBeDefined();
      expect(typeof tool.inputSchema.properties).toBe('object');
    }
  });

  it('each tool inputSchema has a required array (or none if all fields are optional)', () => {
    for (const tool of sharedStateBoardTools) {
      // required may be absent or an empty array when all fields are optional
      if (tool.inputSchema.required !== undefined) {
        expect(Array.isArray(tool.inputSchema.required)).toBe(true);
      }
    }
  });

  describe('state_board_set', () => {
    const tool = sharedStateBoardTools.find((t) => t.name === 'state_board_set')!;
    it('requires key and value', () => {
      expect(tool.inputSchema.required).toContain('key');
      expect(tool.inputSchema.required).toContain('value');
    });
    it('defines optional namespace and ttlSeconds', () => {
      expect(tool.inputSchema.properties).toHaveProperty('namespace');
      expect(tool.inputSchema.properties).toHaveProperty('ttlSeconds');
    });
  });

  describe('state_board_get', () => {
    const tool = sharedStateBoardTools.find((t) => t.name === 'state_board_get')!;
    it('requires key', () => {
      expect(tool.inputSchema.required).toContain('key');
    });
    it('has optional namespace', () => {
      expect(tool.inputSchema.properties).toHaveProperty('namespace');
    });
  });

  describe('state_board_delete', () => {
    const tool = sharedStateBoardTools.find((t) => t.name === 'state_board_delete')!;
    it('requires key', () => {
      expect(tool.inputSchema.required).toContain('key');
    });
  });

  describe('state_board_list', () => {
    const tool = sharedStateBoardTools.find((t) => t.name === 'state_board_list')!;
    it('has optional namespace and includeValues', () => {
      expect(tool.inputSchema.properties).toHaveProperty('namespace');
      expect(tool.inputSchema.properties).toHaveProperty('includeValues');
    });
  });

  describe('state_board_watch', () => {
    const tool = sharedStateBoardTools.find((t) => t.name === 'state_board_watch')!;
    it('requires action', () => {
      expect(tool.inputSchema.required).toContain('action');
    });
    it('has optional key, namespace, pollIntervalMs, watchId', () => {
      expect(tool.inputSchema.properties).toHaveProperty('key');
      expect(tool.inputSchema.properties).toHaveProperty('namespace');
      expect(tool.inputSchema.properties).toHaveProperty('pollIntervalMs');
      expect(tool.inputSchema.properties).toHaveProperty('watchId');
    });
  });

  describe('state_board_history', () => {
    const tool = sharedStateBoardTools.find((t) => t.name === 'state_board_history')!;
    it('requires key', () => {
      expect(tool.inputSchema.required).toContain('key');
    });
    it('has optional namespace and limit', () => {
      expect(tool.inputSchema.properties).toHaveProperty('namespace');
      expect(tool.inputSchema.properties).toHaveProperty('limit');
    });
  });

  describe('state_board_io', () => {
    const tool = sharedStateBoardTools.find((t) => t.name === 'state_board_io')!;
    it('requires action', () => {
      expect(tool.inputSchema.required).toContain('action');
    });
    it('has optional namespace, keyPattern, data, overwrite', () => {
      expect(tool.inputSchema.properties).toHaveProperty('namespace');
      expect(tool.inputSchema.properties).toHaveProperty('keyPattern');
      expect(tool.inputSchema.properties).toHaveProperty('data');
      expect(tool.inputSchema.properties).toHaveProperty('overwrite');
    });
  });

  describe('state_board_clear', () => {
    const tool = sharedStateBoardTools.find((t) => t.name === 'state_board_clear')!;
    it('has optional namespace and keyPattern', () => {
      expect(tool.inputSchema.properties).toHaveProperty('namespace');
      expect(tool.inputSchema.properties).toHaveProperty('keyPattern');
    });
  });
});
