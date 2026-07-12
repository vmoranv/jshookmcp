import { describe, expect, it } from 'vitest';
import { handleSceneSearch } from '@server/domains/canvas/handlers/scene-search';

function parseJson(res: unknown): Record<string, unknown> {
  const r = res as { content: Array<{ type: string; text: string }> };
  return JSON.parse(r.content[0]!.text);
}

const SAMPLE_TREE = {
  root: {
    name: 'Stage',
    type: 'Container',
    children: [
      {
        name: 'Background',
        type: 'Sprite',
        texture: 'bg.png',
        children: [],
      },
      {
        name: 'Player',
        type: 'Container',
        children: [
          { name: 'PlayerSprite', type: 'Sprite', texture: 'hero.png', visible: true },
          { name: 'HealthBar', type: 'Graphics', percent: 100 },
        ],
      },
      {
        name: 'EnemyBoss',
        type: 'Sprite',
        texture: 'boss.png',
        hp: 5000,
      },
    ],
  },
};

describe('handleSceneSearch', () => {
  it('matches nodes by name regex (case-insensitive)', async () => {
    const res = await handleSceneSearch({ sceneTree: SAMPLE_TREE, namePattern: 'player' });
    const json = parseJson(res);

    expect(json.success).toBe(true);
    const matches = json.matches as Array<{ name: string }>;
    const names = matches.map((m) => m.name);
    expect(names).toContain('Player');
    expect(names).toContain('PlayerSprite');
  });

  it('matches nodes by exact type', async () => {
    const res = await handleSceneSearch({ sceneTree: SAMPLE_TREE, typeFilter: 'Sprite' });
    const json = parseJson(res);

    const matches = json.matches as Array<{ type: string }>;
    expect(matches.every((m) => m.type === 'Sprite')).toBe(true);
    expect(matches.length).toBe(3); // Background, PlayerSprite, EnemyBoss
  });

  it('combines name pattern and type filter', async () => {
    const res = await handleSceneSearch({
      sceneTree: SAMPLE_TREE,
      namePattern: 'boss',
      typeFilter: 'Sprite',
    });
    const json = parseJson(res);

    const matches = json.matches as Array<{ name: string }>;
    expect(matches.map((m) => m.name)).toEqual(['EnemyBoss']);
  });

  it('reports the path from root for each match', async () => {
    const res = await handleSceneSearch({ sceneTree: SAMPLE_TREE, namePattern: 'HealthBar' });
    const json = parseJson(res);

    const match = (json.matches as Array<{ path: string[]; depth: number }>)[0]!;
    expect(match.path).toEqual(['Stage', 'Player', 'HealthBar']);
    expect(match.depth).toBe(2);
  });

  it('preserves engine-specific properties on matches', async () => {
    const res = await handleSceneSearch({ sceneTree: SAMPLE_TREE, namePattern: 'EnemyBoss' });
    const json = parseJson(res);

    const match = (json.matches as Array<{ properties: Record<string, unknown> }>)[0]!;
    expect(match.properties.hp).toBe(5000);
    expect(match.properties.texture).toBe('boss.png');
  });

  it('respects maxResults to cap the match list', async () => {
    const res = await handleSceneSearch({
      sceneTree: SAMPLE_TREE,
      typeFilter: 'Sprite',
      maxResults: 1,
    });
    const json = parseJson(res);

    expect(json.matchedCount).toBe(3);
    expect(json.truncated).toBe(true);
    expect((json.matches as unknown[]).length).toBe(1);
  });

  it('counts total nodes scanned', async () => {
    const res = await handleSceneSearch({ sceneTree: SAMPLE_TREE, typeFilter: 'Container' });
    const json = parseJson(res);

    expect(json.nodesScanned).toBe(6); // Stage + 3 children + Player's 2 children
  });

  it('accepts a bare array of nodes as the tree', async () => {
    const res = await handleSceneSearch({
      sceneTree: [{ name: 'A', type: 'Sprite', children: [] }],
      typeFilter: 'Sprite',
    });
    const json = parseJson(res);
    expect((json.matches as unknown[]).length).toBe(1);
  });

  it('returns a structured error when sceneTree is missing', async () => {
    const res = await handleSceneSearch({});
    const json = parseJson(res);
    expect(json.success).toBe(false);
    expect(json.error).toContain('sceneTree');
  });

  it('returns a structured error for an invalid regex', async () => {
    const res = await handleSceneSearch({ sceneTree: SAMPLE_TREE, namePattern: '(' });
    const json = parseJson(res);
    expect(json.success).toBe(false);
    expect(json.error).toContain('Invalid namePattern');
  });

  // ── propertyFilter ──────────────────────────────────────────────────

  it('matches nodes by numeric property gt', async () => {
    const res = await handleSceneSearch({
      sceneTree: SAMPLE_TREE,
      propertyFilter: { key: 'hp', op: 'gt', value: 1000 },
    });
    const json = parseJson(res);
    const names = (json.matches as Array<{ name: string }>).map((m) => m.name);
    expect(names).toEqual(['EnemyBoss']); // hp 5000
  });

  it('matches nodes by string property contains', async () => {
    const res = await handleSceneSearch({
      sceneTree: SAMPLE_TREE,
      propertyFilter: { key: 'texture', op: 'contains', value: 'hero' },
    });
    const json = parseJson(res);
    const names = (json.matches as Array<{ name: string }>).map((m) => m.name);
    expect(names).toEqual(['PlayerSprite']);
  });

  it('matches nodes by boolean property eq', async () => {
    const res = await handleSceneSearch({
      sceneTree: SAMPLE_TREE,
      propertyFilter: { key: 'visible', op: 'eq', value: true },
    });
    const json = parseJson(res);
    const names = (json.matches as Array<{ name: string }>).map((m) => m.name);
    expect(names).toEqual(['PlayerSprite']);
  });

  it('combines propertyFilter with type filter', async () => {
    const res = await handleSceneSearch({
      sceneTree: SAMPLE_TREE,
      typeFilter: 'Sprite',
      propertyFilter: { key: 'texture', op: 'contains', value: '.png' },
    });
    const json = parseJson(res);
    expect(json.matchedCount).toBe(3); // Background/PlayerSprite/EnemyBoss all have *.png textures
  });

  it('rejects an invalid propertyFilter op', async () => {
    const res = await handleSceneSearch({
      sceneTree: SAMPLE_TREE,
      propertyFilter: { key: 'hp', op: 'matches', value: 1 },
    });
    const json = parseJson(res);
    expect(json.success).toBe(false);
    expect(json.error).toContain('propertyFilter.op');
  });

  // ── bounds filter ───────────────────────────────────────────────────

  it('matches nodes whose rectangle intersects the bounds query', async () => {
    const tree = {
      root: {
        name: 'Stage',
        type: 'Container',
        children: [
          { name: 'A', type: 'Sprite', x: 0, y: 0, width: 10, height: 10 },
          { name: 'B', type: 'Sprite', x: 100, y: 100, width: 10, height: 10 },
          { name: 'C', type: 'Sprite', x: 5, y: 5, width: 10, height: 10 }, // overlaps A region
        ],
      },
    };
    const res = await handleSceneSearch({
      sceneTree: tree,
      bounds: { x: 0, y: 0, width: 15, height: 15 },
    });
    const json = parseJson(res);
    const names = (json.matches as Array<{ name: string }>).map((m) => m.name);
    expect(names).toContain('A');
    expect(names).toContain('C');
    expect(names).not.toContain('B');
  });

  it('rejects a bounds filter with non-numeric fields', async () => {
    const res = await handleSceneSearch({
      sceneTree: SAMPLE_TREE,
      bounds: { x: 0, y: 0, width: 'wide', height: 10 },
    });
    const json = parseJson(res);
    expect(json.success).toBe(false);
    expect(json.error).toContain('bounds');
  });
});
