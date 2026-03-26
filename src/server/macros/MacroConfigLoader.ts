/**
 * MacroConfigLoader — Load user-defined macros from JSON config files.
 *
 * Discovers and validates JSON macro definitions from a directory
 * (typically `macros/` in the project root).
 */

import { readdir, readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { logger } from '@utils/logger';
import type { MacroDefinition } from './types';

interface MacroJsonSchema {
  id: string;
  displayName: string;
  description?: string;
  tags?: string[];
  timeoutMs?: number;
  steps: Array<{
    id: string;
    toolName: string;
    input?: Record<string, unknown>;
    inputFrom?: Record<string, string>;
    timeoutMs?: number;
    optional?: boolean;
  }>;
}

/**
 * Load all valid macro definitions from JSON files in a directory.
 * Invalid files are logged as warnings and skipped.
 */
async function loadFromDirectory(dir: string): Promise<MacroDefinition[]> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    // Directory doesn't exist — not an error, just no user macros
    return [];
  }

  const jsonFiles = files.filter((f) => extname(f) === '.json');
  const macros: MacroDefinition[] = [];

  for (const file of jsonFiles) {
    const path = resolve(dir, file);
    try {
      const raw = JSON.parse(await readFile(path, 'utf-8')) as unknown;
      if (validate(raw)) {
        macros.push(toDefinition(raw));
        logger.info(`[macros] Loaded user macro "${raw.id}" from ${file}`);
      } else {
        logger.warn(`[macros] Skipping ${file}: invalid macro schema`);
      }
    } catch (err) {
      logger.warn(`[macros] Skipping ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return macros;
}

/**
 * Type guard — validates that raw JSON matches the expected macro schema.
 */
function validate(raw: unknown): raw is MacroJsonSchema {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.id !== 'string' || !obj.id) return false;
  if (typeof obj.displayName !== 'string' || !obj.displayName) return false;
  if (!Array.isArray(obj.steps) || obj.steps.length === 0) return false;

  for (const step of obj.steps) {
    if (!step || typeof step !== 'object') return false;
    const s = step as Record<string, unknown>;
    if (typeof s.id !== 'string' || !s.id) return false;
    if (typeof s.toolName !== 'string' || !s.toolName) return false;
  }

  return true;
}

/**
 * Convert validated JSON to a MacroDefinition.
 */
function toDefinition(json: MacroJsonSchema): MacroDefinition {
  return {
    id: json.id,
    displayName: json.displayName,
    description: json.description ?? '',
    tags: json.tags ?? [],
    timeoutMs: json.timeoutMs,
    steps: json.steps.map((s) => ({
      id: s.id,
      toolName: s.toolName,
      input: s.input,
      inputFrom: s.inputFrom,
      timeoutMs: s.timeoutMs,
      optional: s.optional,
    })),
  };
}

export const MacroConfigLoader = {
  loadFromDirectory,
  validate,
} as const;
