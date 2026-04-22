import { describe, expect, it } from 'vitest';
import { sharedStateBoardTools } from '@server/domains/shared-state-board/definitions';

describe('shared-state-board domain definitions', () => {
  it('exports a tools array', async () => {
    expect(Array.isArray(sharedStateBoardTools)).toBe(true);
  });

  it('defines exactly 3 consolidated tools', async () => {
    expect(sharedStateBoardTools).toHaveLength(3);
  });

  it('each tool has a name, description, and inputSchema', async () => {
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

  it('each tool inputSchema has a type of object', async () => {
    for (const tool of sharedStateBoardTools) {
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('each tool inputSchema has a properties object', async () => {
    for (const tool of sharedStateBoardTools) {
      expect(tool.inputSchema.properties).toBeDefined();
      expect(typeof tool.inputSchema.properties).toBe('object');
    }
  });

  it('each tool inputSchema has a required array (or none if all fields are optional)', async () => {
    for (const tool of sharedStateBoardTools) {
      if (tool.inputSchema.required !== undefined) {
        expect(Array.isArray(tool.inputSchema.required)).toBe(true);
      }
    }
  });

  describe('state_board (unified CRUD)', () => {
    const tool = sharedStateBoardTools.find((t) => t.name === 'state_board')!;
    it('requires action', async () => {
      expect(tool.inputSchema.required).toContain('action');
    });
    it('has key, value, namespace, ttlSeconds, includeValues, limit, keyPattern', async () => {
      expect(tool.inputSchema.properties).toHaveProperty('key');
      expect(tool.inputSchema.properties).toHaveProperty('value');
      expect(tool.inputSchema.properties).toHaveProperty('namespace');
      expect(tool.inputSchema.properties).toHaveProperty('ttlSeconds');
      expect(tool.inputSchema.properties).toHaveProperty('includeValues');
      expect(tool.inputSchema.properties).toHaveProperty('limit');
      expect(tool.inputSchema.properties).toHaveProperty('keyPattern');
    });
  });

  describe('state_board_watch', () => {
    const tool = sharedStateBoardTools.find((t) => t.name === 'state_board_watch')!;
    it('requires action', async () => {
      expect(tool.inputSchema.required).toContain('action');
    });
    it('has optional key, namespace, pollIntervalMs, watchId', async () => {
      expect(tool.inputSchema.properties).toHaveProperty('key');
      expect(tool.inputSchema.properties).toHaveProperty('namespace');
      expect(tool.inputSchema.properties).toHaveProperty('pollIntervalMs');
      expect(tool.inputSchema.properties).toHaveProperty('watchId');
    });
  });

  describe('state_board_io', () => {
    const tool = sharedStateBoardTools.find((t) => t.name === 'state_board_io')!;
    it('requires action', async () => {
      expect(tool.inputSchema.required).toContain('action');
    });
    it('has optional namespace, keyPattern, data, overwrite', async () => {
      expect(tool.inputSchema.properties).toHaveProperty('namespace');
      expect(tool.inputSchema.properties).toHaveProperty('keyPattern');
      expect(tool.inputSchema.properties).toHaveProperty('data');
      expect(tool.inputSchema.properties).toHaveProperty('overwrite');
    });
  });
});
