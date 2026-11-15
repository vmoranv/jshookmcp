/**
 * A-phase jadx enhancements (change close-descoped-behaviors):
 *  - contextLines ceiling raised 20 -> 50
 *  - multiline flag maps to `rg -U` / fallback dotAll
 * Both are additive: existing behavior at <=20 / no multiline stays identical.
 */
import { describe, expect, it } from 'vitest';
import { buildRipgrepArgs } from '@modules/jadx-search/ripgrep-engine';
import { compileSafePattern } from '@modules/jadx-search/node-fallback-engine';
import { JADX_SEARCH_MAX_CONTEXT_LINES } from '@modules/jadx-search/constants';
import { JadxSearchEngine } from '@modules/jadx-search/JadxSearchEngine';
import type { NormalizedSearchOptions } from '@modules/jadx-search/types';

const base: NormalizedSearchOptions = {
  decompileDir: '/tmp/out',
  query: 'foo',
  globs: ['**/*.java'],
  literal: false,
  caseInsensitive: false,
  contextLines: 0,
  maxMatchesPerFile: 100,
  maxResults: 500,
};

describe('contextLines ceiling', () => {
  it('JADX_SEARCH_MAX_CONTEXT_LINES is 50', () => {
    expect(JADX_SEARCH_MAX_CONTEXT_LINES).toBe(50);
  });

  it('validateAndNormalize accepts contextLines=50 and rejects 51', async () => {
    const engine = new JadxSearchEngine({ probe: async () => ({ available: false }) });
    // Use a real directory (the repo) so stat() passes; we only test the cap.
    const dir = process.cwd();
    await expect(
      (
        engine as unknown as { validateAndNormalize: (o: object) => Promise<unknown> }
      ).validateAndNormalize({ decompileDir: dir, query: 'x', contextLines: 50 }),
    ).resolves.toBeDefined();
    await expect(
      (
        engine as unknown as { validateAndNormalize: (o: object) => Promise<unknown> }
      ).validateAndNormalize({ decompileDir: dir, query: 'x', contextLines: 51 }),
    ).rejects.toThrow(/contextLines/);
  });
});

describe('multiline -> rg -U', () => {
  it('buildRipgrepArgs adds -U when multiline is true', () => {
    const args = buildRipgrepArgs({ ...base, multiline: true } as NormalizedSearchOptions & {
      multiline: boolean;
    });
    expect(args).toContain('-U');
  });

  it('buildRipgrepArgs omits -U when multiline is false', () => {
    const args = buildRipgrepArgs(base);
    expect(args).not.toContain('-U');
  });

  it('compileSafePattern adds dotAll (s) for multiline', () => {
    const re = compileSafePattern('a.b', false, false, true);
    expect(re.flags).toContain('s');
  });
});
