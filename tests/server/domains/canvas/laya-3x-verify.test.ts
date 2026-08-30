/**
 * laya-3x-verify — codifies which LayaAir 3.x paths in laya-adapter.ts are
 * verified (by reading public docs / source) vs unverified (require real
 * Laya 3.x runtime to confirm).
 *
 * This test acts as a living manifest: a developer touching the adapter must
 * update the verify-status table below (and ideally add a runtime-test fixture
 * path comment in laya-adapter.ts). Per lesson #51, the project explicitly
 * refuses to fabricate "verified" claims; anything unverified stays unverified
 * until a real engine run is performed.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// vitest rewrites __dirname; resolve relative to the workspace root via cwd.
// The adapter path is fixed (project layout is stable).
const ADAPTER_PATH = resolve(process.cwd(), 'src/server/domains/canvas/adapters/laya-adapter.ts');

interface VerifyStatus {
  /** Stable path identifier — used as the test key. */
  id: string;
  /** One-line summary of what the path does. */
  summary: string;
  /** True if verified by reading public LayaAir docs/source, false otherwise. */
  verified: boolean;
  /** Why the path is or is not verified. */
  reason: string;
  /** Suggested test fixture if unverified (empty when verified). */
  fixture?: string;
}

/**
 * Authoritative status of every Laya 3.x code path. Edit this table only when
 * the corresponding path in laya-adapter.ts is changed or a real Laya 3.x
 * runtime test has been added.
 */
const LAYA_3X_PATHS: VerifyStatus[] = [
  {
    id: 'detect-input-manager',
    summary: '`Laya.InputManager` class existence used as the 3.x version marker',
    verified: true,
    reason:
      'Public LayaAir 3.x docs name InputManager as the replacement for MouseManager; the detect() payload probes `window.Laya.InputManager` directly.',
  },
  {
    id: 'detect-mouse-manager',
    summary: '`Laya.MouseManager` class existence used as the 2.x version marker',
    verified: true,
    reason:
      'Public LayaAir 2.x source exports MouseManager; 3.x removes it. Used as the inverse discriminator in detect().',
  },
  {
    id: 'client-scale-x-y',
    summary: '`stage.clientScaleX` / `clientScaleY` used for screen→stage transform',
    verified: true,
    reason:
      'Both LayaAir 2.x and 3.x expose `clientScaleX/Y` on the Stage instance — a stable property across versions per public docs.',
  },
  {
    id: 'stage-hit-test-3x',
    summary: '`stage.hitTest({x,y})` called with a plain literal (no Laya.Point wrap) in 3.x',
    verified: false,
    reason:
      'Self-admitted unverified in laya-adapter.ts (lines 337-339). The 2.x path requires a Laya.Point wrapper, but whether 3.x needs the same wrapping is unknown without a real Laya 3.x runtime.',
    fixture:
      'Build a fixture page that loads LayaAir 3.x (npm install layaair2 or fetch the 3.x CDN), instantiate a Sprite with size + mouseEnabled, then verify that a hitTest({x,y}) call returns the sprite while hitTest(stage.Laya.Point) is rejected. Add an env-gated integration test (JSHOOK_ENGINE_RUNTIME=1) that asserts the in-page payload still works on the real engine.',
  },
  {
    id: 'children-vs-numchildren-3x',
    summary: 'DFS traverses via `.children` (with fallback to `._children` / `numChildren`)',
    verified: true,
    reason:
      '`.children` is the public Node.children API in 2.x and 3.x; `numChildren` is the count accessor shared across versions. Falls back to `._children` for minified 2.x builds.',
  },
  {
    id: 'local-to-global-rect-3x',
    summary: '4-corner worldBounds mapping via node.localToGlobal()',
    verified: false,
    reason:
      '2.x is verified (Laya.Point wrapper was added to fix `t.setTo is not a function`). 3.x signature of localToGlobal is unknown — it may accept a Point, an object literal, or an x/y pair.',
    fixture:
      'Add an env-gated integration test that creates a 45°-rotated sprite in a real Laya 3.x scene and asserts that the dump returns a non-zero width/height for the rotated bounds.',
  },
  {
    id: 'global-to-local-3x',
    summary: 'Pick uses node.globalToLocal() with toPt() wrapper',
    verified: false,
    reason:
      'Same 2.x-only verification as localToGlobal. Whether 3.x accepts the Laya.Point wrapper or rejects it is unverified.',
    fixture:
      'Pair with the stage-hit-test-3x fixture — both run in the same engine instance to assert globalToLocal ↔ hitTest contract.',
  },
  {
    id: 'shader-pipeline-3x',
    summary: 'Shader introspection for LayaAir 3.x (planned for canvas_dump_shaders)',
    verified: false,
    reason:
      'LayaAir 3.x introduced a new WebGL2 renderer. The shader program registry path is unknown without running the engine.',
    fixture:
      'Build a fixture page that runs a Laya 3.x scene with a custom material and walk `Laya.Shader` (or `Laya.ShaderPass`) for linked programs. Verify whether the renderer.info.programs-style API exists.',
  },
];

describe('LayaAir 3.x path verification status', () => {
  it('has a status entry for every documented 3.x code path', () => {
    const ids = LAYA_3X_PATHS.map((p) => p.id).toSorted();
    expect(ids).toContain('detect-input-manager');
    expect(ids).toContain('detect-mouse-manager');
    expect(ids).toContain('client-scale-x-y');
    expect(ids).toContain('stage-hit-test-3x');
    expect(ids).toContain('children-vs-numchildren-3x');
    expect(ids).toContain('local-to-global-rect-3x');
    expect(ids).toContain('global-to-local-3x');
    expect(ids).toContain('shader-pipeline-3x');
  });

  it('every unverified path carries a fixture suggestion', () => {
    for (const path of LAYA_3X_PATHS) {
      if (!path.verified) {
        expect(path.fixture, `fixture for ${path.id}`).toBeDefined();
        expect(path.fixture!.length).toBeGreaterThan(0);
      }
    }
  });

  it('every entry has a non-empty reason explaining the verify status', () => {
    for (const path of LAYA_3X_PATHS) {
      expect(path.reason.length).toBeGreaterThan(10);
      expect(path.summary.length).toBeGreaterThan(5);
    }
  });

  it('laya-adapter.ts carries a "self-admitted unverified" comment for the 3.x hitTest path', () => {
    const source = readFileSync(ADAPTER_PATH, 'utf8');
    expect(source).toContain('LayaAir 3.x');
    expect(source).toContain('hitTest');
    // The honest-boundary comment must explicitly note that the path is
    // unverified — it is the developer signal that future maintainers must
    // NOT promote this to a verified claim without a real engine run.
    expect(source).toMatch(/unverified/i);
  });
});

describe('LayaAir 3.x adapter payload scaffolding', () => {
  it('detects LayaAir 3.x via Laya.InputManager in the detect() payload', () => {
    const source = readFileSync(ADAPTER_PATH, 'utf8');
    expect(source).toContain('InputManager');
    // The detect payload itself (build by the inline script inside detect())
    // must check InputManager — it's the only 3.x marker we currently rely on.
    expect(source).toMatch(/laya3.*=.*InputManager|laya3:\s*!!\(laya\.InputManager\)/);
  });

  it('reads clientScaleX/Y off the Stage instance', () => {
    const source = readFileSync(ADAPTER_PATH, 'utf8');
    expect(source).toContain('clientScaleX');
    expect(source).toContain('clientScaleY');
  });

  it('does NOT wrap stage.hitTest() input via toPt() for 3.x (the unverified branch)', () => {
    const source = readFileSync(ADAPTER_PATH, 'utf8');
    // The plain-literal branch for 3.x must exist in the hitTest payload —
    // this is what makes the code self-admitted unverified.
    const stageHitTestSection = source.match(
      /if \(isLaya3 && typeof stage\.hitTest.*?catch\(e\)\s*\{\s*\}/s,
    );
    expect(stageHitTestSection, '3.x stage.hitTest branch must exist').not.toBeNull();
    expect(stageHitTestSection![0]).toContain('stage.hitTest({ x: stageX, y: stageY })');
    // And the toPt wrapper must NOT be applied to the 3.x hitTest call —
    // that is the deliberate "we're not sure 3.x needs the same wrap as 2.x".
    expect(stageHitTestSection![0]).not.toMatch(/stage\.hitTest\(toPt/);
  });
});
