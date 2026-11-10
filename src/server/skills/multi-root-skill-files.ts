import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { SkillFileEntry, SkillFiles } from '@modelcontextprotocol/server/ext/skills';
import { nodeSkillFiles } from '@modelcontextprotocol/server/ext/skills/node';
import { readEnvNullableString } from '@src/config/environment';
import {
  DEFAULT_PLUGIN_ROOTS,
  parseRoots,
  resolveRoots,
} from '@server/extensions/ExtensionManager.roots';
import { logger } from '@utils/logger';

/**
 * Skill-name conflict policy across roots: the first root that declares a skill
 * wins; later duplicates are dropped with a warning so one catalog can serve
 * the bundled guides and every plugin's `skills/` folder (the SDK allows only
 * one skills extension per server, so multiple sources must merge into a
 * single catalog through this adapter).
 */
export function multiRootSkillFiles(skillsDirs: string[]): SkillFiles {
  // Lazily built: skill name -> owning directory (first root wins).
  let ownerIndex: Map<string, number> | null = null;

  const buildIndex = (): Map<string, number> => {
    if (ownerIndex) return ownerIndex;
    ownerIndex = new Map<string, number>();
    for (const [index, dir] of skillsDirs.entries()) {
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const previous = ownerIndex.get(entry.name);
        if (previous !== undefined) {
          logger.warn(
            `[skills] duplicate skill "${entry.name}" in ${dir} ignored — first definition from ${skillsDirs[previous]} wins`,
          );
          continue;
        }
        ownerIndex.set(entry.name, index);
      }
    }
    return ownerIndex;
  };

  const ownerOf = (path: string): SkillFiles | null => {
    const skillName = path.split('/', 1)[0];
    if (skillName === undefined || skillName === '') return null;
    const index = buildIndex().get(skillName);
    if (index === undefined) return null;
    return nodeSkillFiles(skillsDirs[index]!);
  };

  return {
    async list(dir) {
      if (dir === '') {
        // Aggregate the roots' native top-level entries (files included, so
        // behavior matches a single root), first root wins on name clashes.
        const seen = new Map<string, SkillFileEntry>();
        buildIndex(); // fire duplicate-skill warnings first
        for (const dirPath of skillsDirs) {
          if (!existsSync(dirPath)) continue;
          for (const entry of await nodeSkillFiles(dirPath).list('')) {
            if (!seen.has(entry.name)) seen.set(entry.name, entry);
          }
        }
        return [...seen.values()];
      }
      const delegate = ownerOf(dir);
      if (!delegate) return [];
      return delegate.list(dir);
    },
    async read(path) {
      const delegate = ownerOf(path);
      if (!delegate) {
        throw new TypeError(`no skill owns path "${path}"`);
      }
      return delegate.read(path);
    },
  };
}

/**
 * Plugin roots from `MCP_PLUGIN_ROOTS` (same env the ExtensionManager reads),
 * resolved the same way so the skills aggregator sees exactly the roots the
 * plugin loader would scan.
 */
export function resolvePluginRoots(): string[] {
  return resolveRoots(
    parseRoots(readEnvNullableString('MCP_PLUGIN_ROOTS') ?? undefined, DEFAULT_PLUGIN_ROOTS),
  );
}

/**
 * Convention: each plugin root may expose a `skills/` folder whose subfolders
 * follow the same SKILL.md layout as the bundled guides. Only existing folders
 * are collected.
 */
export function collectPluginSkillDirs(pluginRoots: string[] = resolvePluginRoots()): string[] {
  return pluginRoots.map((root) => join(root, 'skills')).filter((dir) => existsSync(dir));
}
