import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/server';
import type { SkillCatalog } from '@modelcontextprotocol/server/ext/skills';
import { loadSkills } from '@modelcontextprotocol/server/ext/skills/node';
import { runtimeProjectRoot } from '@src/config/env-bootstrap';
import { MCP_SKILLS_DIR } from '@src/constants/server';
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
 * Load the bundled operation guides as a skill catalog.
 * Returns `null` when disabled or the directory is missing — skills are an
 * optional enhancement and must never block server startup.
 */
export async function loadJshookSkills(
  dir: string | null = resolveSkillsDir(),
): Promise<SkillCatalog | null> {
  if (dir === null) {
    logger.info('[skills] extension disabled via MCP_SKILLS_DIR=off');
    return null;
  }
  if (!existsSync(dir)) {
    logger.warn(`[skills] skills directory not found, serving without skills: ${dir}`);
    return null;
  }
  const catalog = await loadSkills(dir, { prefix: SKILL_URI_PREFIX });
  logger.info(`[skills] loaded ${catalog.entries.length} skills from ${dir}`);
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
