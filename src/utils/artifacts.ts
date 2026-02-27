/**
 * Unified artifact output management.
 * Ensures all tool outputs go to well-structured directories with consistent naming.
 */

import { mkdir } from 'node:fs/promises';
import { resolve, relative, normalize, sep } from 'node:path';
import { getProjectRoot } from './outputPaths.js';

export type ArtifactCategory =
  | 'wasm'
  | 'traces'
  | 'profiles'
  | 'dumps'
  | 'reports'
  | 'har'
  | 'sessions'
  | 'tmp';

const ARTIFACT_BASE = 'artifacts';

/**
 * Generate a timestamped artifact path.
 *
 * @param category - Artifact subdirectory (wasm, traces, etc.)
 * @param toolName - Tool that produces this artifact
 * @param target - Target identifier (e.g., module name, URL hash)
 * @param ext - File extension (without dot)
 * @returns { absolutePath, displayPath }
 */
export async function resolveArtifactPath(options: {
  category: ArtifactCategory;
  toolName: string;
  target?: string;
  ext: string;
  customDir?: string;
}): Promise<{ absolutePath: string; displayPath: string }> {
  const { category, toolName, target, ext, customDir } = options;
  const root = getProjectRoot();

  const dir = customDir
    ? resolve(root, customDir)
    : resolve(root, ARTIFACT_BASE, category);

  // PathGuard: ensure resolved dir stays under project root
  const normalizedRoot = normalize(root);
  const normalizedDir = normalize(dir);
  if (normalizedDir !== normalizedRoot && !normalizedDir.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error(`Path traversal blocked: artifact directory "${customDir}" escapes project root`);
  }

  await mkdir(dir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const shortId = Math.random().toString(36).substring(2, 8);
  const safeName = sanitizeFilename(toolName);
  const safeTarget = target ? `-${sanitizeFilename(target)}` : '';
  const safeExt = ext.replace(/^\./, '');

  const filename = `${safeName}${safeTarget}-${ts}-${shortId}.${safeExt}`;
  const absolutePath = resolve(dir, filename);
  const displayPath = relative(root, absolutePath).replace(/\\/g, '/');

  return { absolutePath, displayPath };
}

/**
 * Get the artifacts root directory.
 */
export function getArtifactsRoot(): string {
  return resolve(getProjectRoot(), ARTIFACT_BASE);
}

/**
 * Get a specific artifact category directory.
 */
export function getArtifactDir(category: ArtifactCategory): string {
  return resolve(getProjectRoot(), ARTIFACT_BASE, category);
}

/**
 * Sanitize a string for use as a filename component.
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 60);
}
