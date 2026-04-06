import { describe, expect, it } from 'vitest';
import { sharedStateBoardTools } from '@server/domains/shared-state-board/definitions';

describe('shared-state-board domain definitions', () => {
  it('exports a tools array', () => {
    expect(Array.isArray(sharedStateBoardTools)).toBe(true);
  });

  it('defines exactly 10 tools', () => {
    expect(sharedStateBoardTools).toHaveLength(10);
  });

  it('each tool has a name, description, and inputSchema', () => {
    for (const tool of sharedStateBoardTools) {
      expect(typeof tool.name).toBe('string');
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe('string');
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
    it('requires key', () => {
      expect(tool.inputSchema.required).toContain('key');
    });
    it('has optional namespace and pollIntervalMs', () => {
      expect(tool.inputSchema.properties).toHaveProperty('namespace');
      expect(tool.inputSchema.properties).toHaveProperty('pollIntervalMs');
    });
  });

  describe('state_board_unwatch', () => {
    const tool = sharedStateBoardTools.find((t) => t.name === 'state_board_unwatch')!;
    it('requires watchId', () => {
      expect(tool.inputSchema.required).toContain('watchId');
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

  describe('state_board_export', () => {
    const tool = sharedStateBoardTools.find((t) => t.name === 'state_board_export')!;
    it('has optional namespace and keyPattern', () => {
      expect(tool.inputSchema.properties).toHaveProperty('namespace');
      expect(tool.inputSchema.properties).toHaveProperty('keyPattern');
    });
  });

  describe('state_board_import', () => {
    const tool = sharedStateBoardTools.find((t) => t.name === 'state_board_import')!;
    it('requires data', () => {
      expect(tool.inputSchema.required).toContain('data');
    });
    it('has optional namespace and overwrite', () => {
      expect(tool.inputSchema.properties).toHaveProperty('namespace');
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
