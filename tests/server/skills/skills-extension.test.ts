import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/server';
import type { SkillCatalog } from '@modelcontextprotocol/server/ext/skills';
import {
  attachJshookSkills,
  loadJshookSkills,
  resolveSkillsDir,
} from '@server/skills/skills-extension';

function makeFakeCatalog(attachImpl: (mcp: McpServer) => void = () => {}): SkillCatalog {
  return { attach: attachImpl } as unknown as SkillCatalog;
}

describe('resolveSkillsDir', () => {
  it('defaults to <projectRoot>/skills when unconfigured', () => {
    const dir = resolveSkillsDir('');
    expect(dir).toContain('skills');
    expect(dir!.endsWith('skills')).toBe(true);
  });

  it('returns null when disabled (case-insensitive, whitespace-tolerant)', () => {
    expect(resolveSkillsDir('off')).toBeNull();
    expect(resolveSkillsDir('  OFF  ')).toBeNull();
  });

  it('returns a custom path verbatim when configured', () => {
    expect(resolveSkillsDir('/custom/skills')).toBe('/custom/skills');
  });
});

describe('loadJshookSkills', () => {
  describe('disabled or missing directory', () => {
    it('returns null without touching the filesystem when disabled', async () => {
      await expect(loadJshookSkills(null)).resolves.toBeNull();
    });

    it('returns null with a warning when no source directory exists', async () => {
      const warnSpy = vi.spyOn(await import('@utils/logger').then((m) => m.logger), 'warn');
      const missing = join(tmpdir(), `jshook-skills-missing-${Date.now()}`);
      await expect(loadJshookSkills([missing])).resolves.toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('none of the skills directories exist'),
      );
      warnSpy.mockRestore();
    });
  });

  describe('bundled catalog', () => {
    it('loads all six bundled guides from the repo skills/ directory', async () => {
      const catalog = await loadJshookSkills();
      expect(catalog).not.toBeNull();
      const names = catalog!.entries.map((entry) => entry.frontmatter.name).toSorted();
      expect(names).toEqual([
        'best-practices',
        'configuration',
        'getting-started',
        'telemetry',
        'tool-selection',
        'troubleshooting',
      ]);
      for (const entry of catalog!.entries) {
        expect(entry.frontmatter.description).toBeTruthy();
      }
    });
  });

  describe('custom minimal directory', () => {
    let tempRoot = '';

    beforeEach(() => {
      tempRoot = mkdtempSync(join(tmpdir(), 'jshook-skills-test-'));
      const skillDir = join(tempRoot, 'demo-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        '---\nname: demo-skill\ndescription: minimal test skill\n---\n\n# Demo\n',
        'utf8',
      );
    });

    afterEach(() => {
      rmSync(tempRoot, { recursive: true, force: true });
    });

    it('loads a single SKILL.md from a custom directory', async () => {
      const catalog = await loadJshookSkills([tempRoot]);
      expect(catalog).not.toBeNull();
      expect(catalog!.entries).toHaveLength(1);
      expect(catalog!.entries[0]!.frontmatter.name).toBe('demo-skill');
    });

    it('merges plugin skill directories alongside a custom source', async () => {
      const second = mkdtempSync(join(tmpdir(), 'jshook-skills-second-'));
      try {
        const skillDir = join(second, 'plugin-skill');
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(
          join(skillDir, 'SKILL.md'),
          '---\nname: plugin-skill\ndescription: from a plugin root\n---\n\n# Plugin\n',
          'utf8',
        );
        const catalog = await loadJshookSkills([tempRoot, second]);
        expect(catalog).not.toBeNull();
        const names = catalog!.entries.map((entry) => entry.frontmatter.name).toSorted();
        expect(names).toEqual(['demo-skill', 'plugin-skill']);
      } finally {
        rmSync(second, { recursive: true, force: true });
      }
    });
  });
});

describe('attachJshookSkills', () => {
  it('delegates to catalog.attach with the server shell', () => {
    const attached: McpServer[] = [];
    const catalog = makeFakeCatalog((mcp) => attached.push(mcp));
    const mcp = {} as McpServer;
    attachJshookSkills(mcp, catalog);
    expect(attached).toEqual([mcp]);
  });

  it('swallows attach failures instead of blocking startup', () => {
    const catalog = makeFakeCatalog(() => {
      throw new Error('already attached');
    });
    expect(() => attachJshookSkills({} as McpServer, catalog)).not.toThrow();
  });
});
