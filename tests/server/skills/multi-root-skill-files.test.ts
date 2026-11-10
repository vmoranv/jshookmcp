import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectPluginSkillDirs, multiRootSkillFiles } from '@server/skills/multi-root-skill-files';

function makeSkillDir(root: string, name: string, description: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
    'utf8',
  );
  return dir;
}

describe('multiRootSkillFiles', () => {
  let first = '';
  let second = '';

  beforeEach(() => {
    first = mkdtempSync(join(tmpdir(), 'jshook-mrs-first-'));
    second = mkdtempSync(join(tmpdir(), 'jshook-mrs-second-'));
    makeSkillDir(first, 'alpha', 'from first root');
    makeSkillDir(second, 'beta', 'from second root');
  });

  afterEach(() => {
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
  });

  it('aggregates top-level entries across roots', async () => {
    const files = multiRootSkillFiles([first, second]);
    const entries = await files.list('');
    const names = entries.map((entry) => entry.name).toSorted();
    expect(names).toEqual(['alpha', 'beta']);
  });

  it('first root wins on duplicate skill names, with a warning', async () => {
    makeSkillDir(second, 'alpha', 'duplicate from second root');
    const warnSpy = vi.spyOn((await import('@utils/logger')).logger, 'warn');
    const files = multiRootSkillFiles([first, second]);
    const entries = await files.list('');
    expect(entries.filter((entry) => entry.name === 'alpha')).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('duplicate skill "alpha"'));
    warnSpy.mockRestore();
  });

  it('routes read() to the owning root', async () => {
    const files = multiRootSkillFiles([first, second]);
    const bytes = await files.read('beta/SKILL.md');
    expect(new TextDecoder().decode(bytes)).toContain('from second root');
  });

  it('delegates sub-path listing to the owning root', async () => {
    const files = multiRootSkillFiles([first, second]);
    const entries = await files.list('beta');
    expect(entries.map((entry) => entry.name)).toContain('SKILL.md');
  });

  it('returns [] for unknown skill paths instead of throwing in list()', async () => {
    const files = multiRootSkillFiles([first, second]);
    await expect(files.list('nonexistent')).resolves.toEqual([]);
  });
});

describe('collectPluginSkillDirs', () => {
  it('keeps only roots that actually expose a skills/ folder', () => {
    const rootWithSkills = mkdtempSync(join(tmpdir(), 'jshook-mrs-plugin-'));
    try {
      mkdirSync(join(rootWithSkills, 'skills', 'inner'), { recursive: true });
      const rootBare = mkdtempSync(join(tmpdir(), 'jshook-mrs-bare-'));
      try {
        expect(collectPluginSkillDirs([rootWithSkills, rootBare])).toEqual([
          join(rootWithSkills, 'skills'),
        ]);
      } finally {
        rmSync(rootBare, { recursive: true, force: true });
      }
    } finally {
      rmSync(rootWithSkills, { recursive: true, force: true });
    }
  });
});
