import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/server';
import type { SkillCatalog } from '@modelcontextprotocol/server/ext/skills';
import { SkillsExtension } from '@modelcontextprotocol/server/ext/skills';
import { runtimeProjectRoot } from '@src/config/env-bootstrap';
import { MCP_SKILLS_DIR } from '@src/constants/server';
import { collectPluginSkillDirs, multiRootSkillFiles } from '@server/skills/multi-root-skill-files';
import { logger } from '@utils/logger';

/** URI namespace: skills surface as `skill://jshook/<skill>/...`. */
const SKILL_URI_PREFIX = 'jshook';

/**
 * Resolve the effective skills directory from `MCP_SKILLS_DIR`.
 * Returns `null` when the extension is disabled (`off`, case-insensitive).
 */
export function resolveSkillsDir(configured: string = MCP_SKILLS_DIR): string | null {
  const trimmed = configured.trim();
  if (trimmed.toLowerCase() === 'off') return null;
  if (trimmed === '') return join(runtimeProjectRoot, 'skills');
  return trimmed;
}

/**
 * Full source list for the single catalog: the bundled guides (when present)
 * plus every plugin root's `skills/` folder (convention, see
 * collectPluginSkillDirs). Returns `null` when the extension is disabled or
 * no source directory exists.
 */
export function resolveSkillsDirs(configured: string = MCP_SKILLS_DIR): string[] | null {
  const primary = resolveSkillsDir(configured);
  if (primary === null) return null;
  const dirs: string[] = [];
  if (existsSync(primary)) dirs.push(primary);
  dirs.push(...collectPluginSkillDirs());
  return dirs.length > 0 ? dirs : null;
}

/**
 * Load the bundled operation guides plus plugin-contributed skills into one
 * catalog (the SDK allows a single skills extension per server, so all
 * sources merge through multiRootSkillFiles). Returns `null` when disabled or
 * no source directory exists — skills are an optional enhancement and must
 * never block server startup.
 */
export async function loadJshookSkills(
  skillsDirs: string[] | null = resolveSkillsDirs(),
): Promise<SkillCatalog | null> {
  if (skillsDirs === null) {
    logger.info('[skills] extension disabled via MCP_SKILLS_DIR=off');
    return null;
  }
  if (skillsDirs.length === 0) {
    logger.warn('[skills] no skills directory found, serving without skills');
    return null;
  }
  const existing = skillsDirs.filter((dir) => existsSync(dir));
  if (existing.length === 0) {
    logger.warn(
      `[skills] none of the skills directories exist, serving without skills: ${skillsDirs.join(', ')}`,
    );
    return null;
  }
  // Loader failures (unreadable files, malformed SKILL.md under strict
  // validation, IO errors) must not reject: the promise flows into
  // MCPServer.start(), where a rejection would abort startup entirely.
  let catalog: SkillCatalog;
  try {
    catalog = await SkillsExtension.load(multiRootSkillFiles(existing), {
      prefix: SKILL_URI_PREFIX,
    });
  } catch (err) {
    logger.warn(
      `[skills] failed to load skills, serving without skills: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
  logger.info(
    `[skills] loaded ${catalog.entries.length} skills from ${skillsDirs.length} source(s)`,
  );
  return catalog;
}

/**
 * Attach a loaded catalog to the server shell. Must run before connecting a
 * transport (SDK contract); a failure here degrades to running without skills.
 */
export function attachJshookSkills(mcp: McpServer, catalog: SkillCatalog): void {
  try {
    catalog.attach(mcp);
    logger.info('[skills] extension attached to MCP server');
  } catch (err) {
    logger.warn(
      `[skills] attach failed, continuing without skills: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
