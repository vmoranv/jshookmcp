/**
 * Canvas domain benchmark — the sole offline-pure tool `canvas_scene_search`.
 * The other 10 canvas tools are pageController-bound (live browser) and are omitted.
 *
 * Homemade fixture: a 3-node synthetic scene-dump tree shaped like CanvasSceneNode
 * (Stage > Player, Enemy). Ground truth = exact walk-order match sets plus the
 * handler's path/depth/scan/cap invariants (handlers/scene-search.ts).
 */
import { CanvasToolHandlers } from '@server/domains/canvas/handlers.impl';
import { body, type BenchSuite } from '../harness';

const handlers = new CanvasToolHandlers({
  pageController: { getActivePage: async () => null },
  debuggerManager: {},
  traceRecorder: {},
  evidenceStore: {},
} as never);

// Walk order (depth-first, root first): Stage, Player, Enemy → nodesScanned 3.
const SCENE_TREE = {
  id: 'root',
  name: 'Stage',
  type: 'Container',
  visible: true,
  x: 0,
  y: 0,
  width: 800,
  height: 600,
  children: [
    {
      id: 'n1',
      name: 'Player',
      type: 'Sprite',
      visible: true,
      x: 100,
      y: 50,
      width: 64,
      height: 64,
      texture: 'hero.png',
      hp: 100,
    },
    {
      id: 'n2',
      name: 'Enemy',
      type: 'Sprite',
      visible: true,
      x: 300,
      y: 50,
      width: 64,
      height: 64,
      texture: 'enemy.png',
      hp: 50,
    },
  ],
};

type Match = Record<string, unknown>;

export const canvasSuite: BenchSuite = {
  name: 'canvas',
  domain: 'canvas',
  description:
    'canvas_scene_search pure-compute: name/property match sets, path-depth & whole-tree scan, maxResults cap and empty-result invariants (10 browser-bound canvas tools omitted)',
  cases: [
    {
      name: 'canvas_scene_search/match-by-name',
      tool: 'canvas_scene_search',
      origin: 'homemade',
      reference:
        "case-insensitive name regex 'player' selects exactly {Player}; match must carry path ['Stage','Player'] at depth 1 and expose properties.texture === 'hero.png'",
      run: () => handlers.handleSceneSearchTool({ sceneTree: SCENE_TREE, namePattern: 'player' }),
      validate: (v) => {
        const b = body(v);
        if (b.success !== true) return `success !== true: ${JSON.stringify(b).slice(0, 120)}`;
        if (b.matchedCount !== 1 || b.nodesScanned !== 3)
          return `bad count: matchedCount=${b.matchedCount} nodesScanned=${b.nodesScanned}`;
        const m = (Array.isArray(b.matches) ? b.matches : [])[0] as Match | undefined;
        if (!m || m.name !== 'Player') return `wrong match: ${JSON.stringify(b.matches)}`;
        if (m.depth !== 1 || JSON.stringify(m.path) !== JSON.stringify(['Stage', 'Player']))
          return `bad path/depth: ${JSON.stringify(m)}`;
        const p = m.properties as Match | undefined;
        if (!p || p.texture !== 'hero.png' || p.hp !== 100)
          return `bad properties: ${JSON.stringify(p)}`;
        return true;
      },
    },
    {
      name: 'canvas_scene_search/property-match-and-cap',
      tool: 'canvas_scene_search',
      origin: 'homemade',
      reference:
        "propertyFilter {texture contains '.png'} matches {Player, Enemy} (Container has no texture); maxResults:1 → matchedCount 2, truncated true, capped to walk-order-first [Player], nodesScanned still 3",
      run: () =>
        handlers.handleSceneSearchTool({
          sceneTree: SCENE_TREE,
          propertyFilter: { key: 'texture', op: 'contains', value: '.png' },
          maxResults: 1,
        }),
      validate: (v) => {
        const b = body(v);
        if (b.success !== true) return `success !== true: ${JSON.stringify(b).slice(0, 120)}`;
        if (b.matchedCount !== 2 || b.truncated !== true || b.nodesScanned !== 3)
          return `cap invariant broken: ${JSON.stringify(b)}`;
        const names = (Array.isArray(b.matches) ? b.matches : []).map((m) =>
          String((m as Match).name),
        );
        if (names.length !== 1 || names[0] !== 'Player')
          return `capped matches wrong: ${JSON.stringify(names)}`;
        return true;
      },
    },
    {
      name: 'canvas_scene_search/no-match-empty',
      tool: 'canvas_scene_search',
      origin: 'homemade',
      reference:
        "namePattern '^ZzzNoSuchNode$' matches nothing → matchedCount 0, empty matches, truncated false, whole tree still walked (nodesScanned 3)",
      run: () =>
        handlers.handleSceneSearchTool({ sceneTree: SCENE_TREE, namePattern: '^ZzzNoSuchNode$' }),
      validate: (v) => {
        const b = body(v);
        if (b.success !== true) return `success !== true: ${JSON.stringify(b).slice(0, 120)}`;
        const matches = Array.isArray(b.matches) ? b.matches : [];
        if (b.matchedCount !== 0 || matches.length !== 0 || b.truncated !== false)
          return `empty invariant broken: ${JSON.stringify(b)}`;
        if (b.nodesScanned !== 3) return `nodesScanned ${b.nodesScanned} != 3`;
        return true;
      },
    },
  ],
};
